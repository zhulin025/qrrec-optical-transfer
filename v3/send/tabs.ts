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
  <div class="hint">选择文件后，下方会生成并循环播放彩色矩阵码。</div>
  <div class="color-runtime"><iframe title="彩色矩阵发送画面" data-src="../color/?embed=1"></iframe></div>
  <p class="hint">请在接收端切换到“彩色矩阵”模式，并保持矩阵完整显示。</p>
`;
qrPanel.after(colorPanel);

const frame = colorPanel.querySelector<HTMLIFrameElement>("iframe")!;
const file = colorPanel.querySelector<HTMLInputElement>("#color-file")!;
const info = colorPanel.querySelector<HTMLElement>("#color-file-info")!;
let pending: File | null = null;

function sendFile() {
  if (!pending || !frame.contentDocument) return;
  const target = frame.contentDocument.querySelector<HTMLInputElement>("#file_input");
  if (!target) return;
  const transfer = new DataTransfer();
  transfer.items.add(pending);
  target.files = transfer.files;
  target.dispatchEvent(new Event("change", { bubbles: true }));
}
frame.addEventListener("load", () => { if (frame.src !== "about:blank") setTimeout(sendFile, 150); });
file.addEventListener("change", () => {
  pending = file.files?.[0] ?? null;
  info.textContent = pending ? `${pending.name} · ${(pending.size / 1024).toFixed(pending.size < 1024 * 1024 ? 0 : 1)} KB` : "尚未选择文件";
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
