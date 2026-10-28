/** Cosmetic only: fractions of the existing 18 cm wheel radius, SI/radians. */
export const VEHICLE_VISUALS = {
  compressionRadius: 0.035, // 0.63 cm above the authored wheel mount.
  extensionRadius: 0.16, // 2.88 cm below it.
  compressionResponse: 160,
  extensionResponse: 20,
  accelerationResponse: 12,
  longitudinalAcceleration: 18,
  lateralAcceleration: 25,
  maxPitch: 0.028,
  pitchClearanceStart: 0.014, // Keep the previous arch clearance when pitch exceeds its old limit.
  maxRoll: 0.021,
  longitudinalTransferRadius: 0.084, // Axle bias: 15.12 mm before the total travel clamp.
  lateralTransferRadius: 0.042, // Side bias: 7.56 mm before the total travel clamp.
  maxFrameTime: 0.1,
  teleportDistance: 4,
} as const;
