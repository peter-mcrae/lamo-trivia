import { useState, useCallback } from 'react';
import { HUNT_LIMITS } from '@lamo-trivia/shared';
import { api } from '@/lib/api';

const MAX_DIMENSION = 1024;

/**
 * Largest original we are willing to hand to the decoder.
 *
 * This guards memory, not bandwidth: `createImageBitmap` allocates the full
 * decoded RGBA buffer *before* anything is downscaled, so a 200MP source costs
 * ~800MB of it and takes the tab with it. File size is the only proxy for
 * pixel count available before the decode starts, and every real phone capture
 * lands far below this — a 48MP HEIC is ~8MB.
 */
export const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;

/**
 * `createImageBitmap` decodes through an OS codec. Safari/iOS ships one for
 * HEIC/HEIF; desktop Chrome/Firefox/Edge on Windows and Linux generally do
 * not. HEIC does not only originate on the device that took it — it also
 * arrives by AirDrop, iCloud/Google Photos sync and shared albums — so a
 * desktop player really can hit a photo this browser cannot open. Say what
 * they can do about it instead of asking them to retry the same file forever.
 */
export const UNSUPPORTED_FORMAT_MESSAGE =
  "This photo is in a format this browser can't read — try again from your phone, or convert it to JPEG.";

export const OUTDATED_BROWSER_MESSAGE =
  'This browser is too old to process photos. Please update it, or take the photo on your phone instead.';

export const GENERIC_DECODE_MESSAGE =
  'Could not process this image. Please try taking the photo again, or use a JPEG/PNG image.';

/** Formats every browser decodes itself, with no help from an OS codec. */
const UNIVERSAL_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
]);
const UNIVERSAL_IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp)$/i;

/** Safari/iOS < 15 has no `createImageBitmap` at all — check before calling it. */
export function canDecodeImages(): boolean {
  return typeof createImageBitmap === 'function';
}

function isUniversallyDecodable(file: File): boolean {
  // A file synced in from another device frequently arrives with an empty type
  return file.type
    ? UNIVERSAL_IMAGE_TYPES.has(file.type.toLowerCase())
    : UNIVERSAL_IMAGE_EXTENSIONS.test(file.name);
}

/** Explain a decode failure in terms the player can actually act on. */
export function photoDecodeMessage(file: File): string {
  if (!canDecodeImages()) return OUTDATED_BROWSER_MESSAGE;
  if (!isUniversallyDecodable(file)) return UNSUPPORTED_FORMAT_MESSAGE;
  return GENERIC_DECODE_MESSAGE;
}

/**
 * Decode and downscale a picked photo entirely through `createImageBitmap`.
 *
 * It takes the Blob directly, so there is no `blob:` URL and no Worker — the
 * production CSP (`default-src 'none'`, no `blob:`, no `worker-src`) blocks
 * both, which silently killed the old `URL.createObjectURL` + `new Image()`
 * path and made `heic2any` hang forever on its own Worker.
 */
export async function resizeViaCanvas(blob: Blob): Promise<File> {
  if (!canDecodeImages()) {
    throw new Error(OUTDATED_BROWSER_MESSAGE);
  }
  const bitmap = await createImageBitmap(blob);

  try {
    let { width, height } = bitmap;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width > height) {
        height = Math.round((height * MAX_DIMENSION) / width);
        width = MAX_DIMENSION;
      } else {
        width = Math.round((width * MAX_DIMENSION) / height);
        height = MAX_DIMENSION;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    ctx.drawImage(bitmap, 0, 0, width, height);

    const resized = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
    if (!resized) {
      throw new Error('Failed to compress image');
    }

    return new File([resized], 'photo.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

async function prepareImage(file: File): Promise<File> {
  // Measure the *original*, before the decoder ever sees it. Checking the
  // resized result instead is theatre: a 1024px JPEG at quality 0.8 is 100-400kB
  // and can never approach the cap, and by then the full-resolution buffer the
  // cap exists to prevent has already been allocated.
  if (file.size > MAX_SOURCE_PHOTO_BYTES) {
    const maxMb = Math.round(MAX_SOURCE_PHOTO_BYTES / (1024 * 1024));
    throw new Error(
      `This photo is too large to process (over ${maxMb}MB). Please take a new photo, or pick a smaller one.`,
    );
  }

  let prepared: File;
  try {
    prepared = await resizeViaCanvas(file);
  } catch {
    // Never fall back to the untouched file: a full-size phone photo then
    // sails past the downscale straight into the server's size cap, and the
    // real failure stays invisible to the player
    throw new Error(photoDecodeMessage(file));
  }

  // Backstop only — the encoder settings above cannot produce a file this big.
  // It is here so a future change to MAX_DIMENSION or the JPEG quality cannot
  // quietly start posting payloads the server will reject.
  if (prepared.size > HUNT_LIMITS.maxPhotoSizeBytes) {
    const maxMb = Math.round(HUNT_LIMITS.maxPhotoSizeBytes / (1024 * 1024));
    throw new Error(
      `Photo is too large (max ${maxMb}MB). Please try taking the photo again.`,
    );
  }

  return prepared;
}

export function usePhotoUpload(huntId: string) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadPhoto = useCallback(async (file: File, itemId: string): Promise<string | null> => {
    setUploading(true);
    setError(null);

    try {
      const prepared = await prepareImage(file);

      // Retry upload up to 2 times on network failures
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { uploadId } = await api.uploadHuntPhoto(huntId, prepared, itemId);
          return uploadId;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : '';
          // Only retry on network errors, not on 4xx validation errors
          const isNetworkError = msg === 'Failed to fetch' || msg === 'Load failed' || msg === 'NetworkError when attempting to fetch resource.';
          if (!isNetworkError || attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      throw lastErr;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      return null;
    } finally {
      setUploading(false);
    }
  }, [huntId]);

  return { uploadPhoto, uploading, error, clearError: () => setError(null) };
}
