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
  smallCorrection: 0.03,
  correctionRate: 12,
  collisionCorrectionRate: 35,
  inputBatchSize: 64,
  contactHistorySeconds: 0.35,
  contactHistorySize: 12,
  ballPredictionRange: 7,
  ballPredictionBlendRate: 18,
} as const;
/** Keep the 30 Hz cadence on tick buckets instead of accumulating timer overshoot. */
export function snapshotBucket(tick: number) {
  return Math.floor(tick / NETWORK.snapshotTicks);
}
