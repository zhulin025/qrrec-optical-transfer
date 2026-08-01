const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const fileInfo = document.querySelector<HTMLElement>("#file-info")!;
const specs = document.querySelector<HTMLElement>("#specs")!;
const fps = document.querySelector<HTMLSelectElement>("#fps")!;
const mode = document.querySelector<HTMLSelectElement>("#mode")!;
const wrap = document.querySelector<HTMLElement>("#runtime-wrap")!;
const frame = document.querySelector<HTMLIFrameElement>("#runtime")!;
const sessionButton = document.querySelector<HTMLButtonElement>("#session-button")!;
let selected: File | null = null;
let active = false;
let wakeLock: WakeLockSentinel | null = null;

type RuntimeWindow = Window & { Main?: { setFPS(value: string): void; setMode(value: string): void } };

function runtimeWindow() { return frame.contentWindow as RuntimeWindow | null; }
function configure() {
  runtimeWindow()?.Main?.setFPS(fps.value);
  runtimeWindow()?.Main?.setMode(mode.value);
  if (selected) specs.textContent = `${mode.selectedOptions[0]?.textContent} · ${fps.value} FPS · libcimbar 本地光学传输`;
}
function sendFile() {
  if (!active || !selected || !frame.contentDocument) return;
  const target = frame.contentDocument.querySelector<HTMLInputElement>("#file_input");
  if (!target) return;
  const transfer = new DataTransfer();
  transfer.items.add(selected);
  target.files = transfer.files;
  target.dispatchEvent(new Event("change", { bubbles: true }));
}
function renderSessionState() {
  sessionButton.disabled = !selected;
  sessionButton.textContent = active ? "结束传输" : "开始传输";
  sessionButton.classList.toggle("stop", active);
  wrap.hidden = !active;
  if (!selected) specs.textContent = "选择文件后，点击开始传输";
  else if (!active) specs.textContent = `${selected.name} 已就绪 · 点击开始传输`;
}

async function startSession() {
  if (!selected || active) return;
  active = true;
  renderSessionState();
  specs.textContent = "正在初始化 libcimbar 编码器…";
  frame.src = frame.dataset.runtimeSrc ?? "./runtime-send.html?v=6";
  try { wakeLock = await navigator.wakeLock?.request("screen") ?? null; } catch { /* optional */ }
}

async function endSession() {
  active = false;
  frame.src = "about:blank";
  await wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  renderSessionState();
}

frame.addEventListener("load", () => {
  if (!active || frame.src === "about:blank") return;
  setTimeout(() => { if (active) { configure(); sendFile(); } }, 200);
});
sessionButton.addEventListener("click", () => active ? void endSession() : void startSession());
fps.addEventListener("change", configure);
mode.addEventListener("change", configure);
fileInput.addEventListener("change", () => {
  if (active) void endSession();
  selected = fileInput.files?.[0] ?? null;
  fileInfo.textContent = selected ? `${selected.name} · ${formatBytes(selected.size)}` : "尚未选择文件";
  renderSessionState();
});

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

renderSessionState();
