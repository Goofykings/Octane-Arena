import assert from "node:assert/strict";
import { Group, PerspectiveCamera, Scene, Vector3 } from "three";
import { GameCamera } from "../src/camera/camera";
import { MouseLook, MOUSE_LOOK } from "../src/camera/mouse-look";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { defaults } from "../src/game/settings";
import { BotTeam } from "../src/ai/team";
import { botRoster } from "../shared/bots";
import { Pads } from "../src/game/pads";
import { VehicleEffects } from "../src/effects/vehicle-effects";
import { GoalExplosion } from "../src/effects/goal-explosion";
const settings = defaults().camera;
const look = new MouseLook();
look.begin();
look.move(20, 0);
assert.ok(look.targetYaw > 0);
look.setBehavior("orbit");
look.begin();
look.move(20, 0);
assert.ok(look.targetYaw < 0, "Home/Garage direction is preserved");
const finalYaw: number[] = [];
for (const hz of [30, 60, 144]) {
  const stick = new MouseLook();
  stick.controllerLook(0.5, -0.5, 1 / hz);
  assert.equal(stick.targetYaw, 0.5 * MOUSE_LOOK.controllerYaw);
  assert.equal(stick.targetPitch, -0.5 * MOUSE_LOOK.controllerPitch);
  for (let i = 0; i < hz / 2; i++) {
    stick.controllerLook(0.5, -0.5, 1 / hz);
    stick.update(1 / hz, settings);
  }
  assert.equal(
    stick.targetYaw,
    0.5 * MOUSE_LOOK.controllerYaw,
    "Held stick does not accumulate rotation",
  );
  finalYaw.push(stick.yaw);
  stick.controllerLook(0, 0, 1 / hz);
  for (let i = 0; i < hz / 2; i++) stick.update(1 / hz, settings);
  assert.ok(Math.abs(stick.yaw) < 1e-5, "Center smoothly returns");
}
assert.ok(Math.max(...finalYaw) - Math.min(...finalYaw) < 1e-10);
await initializeSimulation();
const s = new Simulation();
const travel = (speed: number, initial: boolean) => {
  const car = new Group(),
    ball = new Group(),
    rig = new GameCamera(new PerspectiveCamera(73, 16 / 9));
  car.position.set(0, 0.34, 0);
  ball.position.set(8, 3, 20);
  rig.ballMode = initial;
  rig.settings = { ...settings, transition: speed };
  for (let i = 0; i < 120; i++) rig.update(car, ball, s, 1 / 60, false, i / 60);
  rig.ballMode = !initial;
  const start = rig.camera.quaternion.clone(),
    p = rig.camera.position.clone();
  assert.deepEqual(
    rig.camera.position,
    p,
    "Toggling does not write the camera outside its update",
  );
  let first = 0,
    peak = 0;
  for (let i = 0; i < 30; i++) {
    const previous = rig.camera.quaternion.clone();
    rig.update(car, ball, s, 1 / 60, false, 3 + i / 60);
    peak = Math.max(peak, previous.angleTo(rig.camera.quaternion));
    if (!i) first = previous.angleTo(rig.camera.quaternion);
  }
  assert.ok(first < 0.8, "No single-frame mode teleport");
  return { distance: start.angleTo(rig.camera.quaternion), peak };
};
for (const initial of [true, false]) {
  const slow = travel(0.3, initial),
    fast = travel(2, initial);
  assert.ok(
    fast.distance > slow.distance * 1.25,
    "Transition speed applies in both directions",
  );
}
const car = new Group(),
  ball = new Group(),
  rig = new GameCamera(new PerspectiveCamera(73, 16 / 9)),
  manual = new MouseLook();
rig.mouseLook = manual;
car.position.set(41, 8, 0);
ball.position.set(4, 12, -20);
for (let i = 0; i < 60; i++) rig.update(car, ball, s, 1 / 60, false, i / 60);
manual.begin();
manual.move(160, 40);
for (let i = 0; i < 60; i++) {
  manual.update(1 / 60, settings);
  rig.update(car, ball, s, 1 / 60, false, 1 + i / 60);
}
rig.ballMode = false;
rig.update(car, ball, s, 1 / 60, false, 2);
assert.ok(rig.transitioning);
manual.end();
for (let i = 0; i < 600; i++) {
  if (i === 30) rig.ballMode = true;
  manual.update(1 / 60, settings);
  rig.update(car, ball, s, 1 / 60, false, 2 + i / 60);
  assert.ok(rig.camera.position.toArray().every(Number.isFinite));
}
assert.equal(manual.active, false);
assert.equal(rig.transitioning, false);
const scene = new Scene(),
  model = new Group();
scene.add(model);
const fx = new VehicleEffects(model, scene, 0x66ddff),
  explosion = new GoalExplosion(scene);
const count = () => {
  let n = 0;
  scene.traverseVisible((o) => {
    if ((o as any).isPointLight) n++;
  });
  return n;
};
const budget = count();
fx.previewBoost(0, true);
assert.equal(count(), budget);
fx.previewBoost(1, false);
assert.equal(count(), budget);
explosion.trigger(new Vector3(), 0xffaa66);
assert.equal(count(), budget);
explosion.reset();
assert.equal(count(), budget);
fx.dispose();
assert.equal(count(), budget - 1);
s.dispose();
const bots = new Simulation(
    false,
    botRoster("3v3", {
      id: "human",
      name: "Human",
      team: 0,
      controller: "local",
    }),
  ),
  brain = new BotTeam("advanced"),
  pads = new Pads();
const pose = bots.world.takeSnapshot();
brain.prepare(bots, pads);
assert.deepEqual(
  bots.world.takeSnapshot(),
  pose,
  "Bot prewarm cannot advance or alter physics",
);
const pool = brain.perception.pool,
  ids = bots.players.filter((p) => p.controller === "bot").map((p) => p.id);
assert.equal(brain.targets.size, 5);
const ticks: number[] = [];
const counts = new Map(ids.map((id) => [id, 0]));
const original = brain.decision.choose.bind(brain.decision);
brain.decision.choose = (c, ...args) => {
  ticks.push(Math.round(bots.clock * 120));
  counts.set(c.id, counts.get(c.id)! + 1);
  return original(c, ...args);
};
for (let i = 1; i <= 120; i++) {
  bots.clock = i / 120;
  brain.inputs(bots, pads);
}
assert.equal(brain.perception.pool, pool);
assert.ok(
  [...counts.values()].every((n) => n >= 9 && n <= 11),
  "Every bot retains approximately 10 Hz decisions",
);
assert.ok(
  new Set(ticks).size >= 45,
  "Heavy decisions are spread over physics ticks rather than one five-bot burst",
);
bots.dispose();
console.log(
  "PASS gameplay-only mouse mirror, direct proportional stick targets and frame-independent response/return, both transition speeds, wall/manual/rapid toggles, stable lighting shader budget, physics-free bot/replay prewarm, reused prediction buffers and fair staggered decisions",
);
