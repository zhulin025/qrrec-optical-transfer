const HEADER_SIZE = 40;
const MAGIC = [0x51, 0x56, 0x36, 0x01] as const;

export async function wrapV6Envelope(data: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const output = new Uint8Array(HEADER_SIZE + data.length);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(4, data.length, true);
  output.set(digest, 8);
  output.set(data, HEADER_SIZE);
  return output;
}
export async function unwrapV6Envelope(input: Uint8Array): Promise<Uint8Array> {
  if (input.length < HEADER_SIZE || MAGIC.some((byte, index) => input[index] !== byte)) {
    throw new Error("不是有效的 QRREC V6 文件封装");
  }
  const length = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(4, true);
  const data = input.slice(HEADER_SIZE);
  if (data.length !== length) throw new Error(`V6 文件长度校验失败：期望 ${length}，实际 ${data.length}`);
  const expected = input.slice(8, HEADER_SIZE);
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  if (!actual.every((byte, index) => byte === expected[index])) throw new Error("V6 文件 SHA-256 校验失败");
  return data;
}
