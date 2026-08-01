import { defineConfig } from "vite";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const outDir = resolve(__dirname, "release/xhs-receiver-main-thread-wasm");

export default defineConfig({
  root: resolve(__dirname, "receive"),
  base: "./",
  publicDir: false,
  define: {
    __XHS_MAIN_THREAD__: "true",
  },
  worker: {
    rollupOptions: {
      output: { entryFileNames: "decoder-worker.js" },
    },
  },
  plugins: [
    {
      name: "remove-worker-code-for-xhs-main-thread-build",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith("/receive/main.ts")) return;
        return code.replace(
          /\s*\/\* XHS_WORKER_BEGIN \*\/[\s\S]*?\/\* XHS_WORKER_END \*\//,
          "",
        );
      },
    },
    {
      name: "write-inline-wasm-xhs-manifest",
      closeBundle() {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          resolve(outDir, "xhs-package.json"),
          JSON.stringify({
            output: "decimen-xhs-receiver-main-thread-wasm.zip",
            files: ["index.html", "styles.css", "app.js"],
            scanFiles: ["index.html", "styles.css", "app.js"],
            allowedCapabilities: ["workers or wasm", "runtime network API", "file download"],
            maxBytes: 52428800,
          }, null, 2) + "\n",
        );
      },
    },
  ],
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
          asset.name?.endsWith(".css") ? "styles.css" : "assets/[name][extname]",
      },
    },
  },
});
