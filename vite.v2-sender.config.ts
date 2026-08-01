import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "v2/send"),
  base: "./",
  publicDir: false,
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/web-receiver/v2/send"),
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "v2/send/index.html"),
      output: {
        entryFileNames: "app.js",
        assetFileNames: (asset) => asset.name?.endsWith(".css") ? "styles.css" : "assets/[name][extname]",
      },
    },
  },
});
