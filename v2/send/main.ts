import QRCode from "qrcode";
import { LTEncoder } from "../../shared/fountain";
import { packTransferFileV2 } from "../../shared/file-envelope-v2";
import { HEADER_LEN, fnv1a, packFrame, type FrameHeader } from "../../shared/protocol";

const MARGIN = 4;
const LOOKAHEAD = 3;
const canvases = [
  document.getElementById("qr-a") as HTMLCanvasElement,
  document.getElementById("qr-b") as HTMLCanvasElement,
];
const specs = document.getElementById("specs")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const fileInfo = document.getElementById("file-info")!;
const cfgFps = document.getElementById("cfg-fps") as HTMLSelectElement;
const cfgBytes = document.getElementById("cfg-bytes") as HTMLSelectElement;
const cfgEcc = document.getElementById("cfg-ecc") as HTMLSelectElement;
const cfgSize = document.getElementById("cfg-size") as HTMLInputElement;
const cfgCodes = document.getElementById("cfg-codes") as HTMLSelectElement;
const stageB = document.getElementById("stage-b")!;
const receiverLink = document.getElementById("receiver-link") as HTMLAnchorElement;
const receiverLinkQr = document.getElementById("receiver-link-qr") as HTMLCanvasElement;

let generation = 0;
let selectedFile: File | null = null;

const formatBytes = (bytes: number) => bytes < 1024
  ? `${bytes} B`
  : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

async function main() {
  const receiverUrl = "https://qrrec.liuwa.xyz/v2/";
  receiverLink.href = receiverUrl;
  receiverLink.textContent = new URL(receiverUrl).host + new URL(receiverUrl).pathname.replace(/\/$/, "");
  await QRCode.toCanvas(receiverLinkQr, receiverUrl, { width: 220, margin: 3, errorCorrectionLevel: "M" });
  for (const element of [cfgFps, cfgBytes, cfgEcc, cfgSize, cfgCodes]) {
    element.addEventListener("change", () => void startStream());
  }
  fileInput.addEventListener("change", () => {
    selectedFile = fileInput.files?.[0] ?? null;
    if (selectedFile && cfgBytes.dataset.tuned !== "true") {
      const codeCount = Number(cfgCodes.value);
      const cssPixelsPerCode = (innerWidth - 54) / codeCount;
      cfgBytes.value = codeCount === 2 ? (cssPixelsPerCode >= 800 ? "1465" : "1000") : "1850";
      cfgFps.value = codeCount === 2 ? "20" : "24";
      cfgBytes.dataset.tuned = "true";
    }
    fileInfo.textContent = selectedFile ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}` : "尚未选择文件";
    void startStream();
  });
  try { await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
}

async function startStream() {
  const gen = ++generation;
  if (!selectedFile) return;
  specs.textContent = "正在分析并压缩文件…";
  const source = new Uint8Array(await selectedFile.arrayBuffer());
  const packed = packTransferFileV2({ name: selectedFile.name, type: selectedFile.type, bytes: source });
  if (gen !== generation) return;
  const payload = packed.payload;
  const fps = Number(cfgFps.value);
  const frameBytes = Number(cfgBytes.value);
  const ecc = cfgEcc.value as "L" | "M" | "Q" | "H";
  const codeCount = Number(cfgCodes.value);
  stageB.style.display = codeCount === 2 ? "block" : "none";
  const blockLen = frameBytes - HEADER_LEN;
  const sessionId = (Math.floor(Math.random() * 0xffff) + 1) & 0xffff;
  const encoder = new LTEncoder(payload, blockLen, sessionId);
  const header: FrameHeader = { sessionId, seq: 0, k: encoder.k, blockLen, totalLen: payload.length, payloadFnv: fnv1a(payload) };
  let version: number | undefined;
  let modules = 0;
  let scale = 1;
  let nextSeq = 0;
  const staging = document.createElement("canvas");
  const queue: ImageData[][] = [];

  const sizeCanvases = () => {
    const dpr = devicePixelRatio || 1;
    const total = modules + MARGIN * 2;
    const perCodeWidth = (innerWidth - 54) / codeCount;
    const budget = Math.min(perCodeWidth, innerHeight * .72, Number(cfgSize.value));
    scale = Math.max(1, Math.floor((budget * dpr) / total));
    staging.width = total; staging.height = total;
    canvases.forEach((canvas) => {
      canvas.width = total * scale; canvas.height = total * scale;
      canvas.style.width = `${total * scale / dpr}px`; canvas.style.height = `${total * scale / dpr}px`;
    });
  };
  const makeOne = () => {
    const seq = nextSeq++;
    const bytes = packFrame({ ...header, seq }, encoder.encode(seq));
    const qr = QRCode.create([{ data: bytes, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
      errorCorrectionLevel: ecc, version, maskPattern: 4,
    });
    if (version === undefined) { version = qr.version; modules = qr.modules.size; sizeCanvases(); }
    const total = modules + MARGIN * 2;
    const image = new ImageData(total, total);
    const pixels = new Uint32Array(image.data.buffer); pixels.fill(0xffffffff);
    for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) {
      if (qr.modules.data[y * modules + x]) pixels[(y + MARGIN) * total + x + MARGIN] = 0xff000000;
    }
    return image;
  };
  const pump = () => {
    if (gen !== generation) return;
    try { while (queue.length < LOOKAHEAD) queue.push(Array.from({ length: codeCount }, makeOne)); }
    catch (error) { specs.textContent = `✗ ${error instanceof Error ? error.message : String(error)}`; return; }
    setTimeout(pump, 0);
  };
  pump();
  const compression = packed.compressed
    ? `gzip ${formatBytes(packed.originalLength)}→${formatBytes(payload.length)}` : "原始数据";
  specs.textContent = `${codeCount} 码 · ${fps} FPS · ${frameBytes} B/码 · V${version ?? "…"} · ${compression} · K=${encoder.k}`;
  const interval = 1000 / fps;
  let nextAt = performance.now();
  const tick = (now: number) => {
    if (gen !== generation) return;
    requestAnimationFrame(tick);
    if (now < nextAt) return;
    const pair = queue.shift();
    if (!pair) { nextAt = now + interval; return; }
    pair.forEach((image, index) => {
      staging.getContext("2d")!.putImageData(image, 0, 0);
      const context = canvases[index]!.getContext("2d")!;
      context.imageSmoothingEnabled = false;
      context.drawImage(staging, 0, 0, canvases[index]!.width, canvases[index]!.height);
    });
    nextAt += interval;
    if (now - nextAt > interval * 3) nextAt = now + interval;
  };
  requestAnimationFrame(tick);
}

void main();
