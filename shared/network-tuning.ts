/** SI seconds; physics stays at the existing 120 Hz. */
export const NETWORK = {
  physicsHz: 120,
  snapshotHz: 30,
  snapshotTicks: 4,
  metadataSeconds: 0.2,
  interpolationSeconds: 0.1,
  extrapolationSeconds: 0.12,
  bufferSize: 32,
  predictionHistory: 120,
  stalePredictionSeconds: 0.25,
  hardCorrection: 6,
} as const;
/** Keep the 30 Hz cadence on tick buckets instead of accumulating timer overshoot. */
export function snapshotBucket(tick: number) {
  return Math.floor(tick / NETWORK.snapshotTicks);
}
