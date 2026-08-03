import { createQRTransferProfile } from "@raptorqr/core/protocol/profiles";
import "../../shared/style.css";
import "../style.css";

type ParallelCount = 1 | 2 | 4;
type Rendered = { image: ImageData; width: number; height: number };

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const fileInput = $("#file") as HTMLInputElement;
const startButton = $("#start") as HTMLButtonElement;
const stopButton = $("#stop") as HTMLButtonElement;
const stage = $("#stage");
const grid = $("#qr-grid");
const status = $("#status");
const fileInfo = $("#file-info");
const actualRate = $("#actual-rate");
const cacheInfo = $("#cache-info");
const cycleInfo = $("#cycle-info");

let generation = 0;
let animation = 0;
let activePool: RenderPool | null = null;

fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  fileInfo.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "尚未选择文件";
};
startButton.onclick = () => void begin();
stopButton.onclick = stop;
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && stage.classList.contains("active")) stop();
});

async function begin(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) { status.textContent = "请先选择文件"; return; }
  stop();
  const run = ++generation;
  const version = numberValue("#version");
  const ecc = ($("#ecc") as HTMLSelectElement).value as "L" | "M";
  const fps = numberValue("#fps");
  const parallel = numberValue("#parallel") as ParallelCount;
  const repairPercent = numberValue("#repair");
  const profile = createQRTransferProfile(version, ecc, "fast-qr-wasm");
  const source = await file.arrayBuffer();
  status.textContent = "正在使用 RaptorQ 编码…";

  const encoded = await encode({
    data: source,
    originalSize: file.size,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    compress: ($("#compress") as HTMLInputElement).checked,
    payloadSize: profile.maxPayloadSize,
    repairPercent,
    strategy: ($("#strategy") as HTMLSelectElement).value,
  });
  if (run !== generation) return;

  const canvases = buildCanvases(parallel);
  const scale = parallel === 1 ? 6 : version >= 30 ? 3 : 4;
  const pool = new RenderPool(parallel);
  activePool = pool;
  const cache = new Map<number, Rendered>();
  const pending = new Set<number>();
  const cacheFrames = Math.max(6, Math.ceil(fps * 1.5));
  let order = encoded.initialOrder as number[];
  let tick = 0;
  let cycles = 0;
  let drawn = 0;
  let skipped = 0;
  let firstDrawAt = 0;
  let lastStatsAt = performance.now();
  let nextAt = performance.now();

  stage.classList.add("active");
  document.body.classList.add("transmitting");
  status.textContent = "正在预渲染高速码流…";
  try { await stage.requestFullscreen(); } catch { /* viewport fallback */ }

  const frameCount = () => Math.max(1, Math.ceil(order.length / parallel));
  const packetAt = (frame: number, lane: number) => order[frame * parallel + lane];
  const fillWindow = (startFrame: number) => {
    for (let offset = 0; offset < cacheFrames; offset++) {
      const frame = (startFrame + offset) % frameCount();
      for (let lane = 0; lane < parallel; lane++) {
        const packetIndex = packetAt(frame, lane);
        if (packetIndex === undefined || cache.has(packetIndex) || pending.has(packetIndex)) continue;
        pending.add(packetIndex);
        void pool.render(encoded.packets[packetIndex], version, ecc, scale).then(rendered => {
          pending.delete(packetIndex);
          if (run === generation) cache.set(packetIndex, rendered);
        }).catch(error => {
          pending.delete(packetIndex);
          status.textContent = `QR 渲染失败：${error.message}`;
        });
      }
    }
  };
  fillWindow(0);

  const loop = (now: number) => {
    if (run !== generation) return;
    animation = requestAnimationFrame(loop);
    if (now < nextAt) return;
    const frame = tick % frameCount();
    const images: Array<Rendered | null> = [];
    for (let lane = 0; lane < parallel; lane++) {
      const packetIndex = packetAt(frame, lane);
      images.push(packetIndex === undefined ? null : cache.get(packetIndex) ?? null);
    }
    if (images.every(Boolean)) {
      images.forEach((rendered, lane) => rendered && draw(canvases[lane]!, rendered.image));
      if (!firstDrawAt) firstDrawAt = now;
      drawn++;
      tick++;
      status.textContent = "V6 RaptorQ 高速传输中";
      if (tick >= frameCount()) {
        tick = 0;
        cycles++;
        order = encoded.loopOrder;
        cache.clear();
      }
      fillWindow(tick);
      const keep = new Set<number>();
      for (let offset = 0; offset < cacheFrames + 2; offset++) {
        const f = (tick + offset) % frameCount();
        for (let lane = 0; lane < parallel; lane++) {
          const index = packetAt(f, lane); if (index !== undefined) keep.add(index);
        }
      }
      for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
    } else {
      skipped++;
      fillWindow(frame);
    }
    if (now - lastStatsAt >= 500) {
      const seconds = firstDrawAt ? (now - firstDrawAt) / 1000 : 0;
      const measuredFps = seconds > 0 ? drawn / seconds : 0;
      actualRate.textContent = `${measuredFps.toFixed(1)} FPS · ${(measuredFps * parallel).toFixed(1)} QR/s`;
      cacheInfo.textContent = `${cache.size} 已就绪 · ${pending.size} 渲染中 · ${skipped} 次等待`;
      cycleInfo.textContent = `第 ${cycles + 1} 轮 · ${encoded.sourcePackets} 源包 + ${encoded.repairPackets} 修复包 · ${formatBytes(encoded.encodedSize)}`;
      lastStatsAt = now;
    }
    nextAt += 1000 / fps;
    if (now - nextAt > 250) nextAt = now + 1000 / fps;
  };
  animation = requestAnimationFrame(loop);
}

function stop(): void {
  generation++;
  cancelAnimationFrame(animation);
  activePool?.terminate();
  activePool = null;
  stage.classList.remove("active");
  document.body.classList.remove("transmitting");
  if (document.fullscreenElement) void document.exitFullscreen();
}

function encode(input: Record<string, unknown>): Promise<any> {
  const worker = new Worker(new URL("./encode.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = event => {
      worker.terminate();
      event.data.type === "error" ? reject(new Error(event.data.message)) : resolve(event.data);
    };
    worker.onerror = error => { worker.terminate(); reject(error); };
    worker.postMessage({ type: "encode", ...input });
  });
}

class RenderPool {
  private workers: Worker[] = [];
  private pending = new Map<number, { resolve: (value: Rendered) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private cursor = 0;
  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = event => {
        const job = this.pending.get(event.data.id); if (!job) return;
        this.pending.delete(event.data.id);
        if (event.data.type === "error") job.reject(new Error(event.data.message));
        else job.resolve({ image: new ImageData(new Uint8ClampedArray(event.data.buffer), event.data.width, event.data.height), width: event.data.width, height: event.data.height });
      };
      this.workers.push(worker);
    }
  }
  render(packet: Uint8Array, version: number, ecc: string, scale: number): Promise<Rendered> {
    const id = this.nextId++;
    const copy = packet.slice().buffer;
    const worker = this.workers[this.cursor++ % this.workers.length]!;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "render", id, packet: copy, version, ecc, scale }, [copy]);
    });
  }
  terminate(): void { this.workers.forEach(worker => worker.terminate()); this.workers = []; this.pending.clear(); }
}

function buildCanvases(count: ParallelCount): HTMLCanvasElement[] {
  grid.className = `parallel-${count}`;
  grid.replaceChildren();
  return Array.from({ length: count }, () => {
    const canvas = document.createElement("canvas"); grid.append(canvas); return canvas;
  });
}
function draw(canvas: HTMLCanvasElement, image: ImageData): void {
  if (canvas.width !== image.width || canvas.height !== image.height) { canvas.width = image.width; canvas.height = image.height; }
  canvas.getContext("2d")!.putImageData(image, 0, 0);
}
function numberValue(selector: string): number { return Number(($(selector) as HTMLInputElement | HTMLSelectElement).value); }
function formatBytes(value: number): string { return value < 1048576 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1048576).toFixed(2)} MiB`; }
