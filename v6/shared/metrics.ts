export interface ActiveTransferSample {
  originalBytes: number;
  startedAt: number;
  completedAt: number;
}
/**
 * V6's published speed: original file bytes divided by active optical time.
 * The clock starts at the first valid unique packet and stops after the file
 * has been reconstructed and decompressed. Camera setup time is excluded.
 */
export function activeTransferKiBps(sample: ActiveTransferSample): number {
  const elapsedMs = sample.completedAt - sample.startedAt;
  if (sample.originalBytes <= 0 || elapsedMs <= 0) return 0;
  return (sample.originalBytes / 1024) / (elapsedMs / 1000);
}

export function payloadRateKiBps(uniquePayloadBytes: number, startedAt: number, now: number): number {
  const elapsedMs = now - startedAt;
  if (uniquePayloadBytes <= 0 || elapsedMs <= 0) return 0;
  return (uniquePayloadBytes / 1024) / (elapsedMs / 1000);
}
