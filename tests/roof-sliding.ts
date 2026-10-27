import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { P } from "../src/config/physics";

await RAPIER.init();
// RL car/world friction (0.3) is constant; there is no roof-only friction switch.
function slide(body: "ion" | "vector", inverted: boolean, friction: number) {
  const s = new Simulation(true),
    c = s.cars[0];
  try {
    s.ball.setEnabled(false);
    s.cars[1].body.setEnabled(false);
    c.setBody(body);
    c.collider.setFriction(friction);
    c.reset(0, 0, 0, 0.6);
    if (inverted)
      c.body.setRotation(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
        true,
      );
    const step = () => s.step([neutral(), neutral()]);
    for (let i = 0; i < 120; i++) step();
    c.body.setLinvel({ x: 10, y: 0, z: 0 }, true);
    const start = c.body.translation().x;
    for (let i = 0; i < 120; i++) step();
    assert.equal(s.containmentRecoveries, 0);
    assert.ok(c.body.translation().y > 0);
    if (inverted) assert.ok(c.up.y < -0.95);
    return {
      distance: c.body.translation().x - start,
      speed: Math.abs(c.body.linvel().x),
    };
  } finally {
    s.dispose();
  }
}
for (const body of ["ion", "vector"] as const) {
  const previous = slide(body, true, 0.02);
  const current = slide(body, true, P.car.chassisFriction);
  assert.ok(
    current.speed < previous.speed - 0.3,
    JSON.stringify({ previous, current }),
  );
  assert.ok(current.distance < previous.distance - 0.1);
  assert.ok(current.speed < 10 - 0.6 * P.car.chassisFriction * P.gravity);
  // Upright, the chassis never touches: tires alone govern the slide.
  const uprightPrevious = slide(body, false, 0.02);
  const uprightCurrent = slide(body, false, P.car.chassisFriction);
  assert.deepEqual(uprightCurrent, uprightPrevious);
  console.log("PASS roof braking and unchanged tire sliding", body, {
    previous,
    current,
  });
}

const s = new Simulation(true),
  c = s.cars[0];
try {
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  c.reset(0, 0, 0, 40);
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    s.step([{ ...neutral(), roll: 1 }, neutral()]);
    peak = Math.max(peak, new Vector3().copy(c.body.angvel()).length());
  }
  assert.ok(Math.abs(peak - P.car.maxAngular) < 0.001, String(peak));
  console.log("PASS ordinary rotation reaches raised cap", peak);
} finally {
  s.dispose();
}
