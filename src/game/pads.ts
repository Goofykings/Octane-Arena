import type { Car } from "../car/car";
import { P } from "../config/physics";
export interface Pad {
  x: number;
  z: number;
  large: boolean;
  cooldown: number;
  pulse?: number;
}
export const padRespawn = (pad: Pick<Pad, "large">) => (pad.large ? 10 : 4);
export const padRecharge = (pad: Pad) =>
  Math.max(0, Math.min(1, 1 - pad.cooldown / padRespawn(pad)));
export class Pads {
  items: Pad[] = [];
  constructor() {
    for (const x of [-30, 30])
      for (const z of [-37, 0, 37])
        this.items.push({ x, z, large: true, cooldown: 0 });
    for (const z of [-32, -16, 0, 16, 32])
      for (const x of [-15, 0, 15])
        if (x !== 0 || z !== 0)
          this.items.push({ x, z, large: false, cooldown: 0 });
  }
  reset() {
    this.items.forEach((p) => {
      p.cooldown = 0;
      p.pulse = 0;
    });
  }
  tick(cars: Car[]) {
    const pickups: { car: Car; pad: Pad }[] = [];
    for (const p of this.items) {
      p.pulse = Math.max(0, (p.pulse ?? 0) - P.dt);
      p.cooldown = Math.max(0, p.cooldown - P.dt);
      if (p.cooldown) continue;
      for (const c of cars) {
        if (!c.body.isEnabled()) continue;
        const t = c.body.translation();
        if (
          c.boost < 100 &&
          t.y < 1.65 &&
          Math.hypot(t.x - p.x, t.z - p.z) < (p.large ? 2.08 : 1.44)
        ) {
          c.boost = p.large ? 100 : Math.min(100, c.boost + 12);
          p.cooldown = padRespawn(p);
          p.pulse = 0.28;
          pickups.push({ car: c, pad: p });
          break;
        }
      }
    }
    return pickups;
  }
}
