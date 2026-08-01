// QR decode worker: zxing-cpp compiled to WASM. (Safari has never shipped
// BarcodeDetector — WebKit bug 281848 — so WASM is the only portable way.)
// One frame in flight per worker; the main thread drops frames when all
// workers are busy. Frames are disposable — the fountain doesn't care.

// Web builds keep WASM as a separate browser-cacheable asset. Inlining it as
// Base64 makes the worker large and can exceed the startup timeout on mobile
// networks. The XHS main-thread build still uses the generated inline module.
import wasmUrl from "../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm?url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const moduleReady = Promise.resolve(prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
  // Without this flag prepareZXingModule only stores the overrides and does
  // not instantiate the decoder. The readiness message would therefore not
  // prove that WASM can actually run on the device.
  fireImmediately: true,
}));

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = async (e: MessageEvent) => {
  const { id, buf, w, h } = e.data as { id: number; buf: ArrayBuffer; w: number; h: number };
  try {
    const img = new ImageData(new Uint8ClampedArray(buf), w, h);
    const results = await readBarcodes(img, { formats: ["QRCode"], maxNumberOfSymbols: 1 });
    const r = results.find((x) => x.isValid && x.bytes.length > 0);
    ctx.postMessage({ id, bytes: r ? r.bytes : null });
  } catch {
    ctx.postMessage({ id, bytes: null });
  }
};

// Report readiness only after the real ZXing WebAssembly module has loaded.
void moduleReady
  .then(() => ctx.postMessage({ id: -1, bytes: null, ready: true }))
  .catch((error: unknown) =>
    ctx.postMessage({
      id: -1,
      bytes: null,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
