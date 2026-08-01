// QR decode worker: zxing-cpp compiled to WASM. (Safari has never shipped
// BarcodeDetector — WebKit bug 281848 — so WASM is the only portable way.)
// One frame in flight per worker; the main thread drops frames when all
// workers are busy. Frames are disposable — the fountain doesn't care.

// Keep WASM separate on the web so the worker starts quickly and the binary
// can be cached independently. Standalone `.wasm` is only forbidden by the
// XHS package uploader, not by browsers or Vercel.
import wasmUrl from "../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm?url";
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
    const results = await readBarcodes(img, {
      formats: ["QRCode"],
      maxNumberOfSymbols: 2,
      tryDenoise: true,
      tryDownscale: false,
    });
    const decoded = results
      .filter((result) => result.isValid && result.bytes.length > 0)
      .map((result) => ({ bytes: result.bytes, position: result.position }));
    ctx.postMessage({ id, decoded });
  } catch {
    ctx.postMessage({ id, decoded: [] });
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
