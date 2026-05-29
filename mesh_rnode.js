// RNode transport — LoRa via KISS framing over WebSerial
// Protocol: KISS framing, port 0 = data, port 1 = ACK
// Address: 8-byte hex derived from map public key

const FEND = 0xC0;
const FESC = 0xDB;
const TFEND = 0xDC;
const TFESC = 0xDD;

function kissEncode(data) {
  const out = [FEND, 0x00]; // port 0 = data
  for (const b of new Uint8Array(data)) {
    if (b === FEND) { out.push(FESC, TFEND); }
    else if (b === FESC) { out.push(FESC, TFESC); }
    else { out.push(b); }
  }
  out.push(FEND);
  return new Uint8Array(out);
}

function kissDecode(buffer) {
  // Returns array of payloads extracted from KISS frames
  const frames = [];
  let inFrame = false;
  let escaped = false;
  let current = [];
  let port = 0;

  for (const b of new Uint8Array(buffer)) {
    if (b === FEND) {
      if (inFrame && current.length > 0) {
        frames.push({ port, data: new Uint8Array(current) });
        current = [];
      }
      inFrame = true;
      escaped = false;
      port = 0;
    } else if (inFrame) {
      if (escaped) {
        if (b === TFEND) current.push(FEND);
        else if (b === TFESC) current.push(FESC);
        else { current.push(FESC); current.push(b); }
        escaped = false;
      } else if (b === FESC) {
        escaped = true;
      } else {
        if (current.length === 0 && port === 0) {
          port = b; // First byte after FEND is the port
        } else {
          current.push(b);
        }
      }
    }
  }
  return frames;
}

// RNode transport manager
let rnodeWriter = null;
let rnodeReader = null;
let rnodeReadable = null;
let rnodeKeepalive = null;
let rnodePort = null;
let rnodeOnReceive = null;
let rnodeOnClose = null;

export async function rnodeConnect(onReceive, onClose) {
  try {
    console.log("[rnode] requesting serial port...");
    const port = await navigator.serial.requestPort({ filters: [] });
    console.log("[rnode] opening at 115200...");
    await port.open({ baudRate: 115200 });
    console.log("[rnode] serial port opened");
    rnodePort = port;
    rnodeWriter = port.writable.getWriter();
    rnodeOnReceive = onReceive;
    rnodeOnClose = onClose;

    // Start read loop
    rnodeReadable = port.readable;
    rnodeReader = rnodeReadable.getReader();
    console.log("[rnode] starting read loop");
    readLoop();

    // Keepalive — send empty KISS frame every 30s to keep serial alive
    rnodeKeepalive = setInterval(() => {
      if (rnodeWriter) {
        rnodeWriter.write(kissEncode(new Uint8Array(0))).catch(() => {});
      }
    }, 30000);

    return true;
  } catch (e) {
    console.error("[rnode] connect failed:", e);
    return false;
  }
}

async function readLoop() {
  let buffer = new Uint8Array(0);
  try {
    while (rnodeReader) {
      const { value, done } = await rnodeReader.read();
      if (done) break;
      if (value) {
        buffer = concatBufs(buffer, value);
        const frames = kissDecode(buffer);
        if (frames.length > 0) {
          console.log("[rnode] received", frames.length, "KISS frame(s),", frames.map(f => f.data.length).join(","), "bytes");
          buffer = new Uint8Array(0); // Reset after successful decode
          for (const frame of frames) {
            if (frame.port === 0 && frame.data.length > 0) {
              // Data frame
              const text = new TextDecoder().decode(frame.data);
              console.log("[rnode] data frame:", text.slice(0, 100));
              rnodeOnReceive?.(text, 0);
            } else if (frame.port === 1) {
              // ACK frame — could be used later for delivery confirmation
            }
          }
        }
        // Prevent buffer from growing indefinitely — keep last 8192 bytes
        if (buffer.length > 8192) {
          buffer = buffer.slice(buffer.length - 4096);
        }
      }
    }
  } catch (e) {
    console.error("[rnode] read error:", e);
  }
  rnodeOnClose?.();
}

export async function rnodeSend(data) {
  if (!rnodeWriter) return;
  const buf = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  try {
    const frame = kissEncode(buf);
    console.log("[rnode] sending", buf.length, "bytes");
    await rnodeWriter.write(frame);
  } catch (e) {
    console.error("[rnode] send error:", e);
  }
}

export async function rnodeDisconnect() {
  if (rnodeKeepalive) { clearInterval(rnodeKeepalive); rnodeKeepalive = null; }
  if (rnodeReader) { await rnodeReader.cancel().catch(() => {}); rnodeReader = null; }
  if (rnodeWriter) { await rnodeWriter.close().catch(() => {}); rnodeWriter = null; }
  if (rnodePort) { await rnodePort.close().catch(() => {}); rnodePort = null; }
  rnodeOnReceive = null;
  rnodeOnClose = null;
}

export function isRnodeConnected() {
  return rnodePort !== null;
}

function concatBufs(a, b) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}
