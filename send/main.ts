// Sender: turn a file into an endless fountain-coded QR stream.
//
// Tuning notes from the experiments this PoC is distilled from:
// - Frame payload sets the QR version; denser wins on goodput as long as the
//   receiver can still decode it. 1465 bytes ≈ V27 is a safe middle ground
//   for arbitrary monitors; 2953 (V40) is the ceiling and works phone-to-
//   phone at close range.
// - The mask pattern is pinned (any declared mask is valid to a decoder);
//   this skips the spec's 8-way mask evaluation and speeds generation ~4×.
// - Displays need each frame shown for ≥2 refresh cycles or captures catch
//   the transition; 24 fps on a 60 Hz screen is comfortable.
// - Error correction stays at L by default: the fountain layer already
//   handles erasures, and a frame is either decoded whole or discarded.

import QRCode from "qrcode";
import { LTEncoder } from "../shared/fountain";
import { packTransferFile } from "../shared/file-envelope";
import { HEADER_LEN, fnv1a, packFrame, type FrameHeader } from "../shared/protocol";

declare const __RECEIVER_URL__: string;
declare const __ENABLE_PWA__: boolean;
declare const __ALLOW_RECEIVER_NAV__: boolean;

const MARGIN = 4; // quiet-zone modules
const LOOKAHEAD = 3;

const canvas = document.getElementById("qr") as HTMLCanvasElement;
const specs = document.getElementById("specs")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const fileInfo = document.getElementById("file-info")!;
const cfgFps = document.getElementById("cfg-fps") as HTMLSelectElement;
const cfgBytes = document.getElementById("cfg-bytes") as HTMLSelectElement;
const cfgEcc = document.getElementById("cfg-ecc") as HTMLSelectElement;
const cfgSize = document.getElementById("cfg-size") as HTMLInputElement;
const receiverLink = document.getElementById("receiver-link") as HTMLAnchorElement;
const receiverLinkQr = document.getElementById("receiver-link-qr") as HTMLCanvasElement;

let generation = 0; // bumped on every restart; stale loops see it and die
let selectedFile: File | null = null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function main() {
  const enablePwa = typeof __ENABLE_PWA__ === "undefined" ? true : __ENABLE_PWA__;
  const allowReceiverNav =
    typeof __ALLOW_RECEIVER_NAV__ === "undefined" ? true : __ALLOW_RECEIVER_NAV__;
  const configuredReceiverUrl =
    typeof __RECEIVER_URL__ === "undefined" ? "" : __RECEIVER_URL__;

  if (enablePwa && "serviceWorker" in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register("../service-worker.js", { scope: "../" });
  }
  const receiverUrl = configuredReceiverUrl || "https://qrrec.liuwa.xyz/";
  receiverLink.href = allowReceiverNav ? receiverUrl : "#";
  receiverLink.textContent = new URL(receiverUrl).host;
  if (!allowReceiverNav) {
    receiverLink.setAttribute("role", "button");
    receiverLink.setAttribute("aria-label", "显示接收端网址二维码");
    receiverLink.addEventListener("click", (event) => {
      event.preventDefault();
      receiverLink.closest(".receiver-link")?.classList.toggle("open");
    });
    document.addEventListener("click", (event) => {
      const container = receiverLink.closest(".receiver-link");
      if (container && !container.contains(event.target as Node)) container.classList.remove("open");
    });
  }
  await QRCode.toCanvas(receiverLinkQr, receiverUrl, {
    width: 220,
    margin: 3,
    errorCorrectionLevel: "M",
  });
  for (const el of [cfgFps, cfgBytes, cfgEcc, cfgSize]) {
    el.addEventListener("change", () => void startStream());
  }
  fileInput.addEventListener("change", () => {
    selectedFile = fileInput.files?.[0] ?? null;
    fileInfo.textContent = selectedFile
      ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}`
      : "尚未选择文件";
    void startStream();
  });
  try {
    await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } })
      .wakeLock?.request("screen");
  } catch {
    /* fine without it */
  }
}

async function startStream() {
  const gen = ++generation;
  if (!selectedFile) {
    specs.textContent = "选择文件后开始生成光码";
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const fileBytes = new Uint8Array(await selectedFile.arrayBuffer());
  const payload = packTransferFile({
    name: selectedFile.name,
    type: selectedFile.type,
    bytes: fileBytes,
  });
  if (gen !== generation) return; // superseded while fetching
  const txFps = Number(cfgFps.value);
  const frameBytes = Number(cfgBytes.value);
  const ecc = cfgEcc.value as "L" | "M" | "Q" | "H";
  const displayPx = Number(cfgSize.value);

  const sessionId = (Math.floor(Math.random() * 0xffff) + 1) & 0xffff;
  const blockLen = frameBytes - HEADER_LEN;
  const encoder = new LTEncoder(payload, blockLen, sessionId);
  const header: FrameHeader = {
    sessionId,
    seq: 0,
    k: encoder.k,
    blockLen,
    totalLen: payload.length,
    payloadFnv: fnv1a(payload),
  };

  let version: number | undefined; // locked after the first frame
  let modules = 0;
  let scale = 1;
  const staging = document.createElement("canvas");
  const queue: ImageData[] = [];
  let nextSeq = 0;

  const renderQr = (qr: ReturnType<typeof QRCode.create>, targetTotal?: number): ImageData => {
    const size = qr.modules.size;
    const naturalTotal = size + 2 * MARGIN;
    const total = targetTotal ?? naturalTotal;
    const offset = Math.max(MARGIN, Math.floor((total - size) / 2));
    const img = new ImageData(total, total);
    const px = new Uint32Array(img.data.buffer);
    px.fill(0xffffffff);
    for (let y = 0; y < size; y++) {
      const row = (y + offset) * total + offset;
      const src = y * size;
      for (let x = 0; x < size; x++) {
        if (qr.modules.data[src + x]) px[row + x] = 0xff000000;
      }
    }
    return img;
  };

  const sizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    const total = modules + 2 * MARGIN;
    const cssBudget = Math.min(0.9 * Math.min(window.innerWidth, window.innerHeight), displayPx);
    scale = Math.max(1, Math.floor((cssBudget * dpr) / total));
    staging.width = total;
    staging.height = total;
    canvas.width = total * scale;
    canvas.height = total * scale;
    canvas.style.width = `${(total * scale) / dpr}px`;
    canvas.style.height = `${(total * scale) / dpr}px`;
  };

  const makeFrame = (): ImageData => {
    const bytes = packFrame({ ...header, seq: nextSeq }, encoder.encode(nextSeq));
    nextSeq++;
    const qr = QRCode.create([{ data: bytes, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
      errorCorrectionLevel: ecc,
      version,
      maskPattern: 4,
    });
    if (version === undefined) {
      version = qr.version;
      modules = qr.modules.size;
      sizeCanvas();
      specs.textContent =
        `${txFps} FPS · ${frameBytes} bytes per frame · V${version} · ECC ${ecc} · ` +
        `${formatBytes(selectedFile!.size)} · ${selectedFile!.name} · K=${encoder.k}`;
    }
    return renderQr(qr);
  };

  const pump = () => {
    if (gen !== generation) return; // superseded by a settings change
    try {
      while (queue.length < LOOKAHEAD) queue.push(makeFrame());
    } catch (err) {
      // e.g. frame bytes over capacity for the chosen ECC level
      specs.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    setTimeout(pump, 0);
  };
  pump();

  const interval = 1000 / txFps;
  let nextAt = performance.now();
  const tick = (now: number) => {
    if (gen !== generation) return;
    requestAnimationFrame(tick);
    if (now < nextAt) return;
    const img = queue.shift();
    if (!img) {
      nextAt = now + interval;
      return;
    }
    staging.getContext("2d")!.putImageData(img, 0, 0);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, 0, 0, canvas.width, canvas.height);
    nextAt += interval;
    if (now - nextAt > 3 * interval) nextAt = now + interval; // fell behind — don't burst
  };
  requestAnimationFrame(tick);
}

void main();
