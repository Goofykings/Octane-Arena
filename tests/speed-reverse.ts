import assert from "node:assert/strict";
import * as T from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { GameCamera } from "../src/camera/camera";
import { AirSpeedState } from "../src/effects/air-speed";
import { P } from "../src/config/physics";
import { defaultBindings } from "../shared/controls";
import { insideArena } from "../src/arena/physics";
await initializeSimulation();
assert.equal(
  Object.values(defaultBindings).filter(
    (key) => key === defaultBindings.reverseCam,
  ).length,
  1,
);
const speed = new AirSpeedState(),
  dt = 1 / 60;
for (let i = 0; i < 60; i++)
  speed.update(dt, P.car.maxSpeed, true, true, "high", true);
assert.equal(speed.intensity, 0);
for (let i = 0; i < 60; i++)
  speed.update(dt, P.supersonic.start - 1, true, false, "high", true);
assert.equal(speed.intensity, 0);
const first = speed.update(dt, P.supersonic.start, true, false, "high", true);
assert.ok(first > 0 && first < 0.2);
for (let i = 0; i < 60; i++)
  speed.update(dt, P.supersonic.start, true, false, "high", true);
const early = speed.intensity;
for (let i = 0; i < 60; i++)
  speed.update(dt, P.car.maxSpeed, true, false, "high", true);
assert.ok(speed.intensity > early * 3 && speed.intensity <= 1);
const maximum = speed.intensity;
speed.update(dt, P.car.maxSpeed, true, true, "high", true);
assert.ok(speed.intensity > 0 && speed.intensity < maximum);
for (let i = 0; i < 120; i++)
  speed.update(dt, P.car.maxSpeed, true, true, "high", true);
assert.ok(speed.intensity < 0.001);
speed.update(dt, P.car.maxSpeed, true, false, "low", true);
assert.equal(speed.intensity, 0);
for (let i = 0; i < 60; i++)
  speed.update(dt, P.car.maxSpeed, true, false, "medium", true);
assert.ok(speed.intensity > 0.4 && speed.intensity < 0.46);
speed.update(dt, 0, false, true, "high", false);
assert.equal(speed.intensity, 0);
const sim = new Simulation(true),
  car = new T.Group(),
  ball = new T.Group();
car.position.set(0, 0.32, 0);
const cameraA = new T.PerspectiveCamera(110, 16 / 9, 0.1, 200),
  cameraB = cameraA.clone(),
  normal = new GameCamera(cameraA),
  reverse = new GameCamera(cameraB);
try {
  for (const ballMode of [true, false]) {
    normal.ballMode = reverse.ballMode = ballMode;
    normal.reset();
    reverse.reset();
    for (let frame = 0; frame < 180; frame++) {
      const held = frame % 3 !== 0;
      ball.position.set(
        Math.sin(frame * 0.1) * 10,
        2 + Math.cos(frame * 0.1),
        Math.cos(frame * 0.1) * 10,
      );
      reverse.reverseHeld = held;
      normal.update(car, ball, sim, dt, false, frame * dt);
      reverse.update(car, ball, sim, dt, false, frame * dt);
      assert.equal(reverse.ballMode, ballMode);
      if (held) {
        assert.ok(
          cameraB.position.z < car.position.z,
          "Camera instantly goes in front",
        );
        const look = new T.Vector3(0, 0, -1).applyQuaternion(
          cameraB.quaternion,
        );
        assert.ok(look.z > 0.5, "Reverse look points behind");
        assert.equal(reverse.debug.mode, "Reverse Cam");
      } else {
        assert.ok(
          cameraA.position.distanceTo(cameraB.position) < 1e-6,
          "Instant current normal position, no return damping",
        );
        assert.ok(
          cameraA.quaternion.angleTo(cameraB.quaternion) < 1e-6,
          "Ball tracking continues under override",
        );
        assert.equal(cameraA.fov, cameraB.fov);
      }
    }
  }
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI, 0.8]) {
    car.position.set(0, 8, 0);
    car.rotation.set(angle, 0, 1.8);
    reverse.reverseHeld = true;
    reverse.update(car, ball, sim, dt, false, 4);
    assert.ok(
      [...cameraB.position.toArray(), ...cameraB.quaternion.toArray()].every(
        Number.isFinite,
      ),
    );
    const e = new T.Euler().setFromQuaternion(cameraB.quaternion, "YXZ");
    assert.ok(Math.abs(e.z) < 1e-5, "No inherited violent roll");
  }
  car.position.set(0, 0.32, 0);
  car.rotation.set(-1, 0, 0);
  reverse.update(car, ball, sim, dt, false, 5);
  assert.ok(cameraB.position.y > 0, "Reverse boom must not enter floor");
} finally {
  sim.dispose();
}
const arena = new Simulation();
try {
  for (const [x, y, z, pitch, yaw, roll] of [
    [40.3, 8, 0, 0, 0, Math.PI / 2],
    [39.8, 1.4, 0, 0, 0, 1],
    [39.5, 19.3, 0, Math.PI / 2, 0, 0],
    [0, 19.8, 0, Math.PI / 2, 0, 0],
    [0, 4.8, 55, 0, Math.PI, 0],
  ]) {
    car.position.set(x, y, z);
    car.rotation.set(pitch, yaw, roll);
    assert.ok(insideArena(arena.arenaCollider!, car.position));
    reverse.reset();
    reverse.reverseHeld = true;
    reverse.update(car, ball, arena, dt, false, 6);
    assert.ok(
      insideArena(arena.arenaCollider!, cameraB.position),
      "Reverse camera stays inside actual wall/ramp/upper/goal collision shell",
    );
    const horizon = new T.Euler().setFromQuaternion(cameraB.quaternion, "YXZ");
    assert.ok(Math.abs(horizon.z) < 1e-5);
  }
} finally {
  arena.dispose();
}
console.log(
  "PASS air-only threshold/fade/strength/quality gates, nonconflicting Reverse Cam bind, instant press/release, live Ball/Car Cam tracking, rapid repetition, wall/aerial horizon and floor clearance",
);
