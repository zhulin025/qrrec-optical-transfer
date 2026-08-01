import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

// HTTPS always: the receiver needs getUserMedia, and on insecure origins
// that API does not exist at all — a phone reaching this server over the LAN
// gets no camera on plain http (browser rule, localhost-only exemption).
// The generated cert is self-signed: tap through the warning once on the
// phone and the page is still a secure context, so the camera works.
export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        send: resolve(__dirname, "send/index.html"),
        receive: resolve(__dirname, "receive/index.html"),
      },
    },
  },
  server: { host: true },
});
