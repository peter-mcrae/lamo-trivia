import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { canDecodeImages, photoDecodeMessage } from '@/hooks/usePhotoUpload';

const PREVIEW_MAX_DIMENSION = 1024;

interface PhotoCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

/**
 * Render the picked photo to a `data:` URL for the preview.
 *
 * `createImageBitmap` takes the Blob directly, so there is no `blob:` URL and
 * no Worker — the production CSP (`default-src 'none'`, no `blob:`, no
 * `worker-src`) blocks both. Downscaling first also keeps the data URL small
 * instead of base64-ing a full-size phone photo.
 *
 * This is deliberately the *same* decoder the upload uses (see
 * `resizeViaCanvas` in usePhotoUpload). There is no FileReader fallback: a
 * `readAsDataURL` of an undecodable photo all but always succeeds, so it used
 * to hand back bytes the `<img>` then rendered as a broken-image icon next to
 * a confident, enabled Submit. Tapping it closed the dialog, failed on the
 * very same decode, and showed the error with nowhere left to pick another
 * photo. A preview must only appear when the upload can also succeed.
 */
async function toPreviewDataUrl(file: File): Promise<string> {
  if (!canDecodeImages()) {
    throw new Error('createImageBitmap is unavailable');
  }
  const bitmap = await createImageBitmap(file);

  try {
    let { width, height } = bitmap;

    if (width > PREVIEW_MAX_DIMENSION || height > PREVIEW_MAX_DIMENSION) {
      if (width > height) {
        height = Math.round((height * PREVIEW_MAX_DIMENSION) / width);
        width = PREVIEW_MAX_DIMENSION;
      } else {
        width = Math.round((width * PREVIEW_MAX_DIMENSION) / height);
        height = PREVIEW_MAX_DIMENSION;
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
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    bitmap.close();
  }
}

export function PhotoCapture({ onCapture, onClose }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Decoding a large photo takes a moment — if the user re-picks before it
  // finishes, the slower (older) result must not overwrite the newer preview
  const previewRequestRef = useRef(0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const requestId = ++previewRequestRef.current;
    setSelectedFile(file);
    setPreviewError(null);

    let dataUrl: string;
    try {
      dataUrl = await toPreviewDataUrl(file);
    } catch {
      if (previewRequestRef.current !== requestId) return;
      // Keep the dialog open and say what went wrong, so they can pick a
      // different photo — the alternative is a broken preview and a Submit
      // that cannot work
      setPreviewError(photoDecodeMessage(file));
      setSelectedFile(null);
      // Reset the input so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    if (previewRequestRef.current !== requestId) return;
    setPreview(dataUrl);
  };

  const handleRetake = () => {
    previewRequestRef.current++;
    setPreview(null);
    setSelectedFile(null);
    setPreviewError(null);
    // Reset the input so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleSubmit = () => {
    if (selectedFile) {
      onCapture(selectedFile);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-lamo-dark">Take a Photo</h3>
          <button
            onClick={onClose}
            className="text-lamo-gray-muted hover:text-lamo-dark transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {!preview ? (
          <div>
            <label className="flex flex-col items-center justify-center w-full h-48 rounded-xl border-2 border-dashed border-lamo-border bg-lamo-bg cursor-pointer hover:border-lamo-blue/40 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-lamo-gray-muted mb-2">
                <path d="M12 9a3.75 3.75 0 1 0 0 7.5A3.75 3.75 0 0 0 12 9Z" />
                <path fillRule="evenodd" d="M9.344 3.071a49.52 49.52 0 0 1 5.312 0c.967.052 1.83.585 2.332 1.39l.821 1.317c.2.32.58.529.992.529h.282a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H3.417a2.25 2.25 0 0 1-2.25-2.25v-7.5a2.25 2.25 0 0 1 2.25-2.25h.282c.413 0 .792-.21.992-.529l.821-1.317a2.25 2.25 0 0 1 2.332-1.39ZM12 12.75a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
              </svg>
              <span className="text-sm text-lamo-gray-muted">Tap to take a photo</span>
              {previewError && (
                <span className="mt-2 px-4 text-center text-xs text-red-600">{previewError}</span>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        ) : (
          <div>
            <div className="mb-4 rounded-xl overflow-hidden bg-black">
              <img
                src={preview}
                alt="Preview"
                className="w-full max-h-64 object-contain"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={handleRetake} className="flex-1">
                Retake
              </Button>
              <Button onClick={handleSubmit} className="flex-1">
                Submit
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
