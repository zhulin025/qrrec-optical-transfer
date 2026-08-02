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

const fullscreenStyles = `
      body.session-active{overflow:hidden;background:#fff}
      body.session-active>.app-header,
      body.session-active>.v5-badge,
      body.session-active>.file-card,
      body.session-active>#specs,
      body.session-active>.settings,
      body.session-active>.native-note{display:none!important}
      body.session-active>#runtime-wrap{position:fixed;inset:0;z-index:1000;width:100vw;height:100dvh;margin:0;padding:0;background:#fff}
      body.session-active>#runtime-wrap.stage-wrap{display:block}
      body.session-active>#runtime-wrap .stage{width:100%;height:100%;margin:0;padding:0;border:0;border-radius:0;background:#fff}
      body.session-active>#runtime-wrap .color-runtime{width:100vw;height:100dvh;max-width:none;max-height:none;border:0;border-radius:0;box-shadow:none}
      body.session-active>#session-button{position:fixed;z-index:1100;top:max(14px,env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));width:auto;min-width:116px;padding:11px 17px;border:1px solid rgba(255,255,255,.55);border-radius:999px;box-shadow:0 5px 22px rgba(0,0,0,.35);opacity:.82}
      body.session-active>#session-button:hover{opacity:1}
`;

export default defineConfig({
  root: resolve(__dirname, "v5/send"),
  base: "./",
  publicDir: false,
  plugins: [
    {
      name: "v52-fullscreen-sender-page",
      transformIndexHtml(html) {
        return html
          .replaceAll("QRREC V5", "QRREC V5.2")
          .replaceAll("发送器 V5", "发送器 V5.2")
          .replace("<option selected>15</option><option>20</option>", "<option>15</option><option selected>20</option>")
          .replace("<body>", '<body data-fullscreen-sender="true">')
          .replace("</style>", `${fullscreenStyles}    </style>`)
          .replace("请使用 QRREC V5.2 iOS App", "请使用 QRREC V5.1/V5.2 原生 iOS App")
          .replace("保持矩阵完整显示，并将发送屏幕亮度调高。", "开始后将自动进入全屏光码模式；请让矩阵完整进入取景框。")
          .replace('data-runtime-src="./runtime-send.html?v=6"', 'data-runtime-src="./runtime-send.html?v=8"');
      },
      writeBundle(options) {
        const output = String(options.dir);
        for (const file of runtimeFiles) copyFileSync(resolve(__dirname, "v5/send", file), resolve(output, file));
      },
    },
  ],
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/web-receiver/v5.2/send"),
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
