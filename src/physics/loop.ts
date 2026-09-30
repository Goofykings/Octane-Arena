import { P } from "../config/physics";
export class FixedLoop {
  accumulator = 0;
  dropped = 0;
  advance(delta: number, step: () => void) {
    this.accumulator += Math.min(Math.max(delta, 0), 0.1);
    let steps = 0;
    while (this.accumulator + 1e-10 >= P.dt && steps < P.maxSteps) {
      step();
      this.accumulator -= P.dt;
      steps++;
    }
    if (this.accumulator >= P.dt) {
      this.dropped += this.accumulator;
      this.accumulator %= P.dt;
    }
    return { alpha: Math.max(0, this.accumulator / P.dt), steps };
  }
}
