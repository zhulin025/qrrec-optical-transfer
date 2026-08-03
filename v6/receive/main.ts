import { activeTransferKiBps } from "../shared/metrics";
import "../../shared/style.css";
import "../style.css";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const video = $("#camera") as HTMLVideoElement;
const canvas = $("#capture") as HTMLCanvasElement;
const startButton = $("#record") as HTMLButtonElement;
const status = $("#status");
const result = $("#result");
const bar = $("#bar") as HTMLElement;
const worker = new Worker(new URL("./decode.worker.ts", import.meta.url), { type: "module" });
let stream: MediaStream | null = null;
let running = false;
let callbackId = 0;
let generation = 0;
let submitted = 0;
let captured = 0;
let startedCaptureAt = 0;

setCapability("#cap-secure", isSecureContext, isSecureContext ? "通过" : "需要 HTTPS");
setCapability("#cap-worker", true, "已加载");

startButton.onclick = () => running ? stop() : void start();

worker.onmessage = event => {
  const message = event.data;
  if (message.type === "error") { status.textContent = `解码错误：${message.message}`; return; }
  if (message.type === "progress") {
    text("#unique", `${message.uniquePackets} / ≈${message.neededPackets}`);
    text("#duplicates", String(message.duplicates));
    text("#payload-rate", `${message.payloadRate.toFixed(1)} KiB/s`);
    text("#active-time", `${(message.activeMs / 1000).toFixed(2)} s`);
    text("#decode-time", `${message.decodeMs.toFixed(1)} ms`);
    text("#busy-drop", String(message.droppedFrames));
    bar.style.width = `${message.progress * 100}%`;
    text("#progress-percent", `${Math.round(message.progress * 100)}%`);
    text("#progress-frames", `${message.uniquePackets} / ≈${message.neededPackets} 唯一包`);
    setCapability("#cap-wasm", true, "正在解码");
    status.textContent = message.accepted > 0 ? "正在接收唯一 RaptorQ 数据包…" : "已识别码流，等待新数据包…";
    return;
  }
  if (message.type === "complete") finish(message);
};

async function start(): Promise<void> {
  stop();
  const run = ++generation;
  result.replaceChildren();
  worker.postMessage({ type: "reset" });
  try {
    stream = await openCamera();
    if (run !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
    video.srcObject = stream;
    await video.play();
    running = true;
    submitted = 0; captured = 0; startedCaptureAt = performance.now();
    startButton.textContent = "停止接收";
    setCapability("#cap-camera", true, "已开启");
    status.textContent = "正在寻找 V6 RaptorQ 码流…";
    capture(run);
  } catch (error) {
    status.textContent = `无法启动摄像头：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function openCamera(): Promise<MediaStream> {
  const exact = { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { exact: 60 } } } as MediaStreamConstraints;
  try { return await navigator.mediaDevices.getUserMedia(exact); }
  catch { return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } }); }
}

function capture(run: number): void {
  if (!running || run !== generation) return;
  const frame = () => {
    if (!running || run !== generation) return;
    captured++;
    const targetWidth = 1080;
    const sourceSide = Math.min(video.videoWidth, video.videoHeight);
    const sx = Math.floor((video.videoWidth - sourceSide) / 2);
    const sy = Math.floor((video.videoHeight - sourceSide) / 2);
    canvas.width = Math.min(targetWidth, sourceSide);
    canvas.height = canvas.width;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, sx, sy, sourceSide, sourceSide, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    worker.postMessage({ type: "frame", imageData }, [imageData.data.buffer]);
    submitted++;
    const elapsed = Math.max(.001, (performance.now() - startedCaptureAt) / 1000);
    text("#capture-rate", `${(captured / elapsed).toFixed(1)} FPS`);
    text("#submitted", String(submitted));
    schedule();
  };
  const schedule = () => {
    if (!running || run !== generation) return;
    if ("requestVideoFrameCallback" in video) callbackId = (video as any).requestVideoFrameCallback(frame);
    else callbackId = requestAnimationFrame(frame);
  };
  schedule();
}

function stop(): void {
  generation++;
  running = false;
  if ("cancelVideoFrameCallback" in video) (video as any).cancelVideoFrameCallback(callbackId);
  cancelAnimationFrame(callbackId);
  stream?.getTracks().forEach(track => track.stop());
  stream = null; video.srcObject = null;
  startButton.textContent = "开始接收";
  setCapability("#cap-camera", false, "已关闭");
}

function finish(message: any): void {
  stop();
  bar.style.width = "100%";
  text("#progress-percent", "100%");
  text("#progress-frames", `${message.uniquePackets} 个唯一包 · 校验完成`);
  setCapability("#cap-wasm", true, "校验通过");
  const completedAt = message.activeMs;
  const speed = activeTransferKiBps({ originalBytes: message.originalBytes, startedAt: 0, completedAt });
  text("#active-speed", `${speed.toFixed(1)} KiB/s`);
  text("#active-time", `${(message.activeMs / 1000).toFixed(2)} s`);
  text("#unique", String(message.uniquePackets));
  status.textContent = `接收完成 · V6 统一速率 ${speed.toFixed(1)} KiB/s`;
  const bytes = new Uint8Array(message.data);
  const url = URL.createObjectURL(new Blob([bytes], { type: message.mime }));
  const title = document.createElement("h2"); title.textContent = "文件接收完成";
  const meta = document.createElement("p"); meta.textContent = `${message.filename} · ${formatBytes(bytes.length)} · 纯传输 ${(message.activeMs / 1000).toFixed(2)} 秒`;
  result.append(title, meta);
  if (message.mime.startsWith("image/")) { const image = new Image(); image.src = url; result.append(image); }
  if (message.mime.startsWith("video/")) { const media = document.createElement("video"); media.src = url; media.controls = true; media.playsInline = true; result.append(media); }
  const download = document.createElement("a"); download.className = "download-button"; download.href = url; download.download = message.filename; download.textContent = `下载 ${message.filename}`; result.append(download);
}

function text(selector: string, value: string): void { $(selector).textContent = value; }
function formatBytes(value: number): string { return value < 1048576 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1048576).toFixed(2)} MiB`; }
function setCapability(selector: string, pass: boolean, label: string): void {
  const element = $(selector);
  element.className = pass ? "pass" : "";
  const value = element.querySelector("b");
  if (value) value.textContent = label;
}
