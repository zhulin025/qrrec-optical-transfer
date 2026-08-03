import { describe, expect, it } from "vitest";
import { unwrapV6Envelope, wrapV6Envelope } from "./envelope";

describe("V6 file envelope", () => {
  it("round-trips and verifies SHA-256", async () => {
    const source = new TextEncoder().encode("QRREC V6 integrity");
    expect(await unwrapV6Envelope(await wrapV6Envelope(source))).toEqual(source);
  });

  it("rejects corrupted payload bytes", async () => {
    const wrapped = await wrapV6Envelope(new Uint8Array([1, 2, 3, 4]));
    wrapped[wrapped.length - 1] ^= 1;
    await expect(unwrapV6Envelope(wrapped)).rejects.toThrow("SHA-256");
  });
});
