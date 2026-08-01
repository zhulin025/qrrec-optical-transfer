import { defineConfig } from "vite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

export default defineConfig({
  root: resolve(__dirname, "send"),
  base: "./",
  publicDir: false,
  define: {
    __RECEIVER_URL__: JSON.stringify("https://qrrec.liuwa.xyz/"),
    __ENABLE_PWA__: "false",
    __ALLOW_RECEIVER_NAV__: "false",
  },
  plugins: [
    {
      name: "xhs-offline-html",
      transformIndexHtml(html) {
        return html
          .replace(/\s*<link rel="manifest"[^>]*>/, "")
          .replace(/\s*<link rel="icon"[^>]*>/, "")
          .replace("<body>", '<body class="xhs-tool">')
          .replace('id="receiver-link" href="https://qrrec.liuwa.xyz/"', 'id="receiver-link" href="#"');
      },
    },
    {
      name: "write-xhs-manifest",
      closeBundle() {
        writeFileSync(
          resolve(__dirname, "release/xhs-sender/xhs-package.json"),
          JSON.stringify({
            output: "decimen-xhs-sender.zip",
            files: ["index.html", "styles.css", "app.js"],
            scanFiles: ["index.html", "styles.css", "app.js"],
            maxBytes: 52428800,
          }, null, 2) + "\n",
        );
      },
    },
  ],
  build: {
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "release/xhs-sender"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "send/index.html"),
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: (asset) => asset.name?.endsWith(".css") ? "styles.css" : "assets/[name][extname]",
      },
    },
  },
});
