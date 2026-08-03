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

const opticalStyles = `
      body.session-active{overflow:hidden;background:#000}
      body.session-active>.app-header,
      body.session-active>.v5-badge,
      body.session-active>.file-card,
      body.session-active>#specs,
      body.session-active>.settings,
      body.session-active>.native-note{display:none!important}
      body.session-active>#runtime-wrap{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;width:100vw;height:100dvh;margin:0;padding:0;background:#000;cursor:pointer}
      body.session-active>#runtime-wrap .stage{width:min(92vw,92dvh);height:min(92vw,92dvh);margin:0;padding:0;border:0;border-radius:0;background:#fff;box-shadow:0 0 0 2px #fff;cursor:default}
      body.session-active>#runtime-wrap .color-runtime{max-width:none;max-height:none;overflow:hidden}
      body.session-active>#runtime-wrap iframe{width:100%;height:100%;border:0}
      body.session-active>#session-button{position:fixed;z-index:1100;top:max(5px,env(safe-area-inset-top));right:max(5px,env(safe-area-inset-right));width:32px;height:32px;min-width:0;padding:0;border:1px solid #444;border-radius:50%;overflow:hidden;color:#fff;background:#111;box-shadow:none;font-size:0;opacity:.8;animation:v54-hide-control .2s ease 2.5s forwards}
      body.session-active>#session-button::after{content:'×';font-size:22px;line-height:1}
      @keyframes v54-hide-control{to{opacity:0;visibility:hidden;pointer-events:none}}
`;

function replaceRequired(source: string, from: string, to: string, label: string) {
  const patched = source.replace(from, to);
  if (patched === source) throw new Error(`Unable to apply V5.4 runtime patch: ${label}`);
  return patched;
}

export default defineConfig({
  root: resolve(__dirname, "v5/send"),
  base: "./",
  publicDir: false,
  plugins: [{
    name: "v54-optical-condition-sender",
    transform(code, id) {
      if (!id.endsWith("/v5/send/main.ts")) return;
      return `${code
        .replace("libcimbar 本地光学传输", "zstd 22 · 92% 安全取景 · 1 秒首帧校准")
        .replace("正在初始化 libcimbar 编码器…", "正在压缩并准备首帧校准…")}

wrap.addEventListener("click", (event) => {
  if (active && event.target === wrap) void endSession();
});`;
    },
    transformIndexHtml(html) {
      return html
        .replace('<link rel="stylesheet" href="../../shared/style.css" />', `<style>${sharedStyles}</style>`)
        .replaceAll("QRREC V5", "QRREC V5.4")
        .replaceAll("发送器 V5", "发送器 V5.4")
        .replace("<option selected>15</option><option>20</option>", "<option>15</option><option selected>20</option>")
        .replace("<body>", '<body data-fullscreen-sender="true">')
        .replace("</style>", `${opticalStyles}    </style>`)
        .replace("文件始终留在本机。", "在 V5.3 高压缩基础上增加无视觉遮挡、安全取景边框和首帧校准；文件始终留在本机。")
        .replace("请使用 QRREC V5.4 iOS App", "请使用 QRREC V5.1 原生 iOS App（兼容 V5.4）")
        .replace("保持矩阵完整显示，并将发送屏幕亮度调高。", "光码周围保留黑色安全区；控制按钮会自动隐藏，点击黑色边缘可结束传输。")
        .replace('data-runtime-src="./runtime-send.html?v=6"', 'data-runtime-src="./runtime-send.html?v=10"');
    },
    writeBundle(options) {
      const output = String(options.dir);
      for (const file of runtimeFiles) copyFileSync(resolve(__dirname, "v5/send", file), resolve(output, file));

      const senderRuntime = resolve(output, "send.2026-07-13T0523.js");
      let source = readFileSync(senderRuntime, "utf8");
      source = replaceRequired(
        source,
        "  var _wakeLock = undefined;",
        "  var _wakeLock = undefined;\n  var _calibrationFrames = 0;",
        "calibration counter",
      );
      source = replaceRequired(
        source,
        "      if (res == 0) {\n        Report.setActive();",
        "      if (res == 0) {\n        _calibrationFrames = Math.max(1, Math.round(1000 / _interval));\n        Report.setActive();",
        "one-second calibration",
      );
      source = replaceRequired(
        source,
        "        Module._cimbare_render();\n        var frameCount = Module._cimbare_next_frame(_colorBalance);",
        "        var rendered = Module._cimbare_render();\n        var frameCount;\n        if (rendered > 0 && _calibrationFrames > 0) {\n          _calibrationFrames -= 1;\n          frameCount = 1;\n        } else {\n          frameCount = Module._cimbare_next_frame(_colorBalance);\n        }",
        "hold first frame",
      );
      source = replaceRequired(
        source,
        "Module._cimbare_configure(mode_val, -1);",
        "Module._cimbare_configure(mode_val, 22);",
        "zstd level 22",
      );
      writeFileSync(senderRuntime, source);
    },
  }],
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/web-receiver/v5.4/send"),
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
