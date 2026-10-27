import assert from "node:assert/strict";
import { Quaternion, Vector3, Scene } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput as n } from "../shared/player";
import { P } from "../src/config/physics";
import { chassisPoints } from "../src/car/chassis";
import { GoalExplosion } from "../src/effects/goal-explosion";
await initializeSimulation();
function tracking(
  speed: number,
  side: number,
  slide: boolean,
  enhanced: boolean,
) {
  const s = new Simulation(true),
    c = s.cars[0];
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  try {
    c.reset(0, 0, 0);
    for (let i = 0; i < 120; i++) s.step([{ ...n(), slide }, n()]);
    assert.ok(c.stableContact);
    void enhanced;
    c.body.setLinvel({ x: side, y: 0, z: -speed }, true);
    let distance = 0,
      maxCorrection = 0,
      maxFraction = 0,
      previous = side;
    for (let i = 0; i < 12; i++) {
      s.step([{ ...n(), throttle: 1, slide }, n()]);
      const v = c.body.linvel();
      distance += Math.abs(v.x) * P.dt;
      maxCorrection = Math.max(maxCorrection, Math.abs(v.x - previous));
      maxFraction = Math.max(
        maxFraction,
        Math.abs(v.x - previous) / Math.max(Math.abs(previous), 1e-3),
      );
      previous = v.x;
    }
    return {
      slip: Math.abs(c.body.linvel().x),
      distance,
      maxCorrection,
      maxFraction,
    };
  } finally {
    s.dispose();
  }
}
// RL tire model: grip removes a fraction of lateral slip per tick.
const fast = tracking(23, 1, false, true),
  slow = tracking(8, 1, false, true),
  old = tracking(23, 1, true, true);
assert.ok(
  fast.slip < 0.2 && slow.slip < 0.2,
  "Small slip settles within 0.1 s at any speed: no permanent drift",
);
assert.ok(
  fast.maxFraction < 0.3 && slow.maxFraction < 0.3,
  "Finite tire response, no velocity snapping",
);
assert.ok(old.slip > 0.6, "Engaged powerslide keeps the slide");
for (const speed of [8, 23])
  assert.ok(
    tracking(speed, 4, true, true).slip > 2.5,
    "Powerslide is the intentional low-grip state",
  );
const large = tracking(15, 12, false, true);
assert.ok(
  large.slip > 1 && large.slip < 6,
  "Large off-angle slip slides briefly, then grips",
);
for (const id of ["ion", "vector"] as const)
  for (const throttle of [-1, 1]) {
    const s = new Simulation(true),
      c = s.cars[0];
    s.ball.setEnabled(false);
    s.cars[1].body.setEnabled(false);
    c.setBody(id);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    c.reset(0, 0, 0, 3);
    c.body.setRotation(q, true);
    for (let i = 0; i < 12; i++) {
      s.step([{ ...n(), throttle }, n()]);
      assert.equal(c.recovering, false, "No unsupported aerial recovery");
    }
    const height =
      -Math.min(...chassisPoints(id).map((p) => p.applyQuaternion(q).y)) +
      P.car.contactSkin;
    c.body.setTranslation({ x: 0, y: height, z: 0 }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.step([{ ...n(), throttle }, n()]);
    assert.ok(
      c.recovering,
      "Preheld throttle triggers on first supported upside-down tick",
    );
    let turns = 0,
      previous = new Quaternion().copy(c.body.rotation()),
      starts = 1,
      was = true;
    for (let i = 0; i < 360; i++) {
      s.step([{ ...n(), throttle }, n()]);
      const current = new Quaternion().copy(c.body.rotation());
      turns += previous.angleTo(current);
      previous = current;
      if (c.recovering && !was) starts++;
      was = c.recovering;
    }
    assert.equal(starts, 1);
    assert.ok(turns < Math.PI * 1.35, "No full revolution");
    assert.ok(c.grounded && c.up.y > 0.99, "Stops cleanly on wheels");
    s.dispose();
  }
for (const id of ["blue-wash", "violet-wash"]) {
  const scene = new Scene(),
    e = new GoalExplosion(scene);
  e.trigger({ x: 0, y: 2, z: -52 }, 0x69e9ff, id);
  e.update(0.03);
  const flash = e.washStrength;
  assert.ok(flash > 0.4 && flash < 0.96);
  e.update(0.1);
  assert.equal(e.washStrength, 0.96);
  e.update(0.8);
  assert.equal(e.washStrength, 0.96, "Brief color flood hold");
  e.update(1.1);
  assert.ok(e.washStrength > 0 && e.washStrength < 0.96, "Smooth fade");
  e.update(1.4);
  assert.equal(e.washStrength, 0);
  e.reset();
  assert.equal(e.washStrength, 0);
  e.dispose();
  assert.equal(scene.children.length, 0);
}
console.log(
  "PASS increased high-speed planted grip, finite forces, unchanged low-speed/powerslide/large-slip response, first-tick preheld roof recovery both bodies/directions without overshoot, strong flash/hold/fade and cleanup",
  { fast, old },
);
