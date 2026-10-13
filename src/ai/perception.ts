import { Vector3 } from "three";
import type { Simulation } from "../physics/simulation";
import {
  predictGoal,
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
  readonly pool: TrajectoryPoint[];
  private lastPoint: TrajectoryPoint = {
    time: 0,
    position: new Vector3(),
    velocity: new Vector3(),
  };
  constructor(readonly difficulty: BotDifficulty) {
    this.pool = Array.from(
      { length: Math.ceil((BOT_TUNING[difficulty].horizon * 60) / 6) + 2 },
      () => ({ time: 0, position: new Vector3(), velocity: new Vector3() }),
    );
  }
  prepare(s: Simulation) {
    this.next = -Infinity;
    return this.update(s);
  }
  update(s: Simulation) {
    if (s.clock < this.previous) this.next = -Infinity;
    this.previous = s.clock;
    if (s.clock < this.next) return false;
    this.next = s.clock + 1 / BOT_TUNING[this.difficulty].hz;
    this.updates++;
    this.samples.length = 0;
    let index = 0,
      lastStored = -1;
    const store = (time: number, position: Vector3, velocity: Vector3) => {
      const point = this.pool[this.samples.length];
      point.time = time;
      point.position.copy(position);
      point.velocity.copy(velocity);
      this.samples.push(point);
    };
    this.goal = predictGoal(
      {
        position: s.ball.translation(),
        velocity: s.ball.linvel(),
        heat: s.heatseeker?.state ?? null,
      },
      s.world,
      BOT_TUNING[this.difficulty].horizon,
      (time, position, velocity) => {
        if (index % 6 === 0) {
          store(time, position, velocity);
          lastStored = index;
        }
        this.lastPoint.time = time;
        this.lastPoint.position.copy(position);
        this.lastPoint.velocity.copy(velocity);
        index++;
      },
    );
    if (index && lastStored !== index - 1)
      store(
        this.lastPoint.time,
        this.lastPoint.position,
        this.lastPoint.velocity,
      );
    return true;
  }
}
