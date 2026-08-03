import "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync as initRaptorQ } from "@raptorqr/raptorq-wasm";
import { RaptorQWasmDecoder } from "@raptorqr/core/fec/raptorq_wasm";
import { parsePacket } from "@raptorqr/core/protocol/packet";
import { packetizeRaptorQ } from "@raptorqr/core/sender/raptorq_packetizer";
import { createRaptorQPlaybackOrders } from "@raptorqr/core/sender/raptorq_playback";

beforeAll(() => initRaptorQ({ module: readFileSync(join(process.cwd(), "node_modules/@raptorqr/raptorq-wasm/src/wasm/raptorqr_raptorq_wasm_bg.wasm")) }));

describe("V6 burst-loss recovery", () => {
  for (const burst of [1, 2, 4, 8]) {
    it(`recovers after a ${burst}-display-frame burst loss in four-QR mode`, async () => {
      const source = new Uint8Array(360_000); source.forEach((_, index) => source[index] = (index * 31 + 7) & 255);
      const encoded = await packetizeRaptorQ(source, false, false, undefined, undefined, { maxTransportPayloadSize: 1716, repairPercent: 30 });
      const order = createRaptorQPlaybackOrders(encoded.sourcePacketIndices, encoded.repairPacketIndices, "balanced").loopOrder;
      const decoder = await RaptorQWasmDecoder.create(encoded.dataLength, encoded.symbolSize);
      const burstStart = 12;
      let result: Uint8Array | null = null;
      for (let slot = 0; slot < order.length; slot++) {
        const displayFrame = Math.floor(slot / 4);
        if (displayFrame >= burstStart && displayFrame < burstStart + burst) continue;
        result = decoder.push(parsePacket(encoded.packets[order[slot]!]!).payload);
        if (result) break;
      }
      expect(result?.slice(0, source.length)).toEqual(source);
    });
  }
});
