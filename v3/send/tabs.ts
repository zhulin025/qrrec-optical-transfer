export {};

const nav = document.querySelector<HTMLElement>(".v3-mode-nav")!;
const scripts = new Set([...document.querySelectorAll("body > script")]);
const qrPanel = document.createElement("section");
qrPanel.className = "v3-tab-panel";
qrPanel.dataset.panel = "qr";

for (const node of [...document.body.children]) {
  if (node === nav || node.matches("header") || scripts.has(node as HTMLScriptElement)) continue;
  qrPanel.append(node);
}
nav.after(qrPanel);

const colorPanel = document.createElement("section");
colorPanel.className = "v3-tab-panel";
colorPanel.dataset.panel = "color";
colorPanel.hidden = true;
colorPanel.innerHTML = `
  <section class="file-card color-file-card">
    <input id="color-file" type="file" />
    <label for="color-file" class="file-pick"><span class="file-icon">＋</span><span><strong>选择要发送的文件</strong><small>使用彩色矩阵高速发送，文件不会上传网络</small></span></label>
    <div id="color-file-info" class="file-info">尚未选择文件</div>
  </section>
  <div class="hint" id="color-specs">选择文件后开始生成彩色矩阵</div>
  <details class="settings">
    <summary>传输设置</summary>
    <div class="row">
      <label>播放帧率<select id="color-fps"><option>5</option><option>10</option><option selected>15</option><option>20</option></select></label>
      <label>矩阵模式<select id="color-mode"><option value="B" selected>标准</option><option value="Bm">均衡</option><option value="Bu">稳健</option><option value="4C">四色</option></select></label>
    </div>
    <div class="hint left">默认设置适合大多数屏幕。识别困难时可降低播放帧率或选择稳健模式。</div>
  </details>
  <div class="receiver-link"><span>接收端：</span><a href="../">qrrec.liuwa.xyz/v3</a></div>
  <div class="stage-wrap" id="color-stage-wrap" style="display:none"><div class="stage color-runtime"><iframe title="彩色矩阵发送画面" data-src="../color/runtime-send.html?v=1"></iframe></div></div>
  <p class="hint">请使用 V3 接收器的“彩色矩阵”模式扫描。保持矩阵完整显示，并将发送屏幕亮度调高。</p>
`;
qrPanel.after(colorPanel);

const frame = colorPanel.querySelector<HTMLIFrameElement>("iframe")!;
const file = colorPanel.querySelector<HTMLInputElement>("#color-file")!;
const info = colorPanel.querySelector<HTMLElement>("#color-file-info")!;
const colorSpecs = colorPanel.querySelector<HTMLElement>("#color-specs")!;
const colorFps = colorPanel.querySelector<HTMLSelectElement>("#color-fps")!;
const colorMode = colorPanel.querySelector<HTMLSelectElement>("#color-mode")!;
const colorStage = colorPanel.querySelector<HTMLElement>("#color-stage-wrap")!;
let pending: File | null = null;

function configureRuntime() {
  const runtime = frame.contentWindow as (Window & { Main?: { setFPS(value: string): void; setMode(value: string): void } }) | null;
  runtime?.Main?.setFPS(colorFps.value);
  runtime?.Main?.setMode(colorMode.value);
}

function sendFile() {
  if (!pending || !frame.contentDocument) return;
  const target = frame.contentDocument.querySelector<HTMLInputElement>("#file_input");
  if (!target) return;
  const transfer = new DataTransfer();
  transfer.items.add(pending);
  target.files = transfer.files;
  target.dispatchEvent(new Event("change", { bubbles: true }));
}
frame.addEventListener("load", () => {
  if (frame.src === "about:blank") return;
  setTimeout(() => { configureRuntime(); sendFile(); }, 200);
});
colorFps.addEventListener("change", configureRuntime);
colorMode.addEventListener("change", configureRuntime);
file.addEventListener("change", () => {
  pending = file.files?.[0] ?? null;
  info.textContent = pending ? `${pending.name} · ${(pending.size / 1024).toFixed(pending.size < 1024 * 1024 ? 0 : 1)} KB` : "尚未选择文件";
  colorSpecs.textContent = pending ? `${colorMode.selectedOptions[0]?.textContent}模式 · ${colorFps.value} FPS · 本地光学传输` : "选择文件后开始生成彩色矩阵";
  colorStage.style.display = pending ? "block" : "none";
  sendFile();
});

function select(tab: "qr" | "color") {
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.classList.toggle("active", button.dataset.v3Tab === tab));
  qrPanel.hidden = tab !== "qr";
  colorPanel.hidden = tab !== "color";
  if (tab === "color") {
    window.dispatchEvent(new Event("qrrec:pause-sender"));
    if (!frame.getAttribute("src")) frame.src = frame.dataset.src!;
  } else {
    if (frame.getAttribute("src")) { frame.src = "about:blank"; frame.removeAttribute("src"); }
    window.dispatchEvent(new Event("qrrec:resume-sender"));
  }
}
nav.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-v3-tab]");
  if (button) select(button.dataset.v3Tab as "qr" | "color");
});

select("color");
