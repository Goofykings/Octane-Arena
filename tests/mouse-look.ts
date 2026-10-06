import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Vector3 } from "three";
import {
  MouseLook,
  MouseOrbit,
  MOUSE_LOOK,
  softAngle,
} from "../src/camera/mouse-look";
import { GameCamera } from "../src/camera/camera";
import { Simulation } from "../src/physics/simulation";
import { defaults } from "../src/game/settings";

const settings = defaults().camera;
const centerStep = softAngle(0, 0.1, Math.PI);
const edge = softAngle(2.9, 0.1, Math.PI);
assert.ok(
  edge - 2.9 < centerStep / 10,
  "Outward resistance grows near the yaw limit",
);
assert.equal(
  softAngle(edge, -0.1, Math.PI),
  edge - 0.1,
  "Inward input is immediately responsive",
);
let yaw = 0;
for (let i = 0; i < 100; i++) yaw = softAngle(yaw, 0.1, Math.PI);
assert.ok(yaw > 3 && yaw < Math.PI);
assert.equal(
  softAngle(0.1, -0.2, Math.PI),
  -centerStep,
  "Crossing center does not accumulate hidden input",
);
const decay = (hz: number, transition: number) => {
  const look = new MouseLook();
  look.yaw = 1;
  look.pitch = 0.4;
  for (let i = 0; i < hz; i++) look.update(1 / hz, { ...settings, transition });
  return look.yaw;
};
assert.ok(Math.abs(decay(30, 0.4) - decay(144, 0.4)) < 1e-12);
assert.ok(decay(60, 2) < decay(60, 0.2) / 100);
const look = new MouseLook();
look.begin();
look.move(100000, -100000);
look.update(1, settings);
assert.ok(
  Math.abs(look.yaw) <= MOUSE_LOOK.yawLimit &&
    Math.abs(look.pitch) <= MOUSE_LOOK.pitchLimit,
);
assert.ok(
  look.targetYaw < 0 && look.targetPitch < 0,
  "Right/up mouse movement uses the reversed directions",
);
look.move(-10, 0);
assert.ok(look.targetYaw > -Math.PI + 0.04);
look.end();
for (let i = 0; i < 300; i++) look.update(1 / 60, settings);
assert.equal(look.active, false);

const fling = () => {
  const orbit = new MouseLook();
  orbit.setBehavior("orbit");
  orbit.begin();
  for (let i = 0; i < 12; i++) {
    orbit.move(-25, 0, 1 / 60);
    orbit.update(1 / 60, settings);
  }
  orbit.end();
  return orbit;
};
const momentum = fling();
const releasedYaw = momentum.targetYaw;
const releasedSpeed = momentum.yawVelocity;
momentum.end(); // Lost capture after pointer-up must preserve momentum.
for (let i = 0; i < 6; i++) momentum.update(1 / 60, settings);
assert.ok(momentum.targetYaw > releasedYaw + 0.1, "Release continues the spin");
assert.ok(momentum.yawVelocity < releasedSpeed, "Friction slows the spin");
for (let i = 0; i < 300; i++) momentum.update(1 / 60, settings);
assert.equal(momentum.moving, false);
assert.ok(Math.abs(momentum.yaw) > 0.1, "Display orbit does not recenter");
const settledYaw = momentum.yaw;
for (let i = 0; i < 120; i++) momentum.update(1 / 60, settings);
assert.equal(momentum.yaw, settledYaw);
momentum.begin();
assert.equal(momentum.yawVelocity, 0, "A new drag takes control of momentum");
let turns = 0;
for (let i = 0; i < 240; i++) {
  const previous = momentum.yaw;
  momentum.move(-25, 0, 1 / 60);
  momentum.update(1 / 60, settings);
  turns += Math.atan2(
    Math.sin(momentum.yaw - previous),
    Math.cos(momentum.yaw - previous),
  );
}
assert.ok(turns > Math.PI * 4, "Display orbit permits continuous full turns");
for (let i = 0; i < 300; i++) momentum.update(1 / 60, settings);
momentum.end();
assert.equal(momentum.yawVelocity, 0, "Holding still prevents a stale fling");
const coast = (hz: number) => {
  const orbit = fling();
  for (let i = 0; i < hz / 2; i++) orbit.update(1 / hz, settings);
  return orbit.targetYaw;
};
assert.ok(
  Math.abs(coast(30) - coast(144)) < 1e-10,
  "Momentum is frame-rate independent",
);
momentum.setBehavior("look");
assert.equal(momentum.active, false, "Entering gameplay clears display orbit");

await RAPIER.init();
const simulation = new Simulation();
simulation.world.step();
const before = simulation.world.takeSnapshot();
for (const ballMode of [false, true]) {
  const baseCamera = new PerspectiveCamera(73, 16 / 9),
    finalCamera = new PerspectiveCamera(73, 16 / 9);
  const base = new GameCamera(baseCamera),
    rig = new GameCamera(finalCamera),
    manual = new MouseLook();
  base.ballMode = rig.ballMode = ballMode;
  rig.mouseLook = manual;
  const car = new Group(),
    ball = new Group();
  manual.begin();
  manual.move(350, -140);
  let differed = false;
  for (let i = 0; i < 540; i++) {
    const t = i / 60;
    if (i === 180) manual.end();
    // Include wall poses, aerial air roll and a moving Ball Cam subject.
    car.position.set(i < 120 ? 31 : 0, i < 120 ? 8 : 4 + Math.sin(t), -t);
    car.rotation.set(t * 1.5, t * 0.5, t * 3);
    ball.position.set(Math.sin(t) * 7, 3 + Math.cos(t), -15);
    manual.update(1 / 60, settings);
    base.update(car, ball, simulation, 1 / 60, false, t);
    rig.update(car, ball, simulation, 1 / 60, false, t);
    assert.ok(
      baseCamera.position.distanceTo(finalCamera.position) < 1e-10,
      "Free look must preserve collision-corrected camera position",
    );
    assert.ok(
      Math.abs(baseCamera.fov - finalCamera.fov) < 1e-10,
      "Framing continues independently of manual look",
    );
    assert.ok(
      base.lookDirection.distanceTo(rig.lookDirection) < 1e-10,
      "Automatic tracking continues while looking away",
    );
    assert.equal(rig.ballMode, ballMode);
    assert.ok(
      new Vector3(0, 1, 0).applyQuaternion(finalCamera.quaternion).y > 0,
      "No horizon inversion during wall/aerial look",
    );
    if (i === 150)
      differed = baseCamera.quaternion.angleTo(finalCamera.quaternion) > 0.2;
  }
  assert.ok(differed);
  assert.equal(manual.active, false);
  assert.ok(
    baseCamera.quaternion.angleTo(finalCamera.quaternion) < 1e-7,
    "Return reaches the current automatic camera, not the starting bearing",
  );
}
assert.deepEqual(
  simulation.world.takeSnapshot(),
  before,
  "Mouse look never writes physics",
);
const orbit = new MouseOrbit(),
  displayLook = new MouseLook(),
  camera = new PerspectiveCamera();
const focus = new Vector3(6, 0.5, 14);
displayLook.yaw = Math.PI * 0.95;
displayLook.pitch = -1;
camera.position.set(6, 4, 21);
orbit.apply(camera, focus, displayLook, 1 / 60, simulation, 0.3);
assert.ok(camera.position.y >= 0.29);
assert.ok(camera.position.x >= -32 && camera.position.x <= 32);
assert.ok(
  new Vector3(0, 0, -1)
    .applyQuaternion(camera.quaternion)
    .dot(focus.clone().sub(camera.position).normalize()) > 0.999,
);
simulation.world.free();
console.log(
  "PASS continuous display orbit, momentum/friction, retained view, soft limits/reversal, frame-rate independent return, Ball/Car Cam targets, wall/aerial horizon and unchanged physics/framing",
);
