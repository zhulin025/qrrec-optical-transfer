import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "send"),
  base: "./",
  publicDir: false,
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/web-receiver/send"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "send/index.html"),
      output: {
        entryFileNames: "app.js",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "styles.css" : "assets/[name][extname]",
      },
    },
  },
});
