import { describe, expect, it } from "vitest";
import { activeTransferKiBps, payloadRateKiBps } from "./metrics";

describe("V6 unified speed metric", () => {
  it("uses original file bytes over active optical time", () => {
    expect(activeTransferKiBps({ originalBytes: 1024 * 10, startedAt: 1000, completedAt: 3000 })).toBe(5);
  });

  it("does not report a rate for an invalid interval", () => {
    expect(activeTransferKiBps({ originalBytes: 1024, startedAt: 1000, completedAt: 1000 })).toBe(0);
  });

  it("keeps unique payload rate as a separate diagnostic", () => {
    expect(payloadRateKiBps(2048, 1000, 2000)).toBe(2);
  });
});
