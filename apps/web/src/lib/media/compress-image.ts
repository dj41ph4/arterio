/**
 * Client-side photo compression before upload: phone cameras produce 5-15 MB
 * HEIC/JPEG shots; recompressed to ≤2048px JPEG they land around 0.5-1.5 MB —
 * fast on 4G and comfortably under the API's 15 MB media cap. Non-image files
 * and images that can't be decoded pass through untouched (the server still
 * enforces its own limits).
 */
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // undecodable (rare HEIC without browser support) — let the server decide
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    // Already small and already JPEG → recompressing would only lose quality.
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 1_500_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
