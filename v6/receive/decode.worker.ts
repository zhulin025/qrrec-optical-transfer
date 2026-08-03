import { inflateSync } from "fflate";
import { decodeQRCodesFromCanvas } from "@raptorqr/core/qr/qr_decode";
import { parsePacket, packetCodec } from "@raptorqr/core/protocol/packet";
import { RaptorQWasmDecoder } from "@raptorqr/core/fec/raptorq_wasm";
import { payloadRateKiBps } from "../shared/metrics";
import { unwrapV6Envelope } from "../shared/envelope";

type State = {
  decoder: RaptorQWasmDecoder;
  dataLength: number;
  symbolSize: number;
  compressed: boolean;
  unique: Set<string>;
  decodedSymbols: number;
  uniquePayloadBytes: number;
  firstUniqueAt: number;
  originalBytes: number;
};

let state: State | null = null;
let pendingFrame: ImageData | null = null;
let processing = false;
let droppedFrames = 0;
let completed = false;

self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "reset") {
    state = null; pendingFrame = null; droppedFrames = 0; completed = false;
    return;
  }
  if (message.type === "frame" && !completed) {
    if (pendingFrame) droppedFrames++;
    pendingFrame = message.imageData;
    void drain();
  }
};

async function drain(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (pendingFrame && !completed) {
      const frame = pendingFrame;
      pendingFrame = null;
      await decodeFrame(frame);
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    processing = false;
  }
}

async function decodeFrame(image: ImageData): Promise<void> {
  const started = performance.now();
  const symbols = await decodeQRCodesFromCanvas(image, {
    maxSymbols: 4,
    binarizer: "LocalAverage",
    tryHarder: false,
    tryRotate: false,
    tryInvert: false,
    tryDownscale: true,
    downscaleFactor: 3,
  });
  let accepted = 0;
  for (const decoded of symbols) {
    let packet;
    try { packet = parsePacket(decoded.bytes); } catch { continue; }
    if (packetCodec(packet.header) !== "wasm-raptorq") continue;
    if (!state) {
      const decoder = await RaptorQWasmDecoder.create(packet.header.dataLength, packet.payload.length);
      state = {
        decoder,
        dataLength: packet.header.dataLength,
        symbolSize: packet.payload.length,
        compressed: packet.header.compressed,
        unique: new Set(),
        decodedSymbols: 0,
        uniquePayloadBytes: 0,
        firstUniqueAt: 0,
        originalBytes: 0,
      };
    }
    if (packet.header.dataLength !== state.dataLength || packet.payload.length !== state.symbolSize) continue;
    state.decodedSymbols++;
    const key = packetId(packet.payload);
    if (state.unique.has(key)) continue;
    state.unique.add(key);
    if (!state.firstUniqueAt) state.firstUniqueAt = performance.now();
    state.uniquePayloadBytes += Math.max(0, packet.payload.length - 4);
    accepted++;
    const reconstructed = state.decoder.push(packet.payload);
    if (reconstructed) {
      const finishedAt = performance.now();
      const raptorFile = unwrap(state.compressed ? inflateSync(reconstructed) : reconstructed);
      const final = await unwrapV6Envelope(raptorFile.data);
      state.originalBytes = final.length;
      completed = true;
      const activeMs = finishedAt - state.firstUniqueAt;
      self.postMessage({
        type: "complete",
        data: final.buffer,
        filename: raptorFile.filename,
        mime: raptorFile.mime,
        originalBytes: final.length,
        activeMs,
        decodedSymbols: state.decodedSymbols,
        uniquePackets: state.unique.size,
        droppedFrames,
      }, [final.buffer as ArrayBuffer]);
      return;
    }
  }
  if (state) {
    const now = performance.now();
    const needed = Math.max(1, Math.ceil(state.dataLength / Math.max(1, state.symbolSize - 4)));
    self.postMessage({
      type: "progress",
      decodedSymbols: state.decodedSymbols,
      uniquePackets: state.unique.size,
      duplicates: state.decodedSymbols - state.unique.size,
      neededPackets: needed,
      progress: Math.min(.99, state.unique.size / needed),
      payloadRate: payloadRateKiBps(state.uniquePayloadBytes, state.firstUniqueAt, now),
      activeMs: now - state.firstUniqueAt,
      droppedFrames,
      decodeMs: performance.now() - started,
      accepted,
    });
  }
}

function packetId(payload: Uint8Array): string {
  return `${payload[0] ?? 0}:${payload[1] ?? 0}:${payload[2] ?? 0}:${payload[3] ?? 0}`;
}

function unwrap(input: Uint8Array): { data: Uint8Array; filename: string; mime: string } {
  let filename = `received-${Date.now().toString(36)}.bin`;
  let mime = "application/octet-stream";
  let data = input;
  if (input.length >= 2) {
    const nameLength = input[0]!;
    const mimeOffset = 1 + nameLength;
    if (mimeOffset < input.length) {
      const mimeLength = input[mimeOffset]!;
      const end = mimeOffset + 1 + mimeLength;
      if (end <= input.length) {
        filename = new TextDecoder().decode(input.slice(1, mimeOffset)) || filename;
        mime = new TextDecoder().decode(input.slice(mimeOffset + 1, end)) || mime;
        data = input.slice(end);
      }
    }
  }
  return { data, filename: filename.replaceAll("/", "_"), mime };
}
