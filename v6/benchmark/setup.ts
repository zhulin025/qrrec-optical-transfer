import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";

class TestImageData {
  readonly colorSpace = "srgb";
  constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height = data.byteLength / (width * 4)) {}
}
// @ts-expect-error happy-dom has no complete ImageData implementation.
globalThis.ImageData = TestImageData;
Object.defineProperty(WebAssembly, "instantiateStreaming", { configurable: true, value: undefined });

const originalFetch = globalThis.fetch.bind(globalThis);
const paths = {
  "zxing_reader.wasm": join(process.cwd(), "node_modules/@raptorqr/core/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm"),
  "zxing_writer.wasm": join(process.cwd(), "node_modules/@raptorqr/core/node_modules/zxing-wasm/dist/writer/zxing_writer.wasm"),
  "raptorqr_raptorq_wasm_bg.wasm": join(process.cwd(), "node_modules/@raptorqr/raptorq-wasm/src/wasm/raptorqr_raptorq_wasm_bg.wasm"),
  "raptorqr_fast_qr_wasm_bg.wasm": join(process.cwd(), "node_modules/@raptorqr/fast-qr-wasm/src/wasm/raptorqr_fast_qr_wasm_bg.wasm"),
};

globalThis.fetch = (async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const entry = Object.entries(paths).find(([name]) => url.includes(name));
  if (!entry) return originalFetch(input, init);
  const explicit = url.includes("/@fs/") ? normalize(decodeURIComponent(url.split("/@fs/")[1]!)) : entry[1];
  const local = existsSync(explicit) ? explicit : entry[1];
  const bytes = await readFile(local);
  return new Response(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { headers: { "Content-Type": "application/wasm" } });
}) as typeof globalThis.fetch;
