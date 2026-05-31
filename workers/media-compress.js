// Main-thread manager for image compression Web Worker.
// Falls back to main-thread Canvas if OffscreenCanvas is unavailable.

const isOffscreenSupported = typeof OffscreenCanvas !== "undefined";

let _worker = null;
let _nextId = 1;
const _pending = new Map(); // id → { resolve, reject, timeout }

function getWorker() {
  if (!_worker && isOffscreenSupported) {
    _worker = new Worker(new URL("./media-worker.js", import.meta.url), { type: "module" });
    _worker.onmessage = (e) => {
      const { id, buffer, type, name } = e.data;
      const pending = _pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        _pending.delete(id);
        pending.resolve({ buffer, type, name });
      }
    };
    _worker.onerror = () => {}; // individual messages handle their own errors via timeout
  }
  return _worker;
}

function compressOnMain(buffer, mimeType, fileName) {
  return new Promise((resolve) => {
    const blob = new Blob([buffer], { type: mimeType });
    createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }).then((bitmap) => {
      let w = bitmap.width, h = bitmap.height;
      if (w > 1920 || h > 1920) {
        const ratio = Math.min(1920 / w, 1920 / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      canvas.toBlob((outBlob) => {
        const tryJpeg = () => {
          canvas.toBlob((jpegBlob) => {
            if (!jpegBlob) return resolve({ buffer, type: mimeType, name: fileName });
            jpegBlob.arrayBuffer().then((buf) => {
              resolve({ buffer: buf, type: jpegBlob.type, name: fileName.replace(/\.[^.]+$/, ".jpg") });
            });
          }, "image/jpeg", 0.85);
        };
        if (!outBlob) return tryJpeg();
        outBlob.arrayBuffer().then((buf) => {
          resolve({ buffer: buf, type: outBlob.type, name: fileName.replace(/\.[^.]+$/, ".webp") });
        });
      }, "image/webp", 0.8);
    }).catch(() => {
      resolve({ buffer, type: mimeType, name: fileName });
    });
  });
}

/**
 * Compress an image buffer. Routes to Web Worker when OffscreenCanvas is available,
 * falls back to main-thread Canvas otherwise.
 *
 * @param {ArrayBuffer} buffer
 * @param {string} mimeType
 * @param {string} fileName
 * @returns {Promise<{buffer: ArrayBuffer, type: string, name: string}>}
 */
export function compressImageBuffer(buffer, mimeType, fileName) {
  const worker = getWorker();
  if (!worker) return compressOnMain(buffer, mimeType, fileName);

  return new Promise((resolve, reject) => {
    const id = _nextId++;
    const timeout = setTimeout(() => {
      _pending.delete(id);
      // Fall back to main thread on timeout
      compressOnMain(buffer, mimeType, fileName).then(resolve, reject);
    }, 10_000);
    _pending.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, buffer, mimeType, fileName }, [buffer]);
  });
}

// ── Video Compression (WebCodecs, with fallback) ─────

let _videoWorker = null;
let _nextVideoId = 1;
const _videoPending = new Map();

const webcodecsSupported =
  typeof VideoEncoder !== "undefined" &&
  typeof VideoDecoder !== "undefined";

function getVideoWorker() {
  if (!_videoWorker && webcodecsSupported) {
    _videoWorker = new Worker(new URL("./video-compress.js", import.meta.url), { type: "module" });
    _videoWorker.onmessage = (e) => {
      const { id, buffer, type, name } = e.data;
      const pending = _videoPending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        _videoPending.delete(id);
        pending.resolve({ buffer, type, name });
      }
    };
    _videoWorker.onerror = () => {}; // let individual timeouts handle errors
  }
  return _videoWorker;
}

export function compressVideoBuffer(buffer, mimeType, fileName) {
  if (!webcodecsSupported) return null;

  const worker = getVideoWorker();
  if (!worker) return null;

  return new Promise((resolve) => {
    const id = _nextVideoId++;
    const timeout = setTimeout(() => {
      _videoPending.delete(id);
      resolve(null); // timeout → fall back to MediaRecorder
    }, 120_000);
    _videoPending.set(id, { resolve, timeout });
    // Transfer the buffer to avoid copying
    worker.postMessage({ id, buffer, mimeType, fileName }, [buffer.buffer]);
  });
}
