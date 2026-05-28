import jsQR from "jsqr";

export function createScanner(onDetected, onError) {
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.style.cssText =
    "width:100%;max-width:360px;border-radius:8px;background:#000;display:block;";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null;
  let active = true;

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      video.srcObject = stream;
      await video.play();
      tick();
    } catch (e) {
      active = false;
      onError?.(e);
    }
  }

  function tick() {
    if (!active) return;
    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw > 0 && vh > 0) {
        canvas.width = vw;
        canvas.height = vh;
        ctx.drawImage(video, 0, 0, vw, vh);
        const img = ctx.getImageData(0, 0, vw, vh);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code && code.data) {
          stop();
          onDetected(code.data);
          return;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  function stop() {
    active = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  start();
  return { video, stop };
}
