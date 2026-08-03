import { defineConfig } from "vite";
import { resolve } from "node:path";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const runtimeFiles = [
  "runtime-send.html",
  "cimbar_js.2026-07-13T0523.js",
  "cimbar_js.2026-07-13T0523.wasm",
  "send-worker.2026-07-13T0523.js",
  "send.2026-07-13T0523.js",
  "main.2026-07-13T0523.js",
];
const sharedStyles = readFileSync(resolve(__dirname, "shared/style.css"), "utf8");

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
`;

export default defineConfig({
  root: resolve(__dirname, "v5/send"),
  base: "./",
  publicDir: false,
  plugins: [{
    name: "v53-maximum-compression-sender",
    transform(code, id) {
      if (!id.endsWith("/v5/send/main.ts")) return;
      return code
        .replace("libcimbar 本地光学传输", "Zstandard 22 级无损压缩 · libcimbar 光学传输")
        .replace("正在初始化 libcimbar 编码器…", "正在进行最高等级无损压缩预处理…");
    },
    transformIndexHtml(html) {
      return html
        .replace('<link rel="stylesheet" href="../../shared/style.css" />', `<style>${sharedStyles}</style>`)
        .replaceAll("QRREC V5", "QRREC V5.3")
        .replaceAll("发送器 V5", "发送器 V5.3")
        .replace("<option selected>15</option><option>20</option>", "<option>15</option><option selected>20</option>")
        .replace("<body>", '<body data-fullscreen-sender="true">')
        .replace("</style>", `${fullscreenStyles}    </style>`)
        .replace("文件始终留在本机。", "发送前使用 Zstandard 22 级进行最高强度无损压缩，接收完成后自动解压；文件始终留在本机。")
        .replace("请使用 QRREC V5.3 iOS App", "请使用 QRREC V5.1/V5.3 原生 iOS App")
        .replace("保持矩阵完整显示，并将发送屏幕亮度调高。", "文本、文档和未压缩数据收益最大；图片、视频及 ZIP 可能几乎无法继续压缩。")
        .replace('data-runtime-src="./runtime-send.html?v=6"', 'data-runtime-src="./runtime-send.html?v=9"');
    },
    writeBundle(options) {
      const output = String(options.dir);
      for (const file of runtimeFiles) copyFileSync(resolve(__dirname, "v5/send", file), resolve(output, file));

      // libcimbar exposes compression level through cimbare_configure().
      // 22 is the strongest level accepted by the bundled zstd runtime.
      const senderRuntime = resolve(output, "send.2026-07-13T0523.js");
      const source = readFileSync(senderRuntime, "utf8");
      const patched = source.replace(
        "Module._cimbare_configure(mode_val, -1);",
        "Module._cimbare_configure(mode_val, 22);",
      );
      if (patched === source) throw new Error("Unable to enable V5.3 zstd level 22");
      writeFileSync(senderRuntime, patched);
    },
  }],
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/web-receiver/v5.3/send"),
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
