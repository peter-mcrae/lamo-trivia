import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

const MAX_DIMENSION = 1024;

async function resizeImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if larger than max, maintaining aspect ratio
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      // Always convert through canvas to produce JPEG
      // (handles HEIC/HEIF from iOS and other unsupported formats)
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            // Wrap in a File with explicit name and type so FormData
            // always sends the correct Content-Type multipart header
            resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/jpeg',
        0.8,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/** Attempt to resize via canvas; if that fails, return the original file
 *  as long as it's an accepted image type. */
async function prepareImage(file: File): Promise<File> {
  try {
    return await resizeImage(file);
  } catch {
    // Canvas processing failed (e.g. unsupported format, memory pressure).
    // Fall back to the original file if it's an accepted type and within size.
    const accepted = ['image/jpeg', 'image/png', 'image/webp'];
    if (accepted.includes(file.type)) {
      return file;
    }
    throw new Error(
      'Could not process this image. Please try taking the photo again, or use a JPEG/PNG image.',
    );
  }
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
