// Receiver: camera → WASM QR decode in workers → fountain decoder → file.
//
// Field lessons baked in:
// - iOS treats `frameRate: {ideal: 60}` as a suggestion and delivers 30.
//   Demand `exact` first (it works at 1280-wide), fall back to `ideal`.
// - requestVideoFrameCallback chains survive a stopped stream and resume on
//   the next one — a generation counter prevents zombie capture loops.
// - Progress must track frames COLLECTED: LT peeling back-loads its solve
//   cascade, so blocks-solved looks stalled and then teleports to done.

import { LTDecoder } from "../../shared/fountain";
import { unpackTransferFileV2 } from "../../shared/file-envelope-v2";
import { fnv1a, parseFrame } from "../../shared/protocol";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { zxingWasmDataUrl } from "../../receive/zxing-wasm-inline.generated";

declare const __XHS_MAIN_THREAD__: boolean;

const OVERHEAD_EST = 1.18; // expected frames ≈ K × this (robust-soliton ε)

const startBtn = document.getElementById("start") as HTMLButtonElement;
const video = document.getElementById("video") as HTMLVideoElement;
const preview = document.getElementById("preview")!;
const stats = document.getElementById("stats")!;
const progressEl = document.getElementById("progress")!;
const bar = document.getElementById("bar")!;
const result = document.getElementById("result")!;
const metricsEl = document.getElementById("metrics")!;
const cfgCamera = document.getElementById("cfg-camera") as HTMLSelectElement;
const progressFrames = document.getElementById("progress-frames")!;
const progressPercent = document.getElementById("progress-percent")!;
const framePulses = document.getElementById("frame-pulses")!;
const metric = (id: string) => document.getElementById(id)!;
const setCapability = (name: "secure" | "camera" | "worker" | "wasm", state: "pass" | "fail" | "", text: string) => {
  const el = document.getElementById(`cap-${name}`)!;
  el.className = state;
  el.querySelector("b")!.textContent = text;
};

let stream: MediaStream | null = null;
let decoder: LTDecoder | null = null;
let sessionId = 0;
let startTs = 0;
let captureGen = 0;
let done = false;
let pulseIndex = 0;
let stableFrames = 0;
let filteredFrames = 0;
let decodeTarget = 1080;
let lastDecodedAt = 0;
let lastTuneAt = 0;
let visualFramesNew = 0;
let visualFramesDup = 0;
const visualSignatures: Array<Uint32Array | null> = [null, null];

type Point = { x: number; y: number };
type Position = { topLeft: Point; topRight: Point; bottomLeft: Point; bottomRight: Point };
type Roi = { x: number; y: number; w: number; h: number; seenAt: number; lane?: 0 | 1 };
type DecodeTask = { x: number; y: number; w: number; h: number; fullW: number; fullH: number; lane?: 0 | 1 };
const rois: Roi[] = [];
const tasks = new Map<number, DecodeTask>();

const workers: Worker[] = [];
const busy: boolean[] = [];
let workerInitPromise: Promise<boolean> | null = null;
let workerInitTarget = 0;
const captureTimes: number[] = [];
const decodeTimes: number[] = [];
let mainThreadDecodeBusy = false;
let lastMainThreadDecode = 0;
const mainThreadModuleReady = __XHS_MAIN_THREAD__
  ? Promise.resolve(prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? zxingWasmDataUrl : prefix + path,
      },
    }))
  : null;

const cameraApiAvailable =
  typeof (navigator as unknown as { mediaDevices?: { getUserMedia?: unknown } }).mediaDevices?.getUserMedia ===
  "function";
setCapability("secure", window.isSecureContext ? "pass" : "fail", window.isSecureContext ? "通过" : "不安全");
setCapability(
  "camera",
  cameraApiAvailable ? "" : "fail",
  cameraApiAvailable ? "待授权" : "不支持",
);
setCapability(
  "worker",
  __XHS_MAIN_THREAD__ ? "pass" : typeof Worker === "function" ? "" : "fail",
  __XHS_MAIN_THREAD__ ? "已绕过" : typeof Worker === "function" ? "待启动" : "不支持",
);
setCapability("wasm", typeof WebAssembly === "object" ? "" : "fail", typeof WebAssembly === "object" ? "待加载" : "不支持");

if (__XHS_MAIN_THREAD__) {
  void mainThreadModuleReady
    ?.then(() => setCapability("wasm", "pass", "通过"))
    .catch(() => setCapability("wasm", "fail", "加载失败"));
}

for (let i = 0; i < 48; i++) framePulses.append(document.createElement("span"));

function ensureWorkers(workerCount: number): Promise<boolean> {
  if (__XHS_MAIN_THREAD__) return Promise.resolve(true);
  if (workerInitPromise && workerInitTarget === workerCount) return workerInitPromise;

  workers.forEach((worker) => worker.terminate());
  workers.length = 0;
  busy.length = 0;
  workerInitTarget = workerCount;
  setCapability("worker", "", "启动中");
  setCapability("wasm", "", "加载中");

  workerInitPromise = new Promise<boolean>((resolve) => {
    let readyCount = 0;
    let settled = false;
    const finish = (ok: boolean, message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (ok) {
        setCapability("worker", "pass", "通过");
        setCapability("wasm", "pass", "通过");
      } else {
        setCapability("worker", "fail", "启动失败");
        setCapability("wasm", "fail", "加载失败");
        if (message) stats.textContent = `✗ 解码器：${message}`;
      }
      resolve(ok);
    };
    const timeout = window.setTimeout(
      () => finish(false, "初始化超过 60 秒，请检查网络或重新打开页面"),
      60_000,
    );

    const startWorker = (slot: number) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      } catch (error) {
        finish(false, error instanceof Error ? error.message : String(error));
        return;
      }
      worker.onmessage = (event: MessageEvent) => {
        const { id, decoded, ready, error } = event.data as {
          id: number;
          decoded?: Array<{ bytes: Uint8Array; position: Position }>;
          ready?: boolean;
          error?: string;
        };
        if (id === -1) {
          if (!ready) {
            finish(false, error || "WASM 无法加载");
            return;
          }
          readyCount++;
          if (readyCount === workerCount) finish(true);
          else startWorker(slot + 1);
          return;
        }
        busy[slot] = false;
        const task = tasks.get(id);
        tasks.delete(id);
        for (const item of decoded ?? []) {
          lastDecodedAt = performance.now();
          if (task) trackRoi(item.position, task);
          onDecoded(item.bytes);
        }
      };
      worker.onerror = (event) => finish(false, event.message || "Worker 运行失败");
      workers.push(worker);
      busy.push(false);
    };

    // Start sequentially. On mobile browsers, starting multiple 1.3 MB module
    // workers at once can leave the second script request pending indefinitely.
    startWorker(0);
  });
  return workerInitPromise;
}

if (!__XHS_MAIN_THREAD__ && typeof Worker === "function" && typeof WebAssembly === "object") {
  const configuredWorkers = Number((document.getElementById("cfg-workers") as HTMLSelectElement).value);
  void ensureWorkers(configuredWorkers);
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  });
}

startBtn.onclick = () => void start();
window.addEventListener("qrrec:pause", () => {
  captureGen++;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  preview.style.display = "none";
  if (!done) {
    startBtn.style.display = "block";
    startBtn.textContent = "开启摄像头接收";
  }
});
cfgCamera.onchange = () => {
  if (!stream) return;
  localStorage.setItem("qrrec-camera", cfgCamera.value);
  void switchCamera();
};

function getCameraConfig() {
  return {
    captureWidth: Number((document.getElementById("cfg-width") as HTMLSelectElement).value),
    captureFps: Number((document.getElementById("cfg-capfps") as HTMLSelectElement).value),
    deviceId: cfgCamera.value,
  };
}

async function requestCamera() {
  const { captureWidth, captureFps, deviceId } = getCameraConfig();
  const base: MediaTrackConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }),
    width: { ideal: captureWidth },
    height: { ideal: Math.round((captureWidth * 3) / 4) },
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...base, frameRate: { exact: captureFps } },
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...base, frameRate: { ideal: captureFps } },
    });
  }
}

async function populateCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput",
  );
  const preferred = localStorage.getItem("qrrec-camera") || cfgCamera.value;
  cfgCamera.replaceChildren(new Option("自动选择后置摄像头", ""));
  devices.forEach((device, index) => {
    cfgCamera.add(new Option(device.label || `摄像头 ${index + 1}`, device.deviceId));
  });
  if (devices.some((device) => device.deviceId === preferred)) cfgCamera.value = preferred;
}

async function switchCamera() {
  try {
    const nextStream = await requestCamera();
    stream?.getTracks().forEach((track) => track.stop());
    stream = nextStream;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    const camera = stream.getVideoTracks()[0];
    const config = camera?.getSettings();
    stats.textContent = `摄像头 ${config?.width}×${config?.height}@${config?.frameRate} · 等待光码`;
    setCapability("camera", "pass", "通过");
    await populateCameras();
  } catch (err) {
    setCapability("camera", "fail", "切换失败");
    stats.textContent = `✗ 摄像头：${err instanceof Error ? err.message : String(err)}`;
  }
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    // On insecure origins the API doesn't exist AT ALL — this is the plain-
    // http-over-LAN case. localhost is exempt; other hosts need https.
    stats.textContent =
      "✗ camera needs a secure context — this page must be served over " +
      "https to use the camera from another device (npm run dev:https).";
    return;
  }
  const workerCount = Number((document.getElementById("cfg-workers") as HTMLSelectElement).value);
  startBtn.style.display = "none";
  preview.style.display = "block";
  metricsEl.style.display = "grid";
  try {
    stream = await requestCamera();
  } catch (err) {
    setCapability("camera", "fail", "授权失败");
    stats.textContent = `✗ camera: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  setCapability("camera", "pass", "通过");
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  await populateCameras();
  stats.textContent = `摄像头 ${stream.getVideoTracks()[0]?.getSettings().width}×${stream.getVideoTracks()[0]?.getSettings().height}@${stream.getVideoTracks()[0]?.getSettings().frameRate} · 等待光码`;

  if (__XHS_MAIN_THREAD__) {
    try {
      await mainThreadModuleReady;
      setCapability("wasm", "pass", "通过");
    } catch (err) {
      setCapability("wasm", "fail", "加载失败");
      stats.textContent = `✗ WASM: ${err instanceof Error ? err.message : String(err)}`;
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
  }

  /* XHS_WORKER_BEGIN */
  if (!__XHS_MAIN_THREAD__ && !(await ensureWorkers(workerCount))) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  /* XHS_WORKER_END */

  captureGen++;
  lastDecodedAt = performance.now();
  lastTuneAt = lastDecodedAt;
  scheduleFrame(captureGen);
  setInterval(updateStats, 500);
  try {
    await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } })
      .wakeLock?.request("screen");
  } catch {
    /* fine */
  }
}

type VideoRVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

function scheduleFrame(gen: number) {
  if (done || gen !== captureGen) return;
  const v = video as VideoRVFC;
  const next = () => {
    if (done || gen !== captureGen) return;
    captureFrame();
    scheduleFrame(gen);
  };
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
  else requestAnimationFrame(next);
}

const grab = document.createElement("canvas");
let frameId = 0;

function visualSignature(image: ImageData): Uint32Array {
  const values = new Uint8Array(128);
  let total = 0;
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 16; sx++) {
      const x = Math.min(image.width - 1, Math.floor((sx + 0.5) * image.width / 16));
      const y = Math.min(image.height - 1, Math.floor((sy + 0.5) * image.height / 8));
      const i = (y * image.width + x) * 4;
      const value = (image.data[i]! * 77 + image.data[i + 1]! * 150 + image.data[i + 2]! * 29) >> 8;
      values[sy * 16 + sx] = value;
      total += value;
    }
  }
  const mean = total / values.length;
  const words = new Uint32Array(4);
  values.forEach((value, index) => {
    if (value >= mean) words[index >> 5] = (words[index >> 5]! | (1 << (index & 31))) >>> 0;
  });
  return words;
}

function bitDifference(left: Uint32Array, right: Uint32Array) {
  let count = 0;
  for (let i = 0; i < left.length; i++) {
    let value = (left[i]! ^ right[i]!) >>> 0;
    value -= (value >>> 1) & 0x55555555;
    value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
    count += (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return count;
}

function stableEnough(img: ImageData, activeRois: Roi[]) {
  if (activeRois.length < 2) return true;
  let light = 0;
  let dark = 0;
  let middle = 0;
  const data = img.data;
  for (const roi of activeRois) {
    const step = Math.max(3, Math.floor(Math.min(roi.w, roi.h) / 80));
    for (let y = roi.y; y < roi.y + roi.h; y += step) {
      for (let x = roi.x; x < roi.x + roi.w; x += step) {
        const i = (y * img.width + x) * 4;
        const lum = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
        if (lum < 70) dark++; else if (lum > 185) light++; else middle++;
      }
    }
  }
  return light > 100 && dark > 100 && middle / Math.max(1, light + dark + middle) < 0.42;
}

function trackRoi(position: Position, task: DecodeTask) {
  const points = [position.topLeft, position.topRight, position.bottomLeft, position.bottomRight];
  const minX = Math.min(...points.map((point) => point.x)) + task.x;
  const maxX = Math.max(...points.map((point) => point.x)) + task.x;
  const minY = Math.min(...points.map((point) => point.y)) + task.y;
  const maxY = Math.max(...points.map((point) => point.y)) + task.y;
  const pad = Math.max(16, Math.round(Math.max(maxX - minX, maxY - minY) * 0.16));
  const next: Roi = {
    x: Math.max(0, Math.floor(minX - pad)),
    y: Math.max(0, Math.floor(minY - pad)),
    w: Math.min(task.fullW, Math.ceil(maxX + pad)) - Math.max(0, Math.floor(minX - pad)),
    h: Math.min(task.fullH, Math.ceil(maxY + pad)) - Math.max(0, Math.floor(minY - pad)),
    seenAt: performance.now(),
    lane: task.lane,
  };
  const center = (roi: Roi) => ({ x: roi.x + roi.w / 2, y: roi.y + roi.h / 2 });
  const nextCenter = center(next);
  const match = rois.findIndex((roi) => {
    if (next.lane !== undefined && roi.lane !== next.lane) return false;
    const currentCenter = center(roi);
    return Math.hypot(currentCenter.x - nextCenter.x, currentCenter.y - nextCenter.y) < Math.max(roi.w, next.w) * 0.6;
  });
  if (match >= 0) rois[match] = next;
  else rois.push(next);
  rois.sort((a, b) => a.x - b.x);
  if (rois.length > 2) rois.splice(2);
}

function captureFrame() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  captureTimes.push(performance.now());
  if (__XHS_MAIN_THREAD__) {
    const now = performance.now();
    if (mainThreadDecodeBusy || now - lastMainThreadDecode < 120) return;
    lastMainThreadDecode = now;
  }
  const freeSlots = __XHS_MAIN_THREAD__ ? [] : busy
    .map((isBusy, index) => isBusy ? -1 : index)
    .filter((index) => index >= 0);
  if (!__XHS_MAIN_THREAD__ && freeSlots.length === 0) return; // all workers busy — drop the frame
  const scale = Math.min(1, decodeTarget / Math.max(vw, vh));
  const decodeWidth = Math.max(1, Math.round(vw * scale));
  const decodeHeight = Math.max(1, Math.round(vh * scale));
  if (grab.width !== decodeWidth || grab.height !== decodeHeight) {
    grab.width = decodeWidth;
    grab.height = decodeHeight;
  }
  const ctx = grab.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, decodeWidth, decodeHeight);
  const img = ctx.getImageData(0, 0, decodeWidth, decodeHeight);
  const now = performance.now();
  for (let i = rois.length - 1; i >= 0; i--) if (now - rois[i]!.seenAt > 3500) rois.splice(i, 1);
  if (!stableEnough(img, rois)) {
    filteredFrames++;
    return;
  }
  stableFrames++;
  if (__XHS_MAIN_THREAD__) {
    mainThreadDecodeBusy = true;
    // Some host WebViews return an ImageData-like object whose `.data` has a
    // length but no TypedArray byteLength. ZXing uses byteLength for its WASM
    // allocation, which otherwise becomes zero and produces instant misses.
    const rgba = new Uint8Array(img.data.length);
    rgba.set(img.data);
    const normalizedImage = {
      data: rgba,
      width: img.width,
      height: img.height,
    } as unknown as ImageData;
    void readBarcodes(normalizedImage, {
      formats: ["QRCode"],
      maxNumberOfSymbols: 2,
      tryDenoise: true,
      tryDownscale: false,
    })
      .then((results) => {
        for (const decoded of results.filter((entry) => entry.isValid && entry.bytes.length > 0)) {
          lastDecodedAt = performance.now();
          onDecoded(decoded.bytes);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        mainThreadDecodeBusy = false;
      });
  } else {
    // Start with two overlapping search lanes. Waiting for a full-frame scan
    // to recognize both dense symbols at once creates an ROI startup deadlock.
    const overlap = Math.round(decodeWidth * 0.12);
    const half = Math.ceil(decodeWidth / 2);
    const searchRois: Roi[] = [
      { x: 0, y: 0, w: Math.min(decodeWidth, half + overlap), h: decodeHeight, seenAt: now, lane: 0 },
      { x: Math.max(0, half - overlap), y: 0, w: decodeWidth - Math.max(0, half - overlap), h: decodeHeight, seenAt: now, lane: 1 },
    ];
    const dispatch = (slot: number, roi?: Roi) => {
      const crop = roi ? ctx.getImageData(roi.x, roi.y, roi.w, roi.h) : img;
      if (roi?.lane !== undefined) {
        const signature = visualSignature(crop);
        const previous = visualSignatures[roi.lane];
        if (previous && bitDifference(previous, signature) <= 8) {
          visualFramesDup++;
          return;
        }
        visualSignatures[roi.lane] = signature;
        visualFramesNew++;
      }
      const task: DecodeTask = roi
        ? { x: roi.x, y: roi.y, w: roi.w, h: roi.h, fullW: decodeWidth, fullH: decodeHeight, lane: roi.lane }
        : { x: 0, y: 0, w: decodeWidth, h: decodeHeight, fullW: decodeWidth, fullH: decodeHeight };
      const id = frameId++;
      busy[slot] = true;
      tasks.set(id, task);
      workers[slot]!.postMessage({ id, buf: crop.data.buffer, w: crop.width, h: crop.height }, [crop.data.buffer]);
    };
    if (rois.length === 2 && freeSlots.length >= 2) {
      dispatch(freeSlots[0]!, rois[0]);
      dispatch(freeSlots[1]!, rois[1]);
    } else if (rois.length === 2) {
      dispatch(freeSlots[0]!, rois[frameId % 2]);
    } else if (freeSlots.length >= 2) {
      dispatch(freeSlots[0]!, rois.find((roi) => roi.lane === 0) ?? searchRois[0]);
      dispatch(freeSlots[1]!, rois.find((roi) => roi.lane === 1) ?? searchRois[1]);
    } else {
      const lane = frameId % 2 as 0 | 1;
      dispatch(freeSlots[0]!, rois.find((roi) => roi.lane === lane) ?? searchRois[lane]);
    }
  }
}

function onDecoded(bytes: Uint8Array) {
  decodeTimes.push(performance.now());
  const parsed = parseFrame(bytes);
  if (!parsed || done) return;
  const { header, block } = parsed;
  if (!decoder || sessionId !== header.sessionId) {
    decoder = new LTDecoder(header.k, header.blockLen, header.sessionId, header.totalLen);
    sessionId = header.sessionId;
    startTs = performance.now();
    progressEl.style.display = "block";
    pulseIndex = 0;
    framePulses.querySelectorAll("span").forEach((pulse) => pulse.className = "");
  }
  const previousFrames = decoder.framesNew;
  decoder.addFrame(header.seq, block);
  const expectedFrames = Math.max(1, Math.ceil(decoder.k * OVERHEAD_EST));
  const progress = Math.min(0.99, decoder.framesNew / expectedFrames);
  bar.style.width = `${(progress * 100).toFixed(1)}%`;
  progressFrames.textContent = `${decoder.framesNew} / 约 ${expectedFrames} 帧`;
  progressPercent.textContent = `${Math.round(progress * 100)}%`;
  stats.textContent = `已识别会话 ${header.sessionId} · 正在接收 ${Math.round(header.totalLen / 1024)} KB`;
  if (decoder.framesNew > previousFrames) {
    const pulses = framePulses.querySelectorAll("span");
    const pulse = pulses[pulseIndex % pulses.length];
    pulse?.classList.add("active");
    pulseIndex++;
    if (pulseIndex >= pulses.length * 2) {
      pulses.forEach((item, index) => item.classList.toggle("active", index > pulseIndex % pulses.length));
    }
  }

  if (decoder.isComplete) {
    const payload = decoder.assemble()!;
    const seconds = (performance.now() - startTs) / 1000;
    const ok = fnv1a(payload) === header.payloadFnv;
    finish(payload, ok, seconds, header.totalLen);
  }
}

function finish(payload: Uint8Array, hashOk: boolean, seconds: number, totalLen: number) {
  done = true;
  captureGen++;
  stream?.getTracks().forEach((t) => t.stop());
  preview.style.display = "none";
  bar.style.width = "100%";
  progressPercent.textContent = "100%";
  progressFrames.textContent = "文件重组完成";
  const kb = Math.round(totalLen / 1024);
  const rate = (totalLen / 1024 / seconds).toFixed(1);
  stats.textContent = `${kb} KB in ${seconds.toFixed(1)} s · ${rate} KB/s · hash ${hashOk ? "verified ✓" : "MISMATCH ✗"}`;
  const transfer = unpackTransferFileV2(payload);
  const fileBytes = transfer?.bytes ?? payload;
  const fileName = transfer?.name ?? "received-file.bin";
  const fileType = transfer?.type ?? "application/octet-stream";
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"]);
  const videoExtensions = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
  const textExtensions = new Set(["txt", "md", "json", "csv", "log", "xml", "html", "css", "js", "ts"]);
  const isImage = fileType.startsWith("image/") || imageExtensions.has(extension);
  const isVideo = fileType.startsWith("video/") || videoExtensions.has(extension);
  const isText = fileType.startsWith("text/") || textExtensions.has(extension);
  const fallbackTypes: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    m4v: "video/x-m4v", ogv: "video/ogg",
  };
  const blobType =
    fileType === "application/octet-stream" ? fallbackTypes[extension] ?? fileType : fileType;
  const heading = document.createElement("div");
  heading.className = "done";
  heading.textContent = hashOk ? "接收完成" : "接收完成，但校验失败";
  const fileMeta = document.createElement("div");
  fileMeta.className = "result-meta";
  const compressionNote = transfer?.compressed ? ` · gzip 已解压 ${Math.round(transfer.originalLength / 1024)} KB` : "";
  fileMeta.textContent = `${fileName} · ${Math.round(fileBytes.length / 1024)} KB · ${blobType}${compressionNote}`;
  const url = URL.createObjectURL(new Blob([fileBytes as BlobPart], { type: blobType }));
  const download = document.createElement("a");
  download.className = "download-button";
  download.href = url;
  download.download = fileName;
  download.textContent = `下载 ${fileName}`;
  result.replaceChildren(heading, fileMeta);
  if (isImage) {
    const img = document.createElement("img");
    img.className = "received";
    img.src = url;
    img.alt = fileName;
    result.append(img);
  } else if (isVideo) {
    const player = document.createElement("video");
    player.className = "received";
    player.src = url;
    player.controls = true;
    player.preload = "metadata";
    player.playsInline = true;
    result.append(player);
  } else if (isText) {
    const text = new TextDecoder().decode(fileBytes);
    const textPreview = document.createElement("pre");
    textPreview.className = "received-text";
    textPreview.textContent = text;
    result.append(textPreview);
    if (/^https?:\/\/\S+$/i.test(text.trim())) {
      const open = document.createElement("a");
      open.className = "secondary-button";
      open.href = text.trim();
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "打开链接";
      result.append(open);
    }
  }
  result.append(download);
}

function updateStats() {
  if (done) return;
  const now = performance.now();
  const prune = (a: number[]) => {
    while (a.length > 0 && a[0]! < now - 2000) a.shift();
  };
  prune(captureTimes);
  prune(decodeTimes);
  metric("m-cap").textContent = (captureTimes.length / 2).toFixed(0);
  metric("m-dec").textContent = (decodeTimes.length / 2).toFixed(1);
  metric("m-stable").textContent = `${stableFrames}/${filteredFrames}`;
  metric("m-roi").textContent = rois.length === 2 ? "双 ROI" : rois.length === 1 ? "定位 1/2" : "左右并行搜索";
  metric("m-visual").textContent = `${visualFramesNew}/${visualFramesDup}`;
  if (lastDecodedAt && now - lastDecodedAt > 2800 && now - lastTuneAt > 2500 && decodeTarget < 1120) {
    decodeTarget += 80;
    rois.length = 0;
    lastTuneAt = now;
  } else if (decodeTimes.length >= 20 && now - lastTuneAt > 3000 && decodeTarget > 900) {
    decodeTarget -= 40;
    rois.length = 0;
    lastTuneAt = now;
  }
  if (!decoder) return;
  const elapsed = (now - startTs) / 1000;
  const kbs = (decoder.framesNew * decoder.blockLen) / OVERHEAD_EST / 1024 / Math.max(0.1, elapsed);
  metric("m-rate").textContent = `${kbs.toFixed(1)} KB/s`;
  metric("m-time").textContent = `${elapsed.toFixed(0)} s`;
  metric("m-frames").textContent = `${decoder.framesNew}/${decoder.framesDup}`;
  metric("m-k").textContent = String(decoder.k);
  metric("m-block").textContent = `${decoder.blockLen} B`;
  metric("m-payload").textContent = `${Math.round(decoder.totalLen / 1024)} KB`;
}
