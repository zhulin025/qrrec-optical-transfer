import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "receive"),
  base: "./",
  publicDir: resolve(__dirname, "receive/public"),
  define: {
    __XHS_MAIN_THREAD__: "false",
  },
  build: {
    outDir: resolve(__dirname, "release/web-receiver"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: resolve(__dirname, "receive/index.html") },
  },
});
