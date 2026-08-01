import { defineConfig } from "vite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const outDir = resolve(__dirname, "release/xhs-receiver-full");

export default defineConfig({
  root: resolve(__dirname, "receive"),
  base: "./",
  publicDir: false,
  define: {
    __XHS_MAIN_THREAD__: "false",
  },
  worker: {
    rollupOptions: {
      output: {
        entryFileNames: "decoder-worker.js",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".wasm") ? "zxing-reader.wasm" : "assets/[name][extname]",
      },
    },
  },
  plugins: [{
    name: "write-experimental-xhs-manifest",
    closeBundle() {
      writeFileSync(
        resolve(outDir, "xhs-package.json"),
        JSON.stringify({
          output: "decimen-xhs-receiver-full.zip",
          files: ["index.html", "styles.css", "app.js", "decoder-worker.js", "zxing-reader.wasm"],
          scanFiles: ["index.html", "styles.css", "app.js", "decoder-worker.js"],
          extraExtensions: [".wasm"],
          allowedCapabilities: ["workers or wasm", "runtime network API", "file download"],
          maxBytes: 52428800,
        }, null, 2) + "\n",
      );
    },
  }],
  build: {
    modulePreload: { polyfill: false },
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "receive/index.html"),
      output: {
        entryFileNames: "app.js",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "styles.css" :
          asset.name?.endsWith(".wasm") ? "zxing-reader.wasm" :
          "assets/[name][extname]",
      },
    },
  },
});
