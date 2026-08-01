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
  <div class="hint status-pill" id="color-stats">准备接收彩色矩阵</div>
  <section class="capabilities" aria-label="彩色矩阵运行能力">
    <div class="${window.isSecureContext ? "pass" : "fail"}"><span></span><small>安全环境</small><b>${window.isSecureContext ? "通过" : "需要 HTTPS"}</b></div>
    <div id="color-cap-camera"><span></span><small>摄像头</small><b>待启动</b></div>
    <div id="color-cap-worker"><span></span><small>Worker</small><b>待启动</b></div>
    <div id="color-cap-wasm"><span></span><small>WASM</small><b>待加载</b></div>
  </section>
  <button id="color-start" type="button">开启摄像头接收</button>
  <p class="hint">首次使用会申请摄像头权限。请让彩色矩阵完整进入取景框，并保持画面稳定、无反光。</p>
  <div class="metrics" id="color-metrics" style="display:none">
    <div class="metric"><div class="k">接收状态</div><div class="v amber" id="color-state">等待矩阵</div></div>
    <div class="metric"><div class="k">解码帧数</div><div class="v" id="color-frames">0</div></div>
    <div class="metric"><div class="k">接收数据</div><div class="v" id="color-bytes">0 KB</div></div>
    <div class="metric"><div class="k">传输进度</div><div class="v amber" id="color-percent">0%</div></div>
  </div>
  <div class="preview" id="color-preview" style="display:none">
    <div class="color-runtime"><iframe title="彩色矩阵接收画面" allow="camera; fullscreen; screen-wake-lock" data-src="./color/runtime-recv.html?v=1"></iframe></div>
    <div class="scan-guide"><span></span></div>
  </div>
  <section class="transfer-progress" id="color-progress" style="display:none">
    <div class="progress-copy"><div><strong>正在接收</strong><span id="color-progress-copy">等待有效数据</span></div><b id="color-progress-value">0%</b></div>
    <div class="progress"><div id="color-bar"></div></div>
  </section>
  <div id="color-result"></div>
`;
qrPanel.after(colorPanel);

const frame = colorPanel.querySelector<HTMLIFrameElement>("iframe")!;
const start = colorPanel.querySelector<HTMLButtonElement>("#color-start")!;
const stats = colorPanel.querySelector<HTMLElement>("#color-stats")!;
const preview = colorPanel.querySelector<HTMLElement>("#color-preview")!;
const metrics = colorPanel.querySelector<HTMLElement>("#color-metrics")!;
const progress = colorPanel.querySelector<HTMLElement>("#color-progress")!;
let frames = 0;
let bytes = 0;

function capability(id: string, state: "pass" | "fail", label: string) {
  const el = colorPanel.querySelector<HTMLElement>(`#${id}`)!;
  el.classList.remove("pass", "fail");
  el.classList.add(state);
  el.querySelector("b")!.textContent = label;
}

start.addEventListener("click", () => {
  start.style.display = "none";
  preview.style.display = "block";
  metrics.style.display = "grid";
  stats.textContent = "正在加载彩色矩阵解码器…";
  capability("color-cap-worker", "pass", "启动中");
  if (!frame.getAttribute("src")) frame.src = frame.dataset.src!;
});

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.source !== "qrrec-color") return;
  const message = event.data;
  if (message.type === "runtime-ready") {
    capability("color-cap-worker", "pass", "已启动");
    capability("color-cap-wasm", "pass", "已加载");
    stats.textContent = "解码器已就绪，正在申请摄像头";
  } else if (message.type === "camera-ready") {
    capability("color-cap-camera", "pass", "通过");
    stats.textContent = `摄像头 ${message.width}×${message.height} · 等待彩色矩阵`;
  } else if (message.type === "decoded-frame") {
    frames++;
    bytes += Number(message.bytes) || 0;
    colorPanel.querySelector("#color-state")!.textContent = "正在接收";
    colorPanel.querySelector("#color-frames")!.textContent = String(frames);
    colorPanel.querySelector("#color-bytes")!.textContent = `${(bytes / 1024).toFixed(1)} KB`;
    progress.style.display = "block";
  } else if (message.type === "progress") {
    const values = Array.isArray(message.values) ? message.values.map(Number) : [];
    const percent = values.length ? Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length * 100) : 0;
    colorPanel.querySelector("#color-percent")!.textContent = `${percent}%`;
    colorPanel.querySelector("#color-progress-value")!.textContent = `${percent}%`;
    colorPanel.querySelector<HTMLElement>("#color-bar")!.style.width = `${percent}%`;
    colorPanel.querySelector("#color-progress-copy")!.textContent = `${values.length} 个数据流`;
  } else if (message.type === "complete") {
    stats.textContent = `接收完成 · ${message.name}`;
    colorPanel.querySelector("#color-state")!.textContent = "接收完成";
    colorPanel.querySelector<HTMLElement>("#color-bar")!.style.width = "100%";
    colorPanel.querySelector("#color-percent")!.textContent = "100%";
    colorPanel.querySelector("#color-progress-value")!.textContent = "100%";
  } else if (message.type === "runtime-error") {
    capability("color-cap-wasm", "fail", "加载失败");
    stats.textContent = `彩色矩阵解码器加载失败：${message.reason || "未知错误"}`;
  }
});

function stopColor() {
  if (frame.getAttribute("src")) {
    frame.src = "about:blank";
    frame.removeAttribute("src");
  }
  preview.style.display = "none";
  start.style.display = "block";
}

function select(tab: "qr" | "color") {
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.classList.toggle("active", button.dataset.v3Tab === tab));
  qrPanel.hidden = tab !== "qr";
  colorPanel.hidden = tab !== "color";
  if (tab === "color") window.dispatchEvent(new Event("qrrec:pause"));
  else stopColor();
}

nav.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-v3-tab]");
  if (button) select(button.dataset.v3Tab as "qr" | "color");
});

select("color");
