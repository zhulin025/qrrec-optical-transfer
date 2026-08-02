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
  plugins: [
    {
      name: "v51-native-sender-page",
      transformIndexHtml(html) {
        return html
          .replaceAll("QRREC V5", "QRREC V5.1")
          .replaceAll("发送器 V5", "发送器 V5.1")
          .replace("<option selected>15</option><option>20</option>", "<option>15</option><option selected>20</option>")
          .replace("请使用 QRREC V5.1 iOS App", "请使用 QRREC V5.1 原生 iOS App")
          .replace("保持矩阵完整显示，并将发送屏幕亮度调高。", "建议配合 20 FPS 与 V5.1 的 60 FPS 相机模式；不稳定时可降回 15 FPS。")
          .replace("data-runtime-src=\"./runtime-send.html?v=6\"", "data-runtime-src=\"./runtime-send.html?v=7\"");
      },
      writeBundle(options) {
        const output = String(options.dir);
        for (const file of runtimeFiles) copyFileSync(resolve(__dirname, "v5/send", file), resolve(output, file));
      },
    },
  ],
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/web-receiver/v5.1/send"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "v5/send/index.html"),
      output: {
        entryFileNames: "app.js",
        assetFileNames: (asset) => asset.name?.endsWith(".css") ? "styles.css" : "assets/[name][extname]",
      },
    },
  },
});
