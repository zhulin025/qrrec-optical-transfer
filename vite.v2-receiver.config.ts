import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "v2/receive"),
  base: "./",
  publicDir: resolve(__dirname, "v2/receive/public"),
  define: { __XHS_MAIN_THREAD__: "false" },
  build: {
    outDir: resolve(__dirname, "release/web-receiver/v2"),
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: { input: resolve(__dirname, "v2/receive/index.html") },
  },
});
