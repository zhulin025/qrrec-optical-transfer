import { packetizeRaptorQ } from "@raptorqr/core/sender/raptorq_packetizer";
import { createRaptorQPlaybackOrders } from "@raptorqr/core/sender/raptorq_playback";
import { wrapV6Envelope } from "../shared/envelope";

self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type !== "encode") return;
  void (async () => {
    try {
      const original = new Uint8Array(message.data);
      const wrapped = await wrapV6Envelope(original);
      const result = await packetizeRaptorQ(
        wrapped,
        false,
        message.compress,
        message.filename,
        message.mimeType,
        { maxTransportPayloadSize: message.payloadSize, repairPercent: message.repairPercent },
      );
      const orders = createRaptorQPlaybackOrders(
        result.sourcePacketIndices,
        result.repairPacketIndices,
        message.strategy,
      );
      self.postMessage({
        type: "encoded",
        packets: result.packets,
        initialOrder: orders.initialOrder,
        loopOrder: orders.loopOrder,
        originalSize: message.originalSize,
        encodedSize: result.dataLength,
        sourcePackets: result.sourcePacketIndices.length,
        repairPackets: result.repairPacketIndices.length,
      });
    } catch (error) {
      self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
