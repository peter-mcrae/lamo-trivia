import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PhotoCapture } from '../PhotoCapture';

const DATA_URL = 'data:image/jpeg;base64,AAAA';

let bitmapClosed = false;

function stubDecodePipeline(ok = true) {
  bitmapClosed = false;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      if (!ok) throw new Error('The source image could not be decoded.');
      return {
        width: 4032,
        height: 3024,
        close: () => {
          bitmapClosed = true;
        },
      } as unknown as ImageBitmap;
    }),
  );
}

beforeEach(() => {
  stubDecodePipeline();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(DATA_URL);
  // The production CSP blocks blob: for both img-src and worker-src. Spy on the
  // real constructor rather than vi.stubGlobal('URL', { ...URL }) — spreading a
  // class yields a plain object, which silently breaks `new URL()`.
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    throw new Error('createObjectURL must not be used — blocked by the production CSP');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pick(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

const heic = () => new File([new Uint8Array(64)], 'IMG_0001.HEIC', { type: 'image/heic' });
const jpeg = () => new File([new Uint8Array(8)], 'photo.jpg', { type: 'image/jpeg' });

describe('PhotoCapture', () => {
  it('previews a HEIC capture and reveals Submit — no Worker, no blob: URL', async () => {
    const onCapture = vi.fn();
    render(<PhotoCapture onCapture={onCapture} onClose={vi.fn()} />);

    pick(heic());

    const img = (await screen.findByAltText('Preview')) as HTMLImageElement;
    expect(img.src).toBe(DATA_URL);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(bitmapClosed).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it('never offers a preview it cannot back up with a working upload', async () => {
    // Verified in a real browser under the production CSP: createImageBitmap
    // rejects on a HEIC that desktop Chrome has no codec for, while
    // FileReader.readAsDataURL happily returns data:image/heic;base64,... that
    // the <img> then renders as a broken-image icon — beside an enabled Submit
    // whose upload fails on the very same decode, after the dialog has closed.
    stubDecodePipeline(false);
    const readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL');

    render(<PhotoCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    pick(heic());

    await waitFor(() => {
      expect(screen.getByText(/format this browser can't read/i)).toBeInTheDocument();
    });
    expect(screen.queryByAltText('Preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
    expect(readAsDataURL).not.toHaveBeenCalled();
    // Still a usable dialog: the file input is there to pick another photo with
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('says the browser is too old when createImageBitmap is missing entirely', async () => {
    // Safari/iOS < 15 has no createImageBitmap at all, and the upload path
    // needs it too — so there is nothing to preview and nothing to submit
    vi.stubGlobal('createImageBitmap', undefined);

    render(<PhotoCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    pick(jpeg());

    await waitFor(() => {
      expect(screen.getByText(/browser is too old to process photos/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
  });

  it('falls back to the generic message for a format the browser can display', async () => {
    stubDecodePipeline(false);

    render(<PhotoCapture onCapture={vi.fn()} onClose={vi.fn()} />);
    pick(jpeg());

    await waitFor(() => {
      expect(screen.getByText(/could not process this image/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
  });
});
