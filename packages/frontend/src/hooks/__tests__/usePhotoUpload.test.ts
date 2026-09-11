import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MAX_SOURCE_PHOTO_BYTES, usePhotoUpload } from '../usePhotoUpload';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { uploadHuntPhoto: vi.fn() },
}));

const uploadHuntPhoto = api.uploadHuntPhoto as unknown as ReturnType<typeof vi.fn>;

/** Size of the blob canvas.toBlob() hands back — the test drives this. */
let encodedSize = 1024;
let bitmapClosed = false;

function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(new Blob([new Uint8Array(encodedSize)], { type: 'image/jpeg' }));
  } as HTMLCanvasElement['toBlob']);
}

function stubCreateImageBitmap(width = 4032, height = 3024) {
  const close = vi.fn(() => {
    bitmapClosed = true;
  });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close }) as unknown as ImageBitmap),
  );
}

function stubFailingCreateImageBitmap() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      throw new Error('The source image could not be decoded.');
    }),
  );
}

beforeEach(() => {
  encodedSize = 1024;
  bitmapClosed = false;
  uploadHuntPhoto.mockReset();
  uploadHuntPhoto.mockResolvedValue({ uploadId: 'up-1' });
  stubCanvas();
  stubCreateImageBitmap();
  // The old implementation went through a blob: URL, which the production CSP
  // blocks. Fail loudly if anything reintroduces one. Spy on the real
  // constructor rather than vi.stubGlobal('URL', { ...URL }) — spreading a class
  // yields a plain object, which silently breaks `new URL()` for everything else.
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    throw new Error('createObjectURL must not be used — blocked by the production CSP');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function photo(name = 'IMG_0001.jpg', type = 'image/jpeg', bytes = 8 * 1024 * 1024) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('usePhotoUpload', () => {
  it('downscales through createImageBitmap without ever minting a blob: URL', async () => {
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    let uploadId: string | null = null;
    await act(async () => {
      uploadId = await result.current.uploadPhoto(photo(), 'item-1');
    });

    expect(uploadId).toBe('up-1');
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(bitmapClosed).toBe(true);
    expect(result.current.error).toBeNull();

    // The resized file — not the original 8MB one — is what gets uploaded
    const uploaded = uploadHuntPhoto.mock.calls[0][1] as File;
    expect(uploaded.type).toBe('image/jpeg');
    expect(uploaded.size).toBe(1024);
  });

  it('caps the long edge at 1024px and keeps the aspect ratio', async () => {
    stubCreateImageBitmap(4032, 3024);
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    await act(async () => {
      await result.current.uploadPhoto(photo(), 'item-1');
    });

    const canvas = (HTMLCanvasElement.prototype.toBlob as unknown as ReturnType<typeof vi.fn>).mock
      .instances[0] as HTMLCanvasElement;
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(768);
  });

  it('surfaces an error instead of silently uploading the original when decoding fails', async () => {
    stubFailingCreateImageBitmap();
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    let uploadId: string | null = 'sentinel';
    await act(async () => {
      uploadId = await result.current.uploadPhoto(photo(), 'item-1');
    });

    expect(uploadId).toBeNull();
    expect(uploadHuntPhoto).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/Could not process this image/);
  });

  it('rejects an oversized original before the decoder ever allocates for it', async () => {
    // A real file over the cap, not a stubbed encoder result: createImageBitmap
    // allocates the full-resolution RGBA buffer up front, so measuring the
    // downscaled output instead would be both unreachable (a 1024px JPEG at
    // quality 0.8 is 100-400kB) and far too late to protect anything.
    const huge = photo('IMG_0002.jpg', 'image/jpeg', MAX_SOURCE_PHOTO_BYTES + 1);
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    let uploadId: string | null = 'sentinel';
    await act(async () => {
      uploadId = await result.current.uploadPhoto(huge, 'item-1');
    });

    expect(uploadId).toBeNull();
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(uploadHuntPhoto).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/too large to process \(over 25MB\)/);
  });

  it('lets a normal full-size phone photo through', async () => {
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    await act(async () => {
      await result.current.uploadPhoto(photo('IMG_0003.HEIC', 'image/heic', 8 * 1024 * 1024), 'item-1');
    });

    expect(result.current.error).toBeNull();
    expect(uploadHuntPhoto).toHaveBeenCalledTimes(1);
  });

  it('accepts a HEIC file — the browser decodes it natively, no conversion library', async () => {
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    let uploadId: string | null = null;
    await act(async () => {
      uploadId = await result.current.uploadPhoto(photo('IMG_0002.HEIC', 'image/heic'), 'item-1');
    });

    expect(uploadId).toBe('up-1');
    expect((uploadHuntPhoto.mock.calls[0][1] as File).type).toBe('image/jpeg');
  });

  it('names the format when the browser has no codec for it', async () => {
    // heic2any used to convert this in pure JS on any browser; it had to go
    // because it builds a blob: Worker the CSP blocks (it hung forever). The
    // replacement leans on an OS codec Safari/iOS has and desktop
    // Chrome/Firefox/Edge generally do not, so a HEIC that arrived by AirDrop
    // or photo-library sync genuinely cannot be read here — say so.
    stubFailingCreateImageBitmap();
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    await act(async () => {
      await result.current.uploadPhoto(photo('IMG_0002.HEIC', 'image/heic'), 'item-1');
    });

    expect(result.current.error).toMatch(/format this browser can't read/i);
    expect(result.current.error).toMatch(/convert it to JPEG/i);
  });

  it('says the browser is too old when createImageBitmap is missing entirely', async () => {
    // Safari/iOS < 15 does not have the function at all
    vi.stubGlobal('createImageBitmap', undefined);
    const { result } = renderHook(() => usePhotoUpload('HUNT-1'));

    await act(async () => {
      await result.current.uploadPhoto(photo(), 'item-1');
    });

    expect(uploadHuntPhoto).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/browser is too old to process photos/i);
  });
});
