import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Vector3 } from "three";
import assert from "node:assert/strict";
import { GameCamera } from "../src/camera/camera";
import { Simulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
await RAPIER.init();
for (const fps of [30, 60, 144])
  for (const [name, position, target, roll] of [
    ["ahead", [0, 0.34, 0], [0, 1, -14], 0],
    ["behind", [0, 0.34, 0], [0, 1, 14], 0],
    ["near overhead", [0, 0.34, 0], [0.1, 7, 0.1], 0],
    ["ceiling overhead", [0, 0.34, 0], [0.1, 19.4, 0.1], 0],
    ["vertical wall", [40.6, 10, 0], [0, 1, 0], Math.PI / 2],
    ["wall high ball", [40.6, 10, 0], [39, 19.4, 0], Math.PI / 2],
    ["ceiling", [35, 20.1, 0], [30, 16, 0], Math.PI],
  ] as const) {
    const s = new Simulation(),
      car = new Group(),
      ball = new Group();
    const camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
      control = new GameCamera(camera);
    car.position.fromArray(position);
    ball.position.fromArray(target);
    car.rotation.z = roll;
    s.cars[0].grounded = true;
    for (let i = 0; i < fps * 3; i++)
      control.update(car, ball, s, 1 / fps, false, i / fps);
    camera.updateMatrixWorld(true);
    for (const [subject, radius] of [
      [car, 0.8],
      [ball, 0.9125],
    ] as const) {
      const local = subject.position
        .clone()
        .applyMatrix4(camera.matrixWorldInverse);
      assert.ok(local.z < 0, `${name} behind lens`);
      const projected = subject.position.clone().project(camera);
      const margin =
        radius / (-local.z * Math.tan((camera.fov * Math.PI) / 360));
      assert.ok(
        Math.abs(projected.y) + margin < 1,
        `${name} vertical clip ${projected.y}, margin ${margin}`,
      );
      assert.ok(
        Math.abs(projected.x) + margin / camera.aspect < 1,
        `${name} horizontal clip`,
      );
    }
    assert.ok(Math.abs(camera.rotation.z) < 1e-9);
    console.log(`PASS framing ${name} ${fps}fps FOV=${camera.fov.toFixed(1)}`);
    s.dispose();
  }
for (const fps of [30, 60, 144]) {
  const s = new Simulation(),
    car = new Group(),
    ball = new Group(),
    camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340);
  const control = new GameCamera(camera);
  s.cars[0].grounded = true;
  ball.position.set(32, 16, 0);
  let maxTurn = 0;
  for (let i = 0; i < fps * 8; i++) {
    const angle = (Math.max(0, (i / fps - 2) / 6) * Math.PI) / 2;
    car.position.set(
      P.arena.halfWidth -
        P.arena.ramp +
        (P.arena.ramp - 0.34) * Math.cos(angle),
      P.arena.height - P.arena.ramp + (P.arena.ramp - 0.34) * Math.sin(angle),
      0,
    );
    car.rotation.z = Math.PI / 2 + angle;
    const before = camera.quaternion.clone();
    control.update(car, ball, s, 1 / fps, false, i / fps);
    if (i > fps * 2)
      maxTurn = Math.max(maxTurn, before.angleTo(camera.quaternion) * fps);
    camera.updateMatrixWorld(true);
    const projected = ball.position.clone().project(camera);
    if (i > fps)
      assert.ok(
        Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1,
        "ceiling transition loses ball",
      );
    assert.ok(Math.abs(camera.rotation.z) < 1e-9);
  }
  assert.ok(maxTurn < 4, `ceiling snap ${maxTurn}`);
  s.dispose();
  console.log(
    `PASS wall-ceiling transition ${fps}fps turn=${maxTurn.toFixed(3)}`,
  );
}
