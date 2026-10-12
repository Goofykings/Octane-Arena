import { Vector3 } from "three";
import type { Simulation } from "../physics/simulation";
import {
  predictBallTrajectory,
  type TrajectoryPoint,
  type GoalPrediction,
} from "../game/ball-prediction";
import type { BotDifficulty } from "../../shared/bots";
export const BOT_TUNING = {
  beginner: {
    hz: 3,
    horizon: 0.8,
    error: 1.05,
    boostReserve: 22,
    aerialHeight: 0,
  },
  intermediate: {
    hz: 6,
    horizon: 1.8,
    error: 0.2,
    boostReserve: 12,
    aerialHeight: 5,
  },
  advanced: {
    hz: 10,
    horizon: 3,
    error: 0.04,
    boostReserve: 7,
    aerialHeight: 8,
  },
};
export class BotPerception {
  samples: TrajectoryPoint[] = [];
  goal: GoalPrediction | null = null;
  updates = 0;
  private next = -Infinity;
  private previous = -Infinity;
  constructor(readonly difficulty: BotDifficulty) {}
  update(s: Simulation) {
    if (s.clock < this.previous) this.next = -Infinity;
    this.previous = s.clock;
    if (s.clock < this.next) return false;
    this.next = s.clock + 1 / BOT_TUNING[this.difficulty].hz;
    this.updates++;
    const result = predictBallTrajectory(
      {
        position: s.ball.translation(),
        velocity: s.ball.linvel(),
        heat: s.heatseeker?.state ?? null,
      },
      s.world,
      BOT_TUNING[this.difficulty].horizon,
    );
    this.samples = result.samples.filter(
      (p, i) => i === 0 || i % 6 === 0 || i === result.samples.length - 1,
    );
    this.goal = result.goal;
    return true;
  }
}
