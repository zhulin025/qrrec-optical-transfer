import { gunzipSync, gzipSync } from "fflate";

const MAGIC = new Uint8Array([0x44, 0x51, 0x56, 0x32]); // DQV2
const HEADER = 20;

export interface TransferFileV2 {
  name: string;
  type: string;
  bytes: Uint8Array;
  compressed: boolean;
  originalLength: number;
}

export function packTransferFileV2(file: Omit<TransferFileV2, "compressed" | "originalLength">): {
  payload: Uint8Array;
  compressed: boolean;
  originalLength: number;
} {
  const name = new TextEncoder().encode(file.name);
  const type = new TextEncoder().encode(file.type || "application/octet-stream");
  const zipped = gzipSync(file.bytes, { level: 6 });
  const compressed = zipped.length + 32 < file.bytes.length;
  const data = compressed ? zipped : file.bytes;
  const out = new Uint8Array(HEADER + name.length + type.length + data.length);
  out.set(MAGIC);
  const view = new DataView(out.buffer);
  view.setUint8(4, compressed ? 1 : 0);
  view.setUint16(6, name.length, true);
  view.setUint16(8, type.length, true);
  view.setUint32(12, file.bytes.length, true);
  view.setUint32(16, data.length, true);
  out.set(name, HEADER);
  out.set(type, HEADER + name.length);
  out.set(data, HEADER + name.length + type.length);
  return { payload: out, compressed, originalLength: file.bytes.length };
}

export function unpackTransferFileV2(payload: Uint8Array): TransferFileV2 | null {
  if (payload.length < HEADER || !MAGIC.every((byte, index) => payload[index] === byte)) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const compressed = view.getUint8(4) === 1;
  const nameLength = view.getUint16(6, true);
  const typeLength = view.getUint16(8, true);
  const originalLength = view.getUint32(12, true);
  const dataLength = view.getUint32(16, true);
  const dataStart = HEADER + nameLength + typeLength;
  if (dataStart + dataLength !== payload.length) return null;
  const decoder = new TextDecoder();
  const name = decoder.decode(payload.subarray(HEADER, HEADER + nameLength)) || "received-file";
  const type = decoder.decode(payload.subarray(HEADER + nameLength, dataStart)) || "application/octet-stream";
  const stored = payload.subarray(dataStart);
  const bytes = compressed ? gunzipSync(stored) : stored;
  if (bytes.length !== originalLength) return null;
  return { name, type, bytes, compressed, originalLength };
}
