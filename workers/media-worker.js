// Web Worker: image compression using OffscreenCanvas
// Accepts { id, buffer: ArrayBuffer, mimeType: string, fileName: string }
// Returns { id, buffer: ArrayBuffer, type: string, name: string }

const MAX_DIM = 1920;
const QUALITY = 0.8;

async function compress(buffer, mimeType, fileName) {
  const blob = new Blob([buffer], { type: mimeType });
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  let w = bitmap.width, h = bitmap.height;
  if (w > MAX_DIM || h > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let outBlob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY });
  if (!outBlob || outBlob.size === 0) {
    outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  }
  if (!outBlob || outBlob.size === 0) {
    return { buffer, type: mimeType, name: fileName };
  }
  const ext = outBlob.type === "image/webp" ? ".webp" : ".jpg";
  return {
    buffer: await outBlob.arrayBuffer(),
    type: outBlob.type,
    name: fileName.replace(/\.[^.]+$/, ext),
  };
}

self.onmessage = async (e) => {
  const { id, buffer, mimeType, fileName } = e.data;
  try {
    const result = await compress(buffer, mimeType, fileName);
    self.postMessage({ id, ...result }, [result.buffer]);
  } catch {
    self.postMessage({ id, buffer, type: mimeType, name: fileName }, [buffer]);
  }
};
