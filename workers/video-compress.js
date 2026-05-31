// Web Worker: video compression using WebCodecs API
// Falls back to returning null so the main thread can use MediaRecorder.
import * as MP4Box from "mp4box";

const MAX_DIM = 1280;
const BITRATE = 1_500_000;
const OUTPUT_FPS = 30;
const FRAME_DURATION_US = Math.round(1_000_000 / OUTPUT_FPS);

self.onmessage = async (e) => {
  const { id, buffer, mimeType, fileName } = e.data;
  try {
    const result = await compress(buffer, mimeType, fileName);
    self.postMessage({ id, ...result }, [result.buffer.buffer]);
  } catch (_) {
    // Return original on failure — main thread falls back to MediaRecorder
    self.postMessage({ id, buffer, type: mimeType, name: fileName }, [buffer.buffer]);
  }
};

async function compress(bytes, mimeType, fileName) {
  // Step 1: Demux MP4/MOV
  const { samples, codec, description, width, height, timescale } = await demuxMP4(bytes);

  // Step 2: Pick output codec
  const outputCodec = await pickOutputCodec();
  if (!outputCodec) throw new Error("No usable encoder codec");

  // Step 3: Decode all frames
  const frames = await decodeAll(samples, codec, description, timescale, samples.length);
  if (frames.length === 0) throw new Error("No frames decoded");

  // Step 4: Resize if needed
  const { outW, outH } = calcDimensions(width, height);
  const needsResize = outW !== width || outH !== height;
  let canvas, ctx;
  if (needsResize) {
    canvas = new OffscreenCanvas(outW, outH);
    ctx = canvas.getContext("2d");
  }

  // Step 5: Encode frames
  const { chunks, metadata } = await encodeAll(
    frames, outputCodec, outW, outH, needsResize, canvas, ctx
  );

  // Step 6: Mux into WebM
  const muxed = muxWebM(chunks, outputCodec, outW, outH,
    metadata?.description || null, FRAME_DURATION_US);

  return { buffer: new Uint8Array(muxed), type: "video/webm", name: fileName.replace(/\.[^.]+$/, ".webm") };
}

// ── Demux ────────────────────────────────────────────

function demuxMP4(bytes) {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    let videoTrack = null;
    let timescale = 0;
    let allSamples = [];

    file.onReady = (info) => {
      videoTrack = info.tracks.find(t => t.video);
      if (!videoTrack) { file.stop(); return reject("No video track"); }
      timescale = videoTrack.timescale;
      file.setExtractionOptions(videoTrack.id, null, { nbSamples: videoTrack.nb_samples });
      file.start();
    };

    file.onSamples = (_id, _user, samples) => {
      allSamples.push(...samples);
    };

    file.onError = (e) => reject(e);

    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(new Uint8Array(bytes));
    buf.fileStart = 0;
    file.appendBuffer(buf);
    file.flush();

    // Give extraction time to complete
    setTimeout(() => {
      if (!videoTrack) return reject("Demux timeout");
      resolve({
        samples: allSamples,
        codec: videoTrack.codec || "",
        description: extractCodecDesc(allSamples[0]),
        width: videoTrack.video?.width || 640,
        height: videoTrack.video?.height || 480,
        timescale,
      });
    }, 200);
  });
}

function extractCodecDesc(sample) {
  if (!sample?.description?.boxes) return null;
  for (const boxType of ["avcC", "hvcC", "vpcC"]) {
    const box = sample.description.boxes.find(b => b.type === boxType);
    if (box) return box.data;
  }
  return null;
}

// ── Codec Selection ─────────────────────────────────

const CODECS = [
  { codec: "vp8",             keyFrameEvery: 60 },
  { codec: "vp09.00.10.08",  keyFrameEvery: 60 },
  { codec: "vp09.00.40.08",  keyFrameEvery: 60 },
  { codec: "avc1.42001E",    keyFrameEvery: 30 },
];

async function pickOutputCodec() {
  for (const c of CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: c.codec,
        width: 640,
        height: 480,
        bitrate: BITRATE,
        framerate: OUTPUT_FPS,
      });
      if (support.supported) return c;
    } catch (_) {}
  }
  return null;
}

// ── Decode ───────────────────────────────────────────

async function decodeAll(samples, codec, description, timescale, totalFrames) {
  const frames = [];
  let error = null;

  const decoder = new VideoDecoder({
    output(frame) { frames.push(frame); },
    error(e) { error = e; },
  });

	const cfg = { codec };
	if (description) cfg.description = new Uint8Array(description);
	decoder.configure(cfg);

  for (const s of samples) {
    decoder.decode(new EncodedVideoChunk({
      type: s.is_rap ? "key" : "delta",
      timestamp: Math.round((s.cts * 1_000_000) / timescale),
      duration: Math.round((s.duration * 1_000_000) / timescale),
      data: s.data,
    }));
  }

  await decoder.flush();
  decoder.close();

  if (error) throw error;
  return frames;
}

// ── Dimensions ───────────────────────────────────────

function calcDimensions(w, h) {
  if (w <= MAX_DIM && h <= MAX_DIM) return { outW: w, outH: h };
  const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
  let nw = Math.round(w * ratio);
  let nh = Math.round(h * ratio);
  nw = Math.max(2, nw - (nw % 2));
  nh = Math.max(2, nh - (nh % 2));
  return { outW: nw, outH: nh };
}

// ── Encode ───────────────────────────────────────────

function encodeAll(frames, outputCodec, w, h, needsResize, canvas, ctx) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let metadata = null;

    const encoder = new VideoEncoder({
      output(chunk, meta) {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration || FRAME_DURATION_US });
        if (!metadata && meta?.decoderConfig) metadata = meta.decoderConfig;
      },
      error(e) { reject(e); },
    });

    encoder.configure({
      codec: outputCodec.codec,
      width: w,
      height: h,
      bitrate: BITRATE,
      framerate: OUTPUT_FPS,
      latencyMode: "quality",
    });

    let frameIdx = 0;
    for (const frame of frames) {
      const ts = frameIdx * FRAME_DURATION_US;
      if (needsResize) {
        ctx.drawImage(frame, 0, 0, w, h);
        frame.close();
        const resized = new VideoFrame(canvas, { timestamp: ts, duration: FRAME_DURATION_US });
        encoder.encode(resized, { keyFrame: frameIdx % outputCodec.keyFrameEvery === 0 });
        resized.close();
      } else {
        encoder.encode(frame, { keyFrame: frameIdx % outputCodec.keyFrameEvery === 0 });
        frame.close();
      }
      frameIdx++;
    }

    encoder.flush().then(() => {
      encoder.close();
      resolve({ chunks, metadata });
    });
  });
}

// ── WebM Muxer ───────────────────────────────────────

function muxWebM(chunks, codecCfg, w, h, codecPrivate, frameDurationUs) {
  const codecId = codecCfg.codec.startsWith("vp8") ? "V_VP8" : codecCfg.codec.startsWith("vp9") ? "V_VP9"
    : codecCfg.codec.startsWith("avc1") ? "V_MPEG4/ISO/AVC" : "V_VP8";

  const parts = [];

  // EBML header
  parts.push(ebmlHeader());

  // Segment (unknown size)
  parts.push(ebmlTag(0x18538067, null));

  // Info
  const durationNs = chunks.length * frameDurationUs * 1000;
  parts.push(ebmlTag(0x1549A966, [
    ebmlFloat(0x2AD7B1, durationNs),
    ebmlString(0x4D80, "piggpin"),
    ebmlString(0x5741, "piggpin"),
  ]));

  // Tracks
  const trackChildren = [
    ebmlUint(0xD7, 1),
    ebmlUint(0x73C5, 1),
    ebmlUint(0x83, 1),
    ebmlString(0x86, codecId),
  ];
  if (codecPrivate) {
    trackChildren.push(ebmlBinary(0x63A2, codecPrivate));
  }
  trackChildren.push(ebmlTag(0xE0, [
    ebmlFloat(0xB0, w),
    ebmlFloat(0xBA, h),
  ]));
  parts.push(ebmlTag(0x1654AE6B, [ebmlTag(0xAE, trackChildren)]));

  // Clusters: 60 frames per cluster
  const CLUSTER = 60;
  for (let i = 0; i < chunks.length; i += CLUSTER) {
    const clusterChunks = chunks.slice(i, i + CLUSTER);
    const clusterTime = clusterChunks[0].timestamp; // us

    const blockParts = [];
    for (const c of clusterChunks) {
      const relTs = Math.round((c.timestamp - clusterTime) / 1000); // ms, int16
      const flags = c.type === "key" ? 0x80 : 0x00;
      blockParts.push(ebmlTag(0xA3, [
        varint(1),
        int16BE(Math.max(0, Math.min(32767, relTs))),
        new Uint8Array([flags]),
        c.data,
      ]));
    }

    parts.push(ebmlTag(0x1F43B675, [
      ebmlUint(0xE7, clusterTime * 1000), // ns
      ...blockParts,
    ]));
  }

  const total = concat(parts);
  // Segment uses unknown size: write end marker
  // Unknown size is signaled by size field = 0x01FFFFFFFFFFFFFF
  // We already wrote that via ebmlTag with null size
  return total;
}

// ── EBML Helpers ─────────────────────────────────────

function ebmlHeader() {
  const children = [
    ebmlUint(0x4286, 1),
    ebmlUint(0x42F7, 1),
    ebmlUint(0x42F2, 4),
    ebmlUint(0x42F3, 8),
    ebmlString(0x4282, "webm"),
    ebmlUint(0x4287, 4),
    ebmlUint(0x4285, 2),
  ];
  return ebmlTag(0x1A45DFA3, children);
}

function ebmlTag(id, children) {
  // If children is null, use unknown size (0x01FFFFFFFFFFFFFF)
  const idBytes = encodeEbmlId(id);
  let sizeBytes;
  let payload;

  if (children === null) {
    sizeBytes = new Uint8Array([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    return concat([idBytes, sizeBytes]);
  }

  if (Array.isArray(children)) {
    // Flatten: children can be Uint8Arrays or arrays of Uint8Arrays
    payload = concat(children.flat(1));
  } else {
    payload = children;
  }

  if (!payload || payload.length === 0) {
    sizeBytes = new Uint8Array([0x80]);
    return concat([idBytes, sizeBytes]);
  }

  sizeBytes = encodeEbmlSize(payload.length);
  return concat([idBytes, sizeBytes, payload]);
}

function ebmlUint(id, n) {
  // Encode as variable-size unsigned integer
  let bytes;
  if (n < 0x80) bytes = new Uint8Array([n]);
  else if (n < 0x4000) bytes = new Uint8Array([0x40 | (n >> 8), n & 0xFF]);
  else if (n < 0x200000) bytes = new Uint8Array([0x60 | (n >> 16), (n >> 8) & 0xFF, n & 0xFF]);
  else if (n < 0x10000000) bytes = new Uint8Array([0x70 | (n >> 24), (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
  else bytes = new Uint8Array([0x78, (n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
  return ebmlTag(id, bytes);
}

function ebmlFloat(id, n) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, n, false);
  return ebmlTag(id, new Uint8Array(buf));
}

function ebmlString(id, s) {
  const bytes = new TextEncoder().encode(s);
  return ebmlTag(id, bytes);
}

function ebmlBinary(id, buf) {
  if (typeof buf === "string") {
    return ebmlTag(id, new TextEncoder().encode(buf));
  }
  const arr = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  return ebmlTag(id, arr);
}

function encodeEbmlId(id) {
  // EBML ID uses variable-length encoding with leading 1s minus 1
  if (id < 0x80) return new Uint8Array([id]);
  const bytes = [];
  while (id > 0) {
    bytes.unshift(id & 0xFF);
    id >>= 8;
  }
  return new Uint8Array(bytes);
}

function encodeEbmlSize(n) {
  if (n === 0) return new Uint8Array([0x80]); // 0 size
  // Mark the first byte with a leading 1 at the bit matching the byte count
  if (n < 0x40) return new Uint8Array([0x80 | n]);  // 1 byte (0x80 = 1 followed by 7 bits)
  if (n < 0x2000) {
    return new Uint8Array([0x40 | (n >> 8), n & 0xFF]);
  }
  if (n < 0x100000) {
    return new Uint8Array([0x20 | (n >> 16), (n >> 8) & 0xFF, n & 0xFF]);
  }
  if (n < 0x8000000) {
    return new Uint8Array([0x10 | (n >> 24), (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
  }
  // 5 bytes
  return new Uint8Array([0x08, (n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
}

function varint(n) {
  if (n < 0x80) return new Uint8Array([n]);
  const buf = [];
  while (n > 0) {
    buf.push(n & 0x7F);
    n >>= 7;
  }
  for (let i = buf.length - 2; i >= 0; i--) buf[i] |= 0x80;
  buf[buf.length - 1] &= 0x7F;
  return new Uint8Array(buf.reverse());
}

function int16BE(n) {
  const buf = new ArrayBuffer(2);
  new DataView(buf).setInt16(0, n, false);
  return new Uint8Array(buf);
}

function concat(arrays) {
  const filtered = arrays.filter(a => a && a.length > 0);
  let totalLen = 0;
  for (const a of filtered) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of filtered) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}
