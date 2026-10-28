import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Vector3 } from "three";
import assert from "node:assert/strict";
import { CAMERA_RIG, GameCamera } from "../src/camera/camera";
import { Simulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
await RAPIER.init();
// RL camera contract: a fixed FOV and boom. The car stays readable (its centre
// inside 86% of the frame); the ball is fully framed whenever a fixed-FOV view
// can hold both. A ball nearly straight overhead pitches the view up as far as
// the car allows and may leave the top edge, without flipping the frame.
const noRoll = (camera: PerspectiveCamera, control: GameCamera) =>
  Math.abs(
    new Vector3(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .dot(control.referenceUp),
  ) < 1e-6;
for (const fps of [30, 60, 144])
  for (const [name, position, target, roll, both] of [
    ["ahead", [0, 0.34, 0], [0, 1, -14], 0, true],
    ["behind", [0, 0.34, 0], [0, 1, 14], 0, true],
    ["near overhead", [0, 0.34, 0], [0.1, 7, 0.1], 0, false],
    ["ceiling overhead", [0, 0.34, 0], [0.1, 19.4, 0.1], 0, false],
    ["wall ahead", [40.6, 10, 0], [39, 10, -14], Math.PI / 2, true],
    // Field centre is below the car in world-up space, even on a side wall.
    ["vertical wall", [40.6, 10, 0], [0, 1, 0], Math.PI / 2, false],
    ["wall high ball", [40.6, 10, 0], [39, 19.4, 0], Math.PI / 2, false],
    ["ceiling", [35, 20.1, 0], [30, 16, 0], Math.PI, true],
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
    const centre = car.position.clone().project(camera);
    assert.ok(
      Math.abs(centre.x) < 0.86 && Math.abs(centre.y) < 0.86 && centre.z < 1,
      `${name} car readability ${centre.toArray()}`,
    );
    const local = ball.position.clone().applyMatrix4(camera.matrixWorldInverse);
    if (both) {
      assert.ok(local.z < 0, `${name} ball behind lens`);
      const projected = ball.position.clone().project(camera);
      const margin =
        0.9125 / (-local.z * Math.tan((camera.fov * Math.PI) / 360));
      assert.ok(
        Math.abs(projected.y) + margin < 1,
        `${name} vertical clip ${projected.y}, margin ${margin}`,
      );
      assert.ok(
        Math.abs(projected.x) + margin / camera.aspect < 1,
        `${name} horizontal clip`,
      );
    } else if (target[1] > position[1])
      assert.ok(
        control.lookDirection.dot(control.referenceUp) > 0,
        `${name} pitches up toward the high ball`,
      );
    assert.ok(noRoll(camera, control), `${name} rolled off its reference up`);
    console.log(`PASS framing ${name} ${fps}fps FOV=${camera.fov.toFixed(1)}`);
    s.dispose();
  }
// A very high ball crossing over the car swings Ball Cam round (as in RL) but
// never flips the frame or turns faster than the rig's view-rate limit.
for (const fps of [30, 60, 144]) {
  const s = new Simulation(),
    car = new Group(),
    ball = new Group(),
    camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
    control = new GameCamera(camera);
  car.position.set(0, 0.34, 0);
  let maxTurn = 0;
  for (let i = 0; i < fps * 6; i++) {
    const t = i / fps;
    ball.position.set(0.3 * Math.sin(t), 9, -12 + 4 * t);
    const before = camera.quaternion.clone();
    control.update(car, ball, s, 1 / fps, false, t);
    if (i > fps)
      maxTurn = Math.max(maxTurn, before.angleTo(camera.quaternion) * fps);
    assert.ok(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y > 0);
  }
  assert.ok(
    maxTurn <= CAMERA_RIG.maxViewRate * 1.02,
    `overhead crossing snap ${maxTurn}`,
  );
  s.dispose();
  console.log(`PASS overhead crossing ${fps}fps turn=${maxTurn.toFixed(3)}`);
}
for (const fps of [30, 60, 144]) {
  const s = new Simulation(),
    car = new Group(),
    ball = new Group(),
    camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340);
  const control = new GameCamera(camera);
  s.cars[0].grounded = true;
  // Ahead of the car (~20° above the surface plane) from wall to ceiling.
  ball.position.set(36, 15, -14);
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
    assert.ok(noRoll(camera, control));
  }
  assert.ok(maxTurn < 4, `ceiling snap ${maxTurn}`);
  s.dispose();
  console.log(
    `PASS wall-ceiling transition ${fps}fps turn=${maxTurn.toFixed(3)}`,
  );
}
