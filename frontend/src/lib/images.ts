/**
 * Screenshots made ready to be read: redrawn as JPEG at a size AI models read
 * well, and a very long one (a phone's "scrolling screenshot") cut into parts
 * that overlap a little, since a model shrinks a tall picture until its text
 * is too small to read. Everything happens in the browser; only the parts are sent.
 */

/** One picture to send. Parts of the same screenshot share a `group`. */
export interface ScreenshotPart {
  data: string;
  group: number;
}

/** Wider than this is shrunk: phone text stays sharp and the upload stays small. */
const MAX_WIDTH = 1280;
/** The tallest a part may be, as a multiple of its width, before it is cut. */
const PART_RATIO = 2.2;
const OVERLAP = 0.08;
const MAX_PARTS = 4;
const QUALITY = 0.88;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Older browsers decode through an <img> instead.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** The parts to send for one screenshot. Throws an Error with a plain message when the file is not a picture this can open. */
export async function prepareScreenshot(file: File, group: number): Promise<ScreenshotPart[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error(`${file.name} couldn't be opened. Use a PNG or JPEG screenshot.`);
  }
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let parts = 1;
    let part = height;
    if (height > width * PART_RATIO * 1.15) {
      parts = Math.min(MAX_PARTS, Math.ceil(height / (width * PART_RATIO * (1 - OVERLAP))));
      part = Math.ceil(height / (parts - (parts - 1) * OVERLAP));
    }
    const step = parts > 1 ? (height - part) / (parts - 1) : 0;
    const out: ScreenshotPart[] = [];
    for (let i = 0; i < parts; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = part;
      const pen = canvas.getContext("2d");
      if (!pen) throw new Error("This browser can't prepare pictures.");
      pen.fillStyle = "#fff";
      pen.fillRect(0, 0, width, part);
      const top = Math.round(i * step);
      pen.drawImage(bitmap, 0, top / scale, bitmap.width, part / scale, 0, 0, width, part);
      out.push({ data: canvas.toDataURL("image/jpeg", QUALITY), group });
    }
    return out;
  } finally {
    bitmap.close();
  }
}
