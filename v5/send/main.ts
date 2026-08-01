const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const fileInfo = document.querySelector<HTMLElement>("#file-info")!;
const specs = document.querySelector<HTMLElement>("#specs")!;
const fps = document.querySelector<HTMLSelectElement>("#fps")!;
const mode = document.querySelector<HTMLSelectElement>("#mode")!;
const wrap = document.querySelector<HTMLElement>("#runtime-wrap")!;
const frame = document.querySelector<HTMLIFrameElement>("#runtime")!;
let selected: File | null = null;

type RuntimeWindow = Window & { Main?: { setFPS(value: string): void; setMode(value: string): void } };

function runtimeWindow() { return frame.contentWindow as RuntimeWindow | null; }
function configure() {
  runtimeWindow()?.Main?.setFPS(fps.value);
  runtimeWindow()?.Main?.setMode(mode.value);
  if (selected) specs.textContent = `${mode.selectedOptions[0]?.textContent} · ${fps.value} FPS · libcimbar 本地光学传输`;
}
function sendFile() {
  if (!selected || !frame.contentDocument) return;
  const target = frame.contentDocument.querySelector<HTMLInputElement>("#file_input");
  if (!target) return;
  const transfer = new DataTransfer();
  transfer.items.add(selected);
  target.files = transfer.files;
  target.dispatchEvent(new Event("change", { bubbles: true }));
}
frame.addEventListener("load", () => setTimeout(() => { configure(); sendFile(); }, 200));
fps.addEventListener("change", configure);
mode.addEventListener("change", configure);
fileInput.addEventListener("change", () => {
  selected = fileInput.files?.[0] ?? null;
  fileInfo.textContent = selected ? `${selected.name} · ${formatBytes(selected.size)}` : "尚未选择文件";
  wrap.hidden = !selected;
  configure();
  sendFile();
});

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

try { void navigator.wakeLock?.request("screen"); } catch { /* optional */ }
