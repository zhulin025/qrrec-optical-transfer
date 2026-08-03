import "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import { initSync as initRaptorQ } from "@raptorqr/raptorq-wasm";
import { RaptorQWasmDecoder } from "@raptorqr/core/fec/raptorq_wasm";
import { createQRTransferProfile } from "@raptorqr/core/protocol/profiles";
import { parsePacket } from "@raptorqr/core/protocol/packet";
import { decodeQRCodesFromCanvas } from "@raptorqr/core/qr/qr_decode";
import { renderQRCodeImageData } from "@raptorqr/core/qr/qr_encoder_browser";
import { packetizeRaptorQ } from "@raptorqr/core/sender/raptorq_packetizer";
import { createRaptorQPlaybackOrders } from "@raptorqr/core/sender/raptorq_playback";

const VERSION = 30, FPS = 30, SECONDS = 10, PARALLEL = 4, TOTAL = FPS * SECONDS * PARALLEL, DROPS = 200;

describe("V6 synthetic optical release gate", () => {
  test("rebuilds a V30-L four-QR stream after 200 deterministic symbol losses", async () => {
    initRaptorQ({ module: readFileSync(join(process.cwd(), "node_modules/@raptorqr/raptorq-wasm/src/wasm/raptorqr_raptorq_wasm_bg.wasm")) });
    const profile = createQRTransferProfile(VERSION, "L", "fast-qr-wasm");
    const sourceCount = TOTAL - DROPS;
    const payload = deterministicBytes(sourceCount * (profile.maxPayloadSize - 4));
    const packetized = await packetizeRaptorQ(payload, false, false, undefined, undefined, { maxTransportPayloadSize: profile.maxPayloadSize, repairPercent: 20 });
    expect(packetized.packets).toHaveLength(TOTAL);
    const order = createRaptorQPlaybackOrders(packetized.sourcePacketIndices, packetized.repairPacketIndices, "balanced").loopOrder;
    const dropped = deterministicDrops(TOTAL, DROPS);
    const tile = (VERSION * 4 + 17 + 8) * 2;
    const compositeSide = tile * 2;
    const decoder = await RaptorQWasmDecoder.create(packetized.dataLength, profile.maxPayloadSize);
    const seen = new Set<string>();
    let reconstructed: Uint8Array | null = null;
    let parsed = 0;
    const started = performance.now();

    for (let display = 0; display < FPS * SECONDS && !reconstructed; display++) {
      const composite = new Uint8ClampedArray(compositeSide * compositeSide * 4); composite.fill(255);
      for (let lane = 0; lane < PARALLEL; lane++) {
        const slot = display * PARALLEL + lane;
        if (dropped.has(slot)) continue;
        const image = await renderQRCodeImageData(packetized.packets[order[slot]!]!, VERSION, "L", 2, "fast-qr-wasm");
        blit(composite, compositeSide, image.data, image.width, image.height, (lane % 2) * tile, Math.floor(lane / 2) * tile);
      }
      const decoded = await decodeQRCodesFromCanvas(new ImageData(composite, compositeSide, compositeSide), PARALLEL);
      for (const symbol of decoded) {
        const packet = parsePacket(symbol.bytes);
        const id = Array.from(packet.payload.slice(0, 4)).join(":");
        if (seen.has(id)) continue;
        seen.add(id); parsed++;
        reconstructed = decoder.push(packet.payload);
        if (reconstructed) break;
      }
    }
    const elapsed = (performance.now() - started) / 1000;
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.slice(0, payload.length)).toEqual(payload);
    expect(parsed).toBe(sourceCount);
    const scheduledRate = (payload.length / 1024) / SECONDS;
    console.info("[V6 benchmark]", { payloadBytes: payload.length, parsed, elapsedSeconds: +elapsed.toFixed(2), scheduledKiBps: +scheduledRate.toFixed(2), parserDisplayFps: +(FPS * SECONDS / elapsed).toFixed(2) });
    expect(scheduledRate).toBeGreaterThan(150);
    expect(FPS * SECONDS / elapsed).toBeGreaterThan(30);
  }, 300_000);
});

function deterministicBytes(length: number): Uint8Array { const out = new Uint8Array(length); let state = 0x9e3779b9; for (let i = 0; i < length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; out[i] = (state + i) & 255; } return out; }
function deterministicDrops(total: number, count: number): Set<number> { const values = Array.from({ length: total }, (_, i) => i); let state = 0x30f51200; for (let i = values.length - 1; i > 0; i--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const j = state % (i + 1); [values[i], values[j]] = [values[j]!, values[i]!]; } return new Set(values.slice(0, count)); }
function blit(target: Uint8ClampedArray, targetWidth: number, source: Uint8ClampedArray, width: number, height: number, x: number, y: number): void { for (let row = 0; row < height; row++) target.set(source.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * targetWidth + x) * 4); }
