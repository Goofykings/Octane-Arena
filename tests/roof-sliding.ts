import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { P } from "../src/config/physics";

await RAPIER.init();
const roofFriction = P.car.roofFriction;
function slide(body: "ion" | "vector", inverted: boolean, friction: number) {
  const s = new Simulation(true),
    c = s.cars[0];
  const constrainSurface = c.constrainSurface.bind(c);
  c.constrainSurface = (afterStep = false) => {
    constrainSurface(afterStep);
    if (!afterStep && c.collider.friction() > P.car.chassisFriction + 0.001)
      c.collider.setFriction(friction);
  };
  try {
    s.ball.setEnabled(false);
    s.cars[1].body.setEnabled(false);
    c.setBody(body);
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
  const previous = slide(body, true, P.car.chassisFriction);
  const current = slide(body, true, roofFriction);
  assert.ok(
    current.speed < previous.speed - 0.3,
    JSON.stringify({ previous, current }),
  );
  assert.ok(current.distance < previous.distance - 0.1);
  const uprightPrevious = slide(body, false, P.car.chassisFriction);
  const uprightCurrent = slide(body, false, roofFriction);
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
