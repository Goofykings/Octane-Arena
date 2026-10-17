import type { Simulation } from "./simulation";
/** Rapier 0.19 updates its query broadphase with step(). Snapshot worlds never
 * advance moving objects: disable them, refresh static queries, then restore flags.
 * Called on Dropshot topology changes only, never per render/physics tick. */
export function refreshStaticQueries(
  s: Pick<Simulation, "world" | "cars" | "ball">,
) {
  const enabled = s.cars.map((c) => c.body.isEnabled()),
    ball = s.ball.isEnabled();
  for (const c of s.cars) c.body.setEnabled(false);
  s.ball.setEnabled(false);
  s.world.step();
  s.cars.forEach((c, i) => c.body.setEnabled(enabled[i]));
  s.ball.setEnabled(ball);
}
