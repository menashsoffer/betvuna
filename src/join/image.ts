const SIZE = 600;
const MAX_BYTES = 290_000;

/** Square-crop around the centre, scale to 600×600 and encode as JPEG under ~290KB. */
export async function toSquareJpeg(source: CanvasImageSource & { width: number; height: number }, mirror = false): Promise<Blob> {
  const w = source.width, h = source.height;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  if (mirror) { ctx.translate(SIZE, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  for (const q of [0.82, 0.72, 0.6, 0.5]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('image_too_large');
}

/** A file from the gallery or the native camera, with EXIF rotation applied. */
export async function fileToJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try { return await toSquareJpeg(bmp); } finally { bmp.close(); }
}
