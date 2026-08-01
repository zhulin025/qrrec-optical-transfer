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
  <div class="color-intro">
    <div class="hint status-pill">彩色矩阵接收模式</div>
    <p class="hint">对准 V3 发送端的彩色矩阵，保持画面完整、稳定且无反光。文件仍只在两台设备之间传输。</p>
  </div>
  <div class="color-runtime"><iframe title="彩色矩阵接收画面" allow="camera; fullscreen; screen-wake-lock" data-src="./color/recv.html?embed=1"></iframe></div>
`;
qrPanel.after(colorPanel);

const frame = colorPanel.querySelector<HTMLIFrameElement>("iframe")!;
function select(tab: "qr" | "color") {
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.classList.toggle("active", button.dataset.v3Tab === tab));
  qrPanel.hidden = tab !== "qr";
  colorPanel.hidden = tab !== "color";
  if (tab === "color") {
    window.dispatchEvent(new Event("qrrec:pause"));
    if (!frame.getAttribute("src")) frame.src = frame.dataset.src!;
  } else if (frame.getAttribute("src")) {
    frame.src = "about:blank";
    frame.removeAttribute("src");
  }
}
nav.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-v3-tab]");
  if (button) select(button.dataset.v3Tab as "qr" | "color");
});
