import { renderQRCodeImageData } from "@raptorqr/core/qr/qr_encoder_browser";

self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type !== "render") return;
  void (async () => {
    try {
      const image = await renderQRCodeImageData(
        new Uint8Array(message.packet),
        message.version,
        message.ecc,
        message.scale,
        "fast-qr-wasm",
      );
      const buffer = image.data.buffer as ArrayBuffer;
      self.postMessage({ type: "rendered", id: message.id, width: image.width, height: image.height, buffer }, [buffer]);
    } catch (error) {
      self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
