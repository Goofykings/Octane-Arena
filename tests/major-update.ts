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
  s.ball.setEnabled(false);
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
  for (const slide of [false, true]) {
    const s = setup(),
      c = s.cars[0];
    run(s, 0.25, { slide });
    c.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    let yaw = 0,
      distance = 0,
      t = 0;
    const samples = [];
    while (t < 3 && yaw < Math.PI) {
      s.step([{ ...neutral(), steer: 1, slide, throttle: 0.02 }, neutral()]);
      yaw += Math.abs(c.body.angvel().y) * P.dt;
      distance += Math.hypot(c.body.linvel().x, c.body.linvel().z) * P.dt;
      t += P.dt;
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
      time: t,
      yaw,
      radius: distance / yaw,
      speed: Math.hypot(c.body.linvel().x, c.body.linvel().z),
      slip: slip(s),
      samples,
    });
    s.dispose();
  }
  results[`turn${speed}`] = turns;
  assert.ok(turns[1].yaw >= Math.PI, `powerslide 180 at ${speed}`);
  assert.ok(turns[1].speed > speed * 0.5, `retain momentum at ${speed}`);
  // Orientation/travel diverge rather than a high-grip animation.
  assert.ok(turns[1].samples.some((v) => v.slip > speed * 0.3));
  if (speed === 20) assert.ok(turns[1].radius < turns[0].radius);
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
  assert.ok(Math.abs(s.ballCollider.radius() - 0.9125) < 1e-6);
  assert.ok(Math.abs(max - 0.9125) < 1e-6);
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
