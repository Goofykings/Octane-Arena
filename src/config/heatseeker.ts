import { P } from "./physics";
// Original gameplay calibration, not official Rocket League constants.
export const HEATSEEKER = {
  initialSpeed: 70 / 3.6, // 70 km/h = 19.444 m/s = 1944.4 uu/s.
  speedIncrement: 2.5,
  maxSpeed: P.ball.maxSpeed,
  acceleration: 45, // m/s² speed tracking, without erasing contact impulses.
  maxTurnRate: 2.2, // rad/s.
  homingStrength: 2.8,
  touchCooldown: 0.15,
  targetDepth: 3,
  kickoffBallSpawn: { right: 10, forward: 18 }, // Relative to the serving formation center.
  kickoffCarDistance: 38,
  backboardWidth: P.arena.goalHalf + 12,
  backboardHeight: P.arena.goalHeight + 8,
  backboardTolerance: 0.18,
  backboardNormal: 0.9,
} as const;
