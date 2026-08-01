import { defineConfig } from "vite";
import { resolve } from "node:path";
import { copyFileSync } from "node:fs";

const runtimeFiles = [
  "runtime-send.html",
  "cimbar_js.2026-07-13T0523.js",
  "cimbar_js.2026-07-13T0523.wasm",
  "send-worker.2026-07-13T0523.js",
  "send.2026-07-13T0523.js",
  "main.2026-07-13T0523.js",
];

export default defineConfig({
  root: resolve(__dirname, "v5/send"),
  base: "./",
  publicDir: false,
  plugins: [{
    name: "copy-libcimbar-runtime",
    writeBundle(options) {
      const output = String(options.dir);
      for (const file of runtimeFiles) copyFileSync(resolve(__dirname, "v5/send", file), resolve(output, file));
    },
  }],
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/v5/sender"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "v5/send/index.html"),
      output: { entryFileNames: "app.js", assetFileNames: (asset) => asset.name?.endsWith(".css") ? "styles.css" : "assets/[name][extname]" },
    },
  },
});
