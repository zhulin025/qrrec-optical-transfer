import { defineConfig } from "vite";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
export default defineConfig({ plugins: [basicSsl()], root: resolve(__dirname, "v6/send"), base: "./", publicDir: false, server: { host: "0.0.0.0" }, preview: { host: "0.0.0.0" }, build: { outDir: resolve(__dirname, "release/web-receiver/v6/send"), emptyOutDir: true, sourcemap: false, rollupOptions: { input: resolve(__dirname, "v6/send/index.html"), output: { entryFileNames: "app.js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" } } } });
