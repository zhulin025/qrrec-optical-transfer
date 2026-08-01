const MAGIC = new Uint8Array([0x44, 0x51, 0x46, 0x31]); // DQF1
const HEADER_LEN = 16;

export interface TransferFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export function packTransferFile(file: TransferFile): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(file.name);
  const type = enc.encode(file.type || "application/octet-stream");
  if (name.length > 0xffff || type.length > 0xffff) throw new Error("文件名或类型信息过长");

  const out = new Uint8Array(HEADER_LEN + name.length + type.length + file.bytes.length);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, name.length, true);
  dv.setUint16(6, type.length, true);
  dv.setUint32(8, file.bytes.length, true);
  dv.setUint32(12, 0, true);
  out.set(name, HEADER_LEN);
  out.set(type, HEADER_LEN + name.length);
  out.set(file.bytes, HEADER_LEN + name.length + type.length);
  return out;
}

export function unpackTransferFile(payload: Uint8Array): TransferFile | null {
  if (payload.length < HEADER_LEN || !MAGIC.every((value, i) => payload[i] === value)) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const nameLen = dv.getUint16(4, true);
  const typeLen = dv.getUint16(6, true);
  const fileLen = dv.getUint32(8, true);
  const contentStart = HEADER_LEN + nameLen + typeLen;
  if (contentStart + fileLen !== payload.length) return null;
  const dec = new TextDecoder();
  return {
    name: dec.decode(payload.subarray(HEADER_LEN, HEADER_LEN + nameLen)) || "received-file",
    type:
      dec.decode(payload.subarray(HEADER_LEN + nameLen, contentStart)) ||
      "application/octet-stream",
    bytes: payload.subarray(contentStart),
  };
}
