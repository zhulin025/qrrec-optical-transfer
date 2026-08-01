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
    <div class="metric"><div class="k">传输速率</div><div class="v amber" id="color-rate">—</div></div>
    <div class="metric"><div class="k">已用时间</div><div class="v" id="color-time">—</div></div>
    <div class="metric"><div class="k">传输进度</div><div class="v amber" id="color-percent">0%</div></div>
  </div>
  <div class="preview" id="color-preview" style="display:none">
    <div class="color-runtime"><iframe title="彩色矩阵接收画面" allow="camera; fullscreen; screen-wake-lock" data-src="./color/runtime-recv.html?v=1"></iframe></div>
    <div class="scan-guide"><span></span></div>
  </div>
  <section class="transfer-progress" id="color-progress" style="display:none">
    <div class="progress-copy"><div><strong>正在接收</strong><span id="color-progress-copy">等待有效数据</span></div><b id="color-progress-value">0%</b></div>
    <div class="progress"><div id="color-bar"></div></div>
    <div class="frame-pulses" id="color-frame-pulses" aria-label="最近收到的数据帧"></div>
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
let colorRuntimeReady = false;
let colorDone = false;
let colorStartedAt = 0;
let colorResultUrl = "";
const pulseContainer = colorPanel.querySelector<HTMLElement>("#color-frame-pulses")!;
const pulses = Array.from({ length: 24 }, () => pulseContainer.appendChild(document.createElement("span")));
let pulseIndex = 0;

function capability(id: string, state: "pass" | "fail", label: string) {
  const el = colorPanel.querySelector<HTMLElement>(`#${id}`)!;
  el.classList.remove("pass", "fail");
  el.classList.add(state);
  el.querySelector("b")!.textContent = label;
}

start.addEventListener("click", () => {
  colorDone = false;
  frames = 0;
  bytes = 0;
  colorStartedAt = performance.now();
  pulseIndex = 0;
  pulses.forEach((pulse) => pulse.classList.remove("active"));
  start.style.display = "none";
  preview.style.display = "block";
  metrics.style.display = "grid";
  stats.textContent = "正在加载彩色矩阵解码器…";
  capability("color-cap-worker", "pass", "启动中");
  colorPanel.querySelector("#color-result")!.replaceChildren();
  progress.style.display = "none";
  colorPanel.querySelector("#color-state")!.textContent = "等待矩阵";
  colorPanel.querySelector("#color-frames")!.textContent = "0";
  colorPanel.querySelector("#color-bytes")!.textContent = "0 KB";
  colorPanel.querySelector("#color-rate")!.textContent = "—";
  colorPanel.querySelector("#color-time")!.textContent = "—";
  colorPanel.querySelector("#color-percent")!.textContent = "0%";
  colorPanel.querySelector("#color-progress-value")!.textContent = "0%";
  colorPanel.querySelector("#color-progress-copy")!.textContent = "等待有效数据";
  colorPanel.querySelector<HTMLElement>("#color-bar")!.style.width = "0%";
  if (!frame.getAttribute("src")) frame.src = frame.dataset.src!;
});

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.source !== "qrrec-color") return;
  const message = event.data;
  if (message.type === "runtime-ready") {
    colorRuntimeReady = true;
    capability("color-cap-worker", "pass", "已启动");
    capability("color-cap-wasm", "pass", "已加载");
    stats.textContent = "解码器已就绪，正在申请摄像头";
  } else if (message.type === "camera-ready") {
    capability("color-cap-camera", "pass", "通过");
    stats.textContent = `摄像头 ${message.width}×${message.height} · 等待彩色矩阵`;
  } else if (message.type === "decoded-frame") {
    if (colorDone) return;
    frames++;
    bytes += Number(message.bytes) || 0;
    const elapsed = Math.max(0.1, (performance.now() - colorStartedAt) / 1000);
    colorPanel.querySelector("#color-state")!.textContent = "正在接收";
    colorPanel.querySelector("#color-frames")!.textContent = String(frames);
    colorPanel.querySelector("#color-bytes")!.textContent = `${(bytes / 1024).toFixed(1)} KB`;
    colorPanel.querySelector("#color-rate")!.textContent = `${(bytes / 1024 / elapsed).toFixed(1)} KB/s`;
    colorPanel.querySelector("#color-time")!.textContent = `${elapsed.toFixed(1)} s`;
    const pulse = pulses[pulseIndex % pulses.length]!;
    pulse.classList.add("active");
    setTimeout(() => pulse.classList.remove("active"), 650);
    pulseIndex++;
    progress.style.display = "block";
  } else if (message.type === "progress") {
    const values = Array.isArray(message.values) ? message.values.map(Number) : [];
    const activeValues = values.filter((value: number) => value > 0);
    const percent = activeValues.length ? Math.min(99, Math.round(activeValues.reduce((a: number, b: number) => a + b, 0) / activeValues.length * 100)) : 0;
    colorPanel.querySelector("#color-percent")!.textContent = `${percent}%`;
    colorPanel.querySelector("#color-progress-value")!.textContent = `${percent}%`;
    colorPanel.querySelector<HTMLElement>("#color-bar")!.style.width = `${percent}%`;
    colorPanel.querySelector("#color-progress-copy")!.textContent = `${values.length} 个数据流`;
  } else if (message.type === "complete") {
    if (colorDone) return;
    colorDone = true;
    const elapsed = Math.max(0.1, (performance.now() - colorStartedAt) / 1000);
    const fileBytes = message.file instanceof ArrayBuffer ? new Uint8Array(message.file) : new Uint8Array();
    const finalBytes = fileBytes.length || Number(message.bytes) || bytes;
    const fileName = String(message.name || "received-file.bin");
    stats.textContent = `接收完成 · ${message.name}`;
    colorPanel.querySelector("#color-state")!.textContent = "接收完成";
    colorPanel.querySelector<HTMLElement>("#color-bar")!.style.width = "100%";
    colorPanel.querySelector("#color-percent")!.textContent = "100%";
    colorPanel.querySelector("#color-progress-value")!.textContent = "100%";
    colorPanel.querySelector("#color-progress-copy")!.textContent = "文件重组完成";
    colorPanel.querySelector("#color-rate")!.textContent = `${(finalBytes / 1024 / elapsed).toFixed(1)} KB/s`;
    colorPanel.querySelector("#color-time")!.textContent = `${elapsed.toFixed(1)} s`;
    preview.style.display = "none";
    renderColorResult(fileName, fileBytes);
  } else if (message.type === "runtime-error") {
    const startupFailure = !colorRuntimeReady || message.phase === "wasm" || message.phase === "startup";
    if (startupFailure) {
      capability("color-cap-wasm", "fail", "加载失败");
      stats.textContent = `彩色矩阵解码器加载失败：${message.reason || "未知错误"}`;
    } else {
      capability("color-cap-wasm", "pass", "已加载");
      stats.textContent = `彩色矩阵识别出错：${message.reason || "未知错误"}`;
    }
  }
});

function renderColorResult(fileName: string, fileBytes: Uint8Array) {
  const result = colorPanel.querySelector<HTMLElement>("#color-result")!;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v", ogv: "video/ogg",
  };
  const mime = types[extension] ?? "application/octet-stream";
  if (colorResultUrl) URL.revokeObjectURL(colorResultUrl);
  colorResultUrl = URL.createObjectURL(new Blob([fileBytes as BlobPart], { type: mime }));
  const heading = document.createElement("div");
  heading.className = "done";
  heading.textContent = "接收完成";
  const meta = document.createElement("div");
  meta.className = "result-meta";
  meta.textContent = `${fileName} · ${(fileBytes.length / 1024).toFixed(1)} KB · ${mime}`;
  result.replaceChildren(heading, meta);
  if (mime.startsWith("image/")) {
    const image = document.createElement("img");
    image.className = "received";
    image.src = colorResultUrl;
    image.alt = fileName;
    result.append(image);
  } else if (mime.startsWith("video/")) {
    const video = document.createElement("video");
    video.className = "received";
    video.src = colorResultUrl;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    result.append(video);
  }
  const download = document.createElement("a");
  download.className = "download-button";
  download.href = colorResultUrl;
  download.download = fileName;
  download.textContent = `下载 ${fileName}`;
  result.append(download);
}

function stopColor() {
  if (frame.getAttribute("src")) {
    frame.src = "about:blank";
    frame.removeAttribute("src");
  }
  preview.style.display = "none";
  start.style.display = "block";
  colorRuntimeReady = false;
  colorDone = false;
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
