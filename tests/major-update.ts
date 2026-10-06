import RAPIER from "@dimforge/rapier3d-compat";
import {
  Vector3,
  Quaternion,
  Matrix4,
  Group,
  PerspectiveCamera,
  Mesh,
  Box3,
} from "three";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { P } from "../src/config/physics";
import {
  ballModel,
  carModel,
  animateBall,
  disposeModel,
} from "../src/render/models";
import { GameCamera } from "../src/camera/camera";
await RAPIER.init();
const results: Record<string, unknown> = {};
function setup(flat = true) {
  const s = new Simulation(flat);
  s.cars[1].body.setEnabled(false);
  s.cars[1].collider.setCollisionGroups(0);
  s.ball.setEnabled(false);
  s.ballCollider.setCollisionGroups(0);
  s.cars[0].reset(0, 0, 0);
  for (let i = 0; i < 120; i++) s.step([neutral(), neutral()]);
  return s;
}
function run(
  s: Simulation,
  t: number,
  input: Partial<ReturnType<typeof neutral>>,
) {
  for (let i = 0; i < Math.round(t / P.dt); i++)
    s.step([{ ...neutral(), ...input }, neutral()]);
}
const slip = (s: Simulation) =>
  Math.abs(new Vector3().copy(s.cars[0].body.linvel()).dot(s.cars[0].right));
for (const speed of [5, 20]) {
  const turns = [];
  for (const steer of [-1, 1])
    for (const slide of [false, true]) {
      const s = setup(),
        c = s.cars[0];
      try {
        run(s, 0.25, { slide });
        c.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
        // Compare the same 1.5-second maneuver, rather than waiting for a 180
        // that the intentionally gentler low-speed drift need not complete.
        const maneuverSeconds = 1.5;
        const forward = new Vector3(),
          rotation = new Quaternion();
        const heading = () => {
          forward
            .set(0, 0, -1)
            .applyQuaternion(rotation.copy(c.body.rotation()));
          return Math.atan2(forward.x, -forward.z);
        };
        let yaw = 0,
          distance = 0,
          previousHeading = heading(),
          peakSlip = 0,
          maxHeadingStep = 0;
        const samples = [];
        for (let step = 1; step <= Math.round(maneuverSeconds / P.dt); step++) {
          s.step([{ ...neutral(), steer, slide, throttle: 0.02 }, neutral()]);
          const currentHeading = heading();
          const change = Math.atan2(
            Math.sin(currentHeading - previousHeading),
            Math.cos(currentHeading - previousHeading),
          );
          yaw += change;
          previousHeading = currentHeading;
          peakSlip = Math.max(peakSlip, slip(s));
          maxHeadingStep = Math.max(maxHeadingStep, Math.abs(change));
          distance += Math.hypot(c.body.linvel().x, c.body.linvel().z) * P.dt;
          const t = step * P.dt;
          if (samples.length === 0 || t >= 0.25 * samples.length)
            samples.push({
              t,
              yaw,
              speed: Math.hypot(c.body.linvel().x, c.body.linvel().z),
              slip: slip(s),
            });
        }
        turns.push({
          slide,
          steer,
          time: maneuverSeconds,
          yaw,
          radius: distance / Math.abs(yaw),
          speed: Math.hypot(c.body.linvel().x, c.body.linvel().z),
          slip: slip(s),
          peakSlip,
          maxHeadingStep,
          samples,
        });
        if (slide) {
          const turn = turns[turns.length - 1];
          const minimumTurn = speed === 5 ? Math.PI / 3 : (3 * Math.PI) / 4;
          assert.ok(
            yaw * steer > minimumTurn,
            `substantial directional powerslide at ${speed}m/s, steer ${steer}: ${(yaw * steer * 180) / Math.PI} degrees`,
          );
          assert.ok(
            Math.abs(yaw) < 2 * Math.PI,
            `bounded powerslide rotation at ${speed}m/s`,
          );
          assert.ok(
            maxHeadingStep < 0.1,
            "powerslide must turn continuously, without snapping",
          );
          assert.ok(
            turn.speed > speed * 0.5,
            `retain momentum during powerslide at ${speed}m/s`,
          );
          assert.ok(
            peakSlip > speed * 0.3,
            `meaningful lateral powerslide at ${speed}m/s`,
          );
          const ordinary = turns[turns.length - 2];
          assert.ok(
            peakSlip > ordinary.peakSlip * 2,
            "powerslide must loosen grip compared with ordinary steering",
          );
          if (speed === 20)
            assert.ok(
              turn.radius < ordinary.radius * 0.85,
              "high-speed powerslide must tighten the turn",
            );
          // Release and drive out of the maneuver. Grip, yaw damping and rigid
          // wheel support must recover without a reset or forced orientation.
          run(s, 1, { throttle: 1 });
          const recovery = {
            handbrake: c.handbrake,
            slip: slip(s),
            yawRate: Math.abs(c.body.angvel().y),
            forwardSpeed: c.forwardSpeed,
            grounded: c.grounded,
            contacts: c.contacts,
            up: c.up.y,
          };
          assert.equal(recovery.handbrake, 0);
          assert.ok(
            recovery.slip < 0.2,
            "released powerslide must regain lateral grip",
          );
          assert.ok(
            recovery.yawRate < 0.15,
            "released steering must stop sustained spinning",
          );
          assert.ok(
            recovery.forwardSpeed > 3,
            "throttle must drive out of the powerslide",
          );
          assert.ok(
            recovery.grounded && recovery.contacts >= 3 && recovery.up > 0.9,
            "powerslide must recover planted wheel support",
          );
          results[`recovery${speed}:${steer}`] = recovery;
        }
      } finally {
        s.dispose();
      }
    }
  results[`turn${speed}`] = turns;
}
for (const slide of [false, true]) {
  const s = setup(),
    c = s.cars[0];
  c.reset(0, 0, 0, 2);
  c.body.setLinvel({ x: 12, y: -1, z: 0 }, true);
  let touchdown = -1,
    atTouch = 0;
  for (let i = 0; i < 240; i++) {
    s.step([{ ...neutral(), slide }, neutral()]);
    if (touchdown < 0 && c.grounded) {
      touchdown = i;
      atTouch = slip(s);
    }
    if (touchdown >= 0 && i - touchdown === 30) break;
  }
  results[`landing${slide}`] = {
    atTouch,
    afterQuarterSecond: slip(s),
    handbrake: c.handbrake,
  };
  assert.ok(touchdown >= 0);
  if (slide) {
    assert.ok(slip(s) > 9);
    run(s, 0.25, { slide: false });
    const half = c.handbrake;
    assert.ok(half > 0.49 && half < 0.51);
    run(s, 0.3, {});
    assert.equal(c.handbrake, 0);
    assert.ok(slip(s) < 0.2);
    results.release = { half, slip: slip(s) };
  } else assert.ok(slip(s) < 0.2);
  s.dispose();
}
{
  const s = setup(),
    c = s.cars[0];
  run(s, 0.1, { slide: true });
  assert.ok(Math.abs(c.handbrake - 0.5) < 1e-8);
  run(s, 0.1, { slide: true });
  assert.ok(Math.abs(c.handbrake - 1) < 1e-8);
  results.engagement = { halfTime: 0.1, fullTime: 0.2, releaseTime: 0.5 };
  s.dispose();
}
// A vertical driveable side wall exercises lateral forces in its tangent plane.
for (const slide of [false, true]) {
  const s = setup(false),
    c = s.cars[0];
  c.reset(P.arena.halfWidth - 0.34, 0, 0, 10);
  c.body.setRotation(
    new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(
        new Vector3(0, 1, 0),
        new Vector3(-1, 0, 0),
        new Vector3(0, 0, 1),
      ),
    ),
    true,
  );
  run(s, 0.25, { slide });
  c.body.setLinvel({ x: 0, y: 8, z: -10 }, true);
  run(s, 0.2, { slide, throttle: 0.02 });
  results[`wall${slide}`] = { slip: slip(s), contacts: c.contacts };
  assert.ok(c.contacts >= 2);
  if (slide) assert.ok(slip(s) > 3);
  else assert.ok(slip(s) < 1);
  s.dispose();
}
{
  const s = setup(false),
    ball = ballModel();
  let max = 0;
  ball.updateMatrixWorld(true);
  ball.traverse((o) => {
    if (o instanceof Mesh) {
      const a = o.geometry.getAttribute("position");
      for (let i = 0; i < a.count; i++)
        max = Math.max(
          max,
          new Vector3()
            .fromBufferAttribute(a, i)
            .applyMatrix4(o.matrixWorld)
            .length(),
        );
    }
  });
  assert.ok(P.ball.radius > 0, "ball must have a nonzero configured radius");
  assert.ok(Math.abs(s.ballCollider.radius() - P.ball.radius) < 1e-6);
  assert.ok(Math.abs(max - s.ballCollider.radius()) < 1e-6);
  const before = ball.userData.lamps[0].material.color.clone();
  animateBall(ball, 1);
  assert.ok(!before.equals(ball.userData.lamps[0].material.color));
  results.ball = {
    physicsRadius: s.ballCollider.radius(),
    visualRadius: max,
    diameter: 2 * max,
    cars: {
      ion: new Box3()
        .setFromObject(carModel(0xffffff, "ion"))
        .getSize(new Vector3())
        .toArray(),
      vector: new Box3()
        .setFromObject(carModel(0xffffff, "vector"))
        .getSize(new Vector3())
        .toArray(),
    },
  };
  disposeModel(ball);
  const cameras = [];
  s.ball.setEnabled(true);
  for (const ballMode of [false, true])
    for (const sign of [-1, 1])
      for (const height of [4, 10, 18]) {
        const car = new Group(),
          target = new Group(),
          camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
          control = new GameCamera(camera);
        car.position.set(sign * (P.arena.halfWidth - 0.34), height, 0);
        target.position.set(0, 1, 0);
        car.quaternion.setFromAxisAngle(
          new Vector3(0, 0, 1),
          (sign * Math.PI) / 2,
        );
        s.cars[0].body.setTranslation(car.position, true);
        s.cars[0].body.setRotation(car.quaternion, true);
        s.cars[0].body.setLinvel({ x: 0, y: 8, z: 0 }, true);
        s.step([neutral(), neutral()]);
        control.ballMode = ballMode;
        for (let i = 0; i < 120; i++)
          control.update(car, target, s, 1 / 60, false, i / 60);
        const distance = camera.position.distanceTo(car.position);
        cameras.push({
          ballMode,
          sign,
          height,
          distance,
          x: camera.position.x,
        });
        assert.ok(distance > 2.2);
        assert.ok(Math.abs(camera.position.x) < P.arena.halfWidth);
        assert.ok(Math.abs(camera.rotation.z) < 1e-8);
      }
  results.camera = cameras;
  s.dispose();
}
writeFileSync(
  "docs/major-calibration.json",
  JSON.stringify(results, null, 2) + "\n",
);
console.log(
  "PASS major update handling, landings, wall grip, ball dimensions and wall cameras",
);
