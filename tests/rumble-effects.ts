import assert from "node:assert/strict";
import { Scene, Group, PerspectiveCamera, Vector3 } from "three";
import { RumbleEffects } from "../src/effects/rumble";
import type { RumbleSnapshot } from "../shared/rumble";
const scene = new Scene(),
  car = new Group(),
  ball = new Group(),
  camera = new PerspectiveCamera();
car.position.set(3, 4, 5);
ball.position.set(0, 10, -5);
let sounds = 0;
const fx = new RumbleEffects(scene, () => sounds++);
const state: RumbleSnapshot = {
  players: [
    {
      playerId: "a",
      phase: "active",
      item: "GRAPPLING_HOOK",
      cooldown: 0,
      remaining: 2,
    },
  ],
  events: [
    {
      id: 1,
      time: 0,
      playerId: "a",
      kind: "POWERUP_USED",
      item: "GRAPPLING_HOOK",
      point: { x: 0, y: 10, z: -5 },
    },
  ],
};
const pose = () => car;
fx.update(state, pose, ball, camera, 1 / 60, 0);
assert.ok(fx.slots[0].tether.visible);
assert.equal(sounds, 1);
const buffer = fx.slots[0].line,
  arcs = fx.slots[0].arcs,
  count = scene.children.length;
for (let i = 0; i < 600; i++) {
  ball.position.x = i / 60;
  fx.update(state, pose, ball, camera, 1 / 60, i / 60);
}
assert.equal(sounds, 1, "Network repeated event does not replay sound");
assert.equal(fx.slots[0].line, buffer);
assert.equal(fx.slots[0].arcs, arcs);
assert.equal(scene.children.length, count);
assert.ok(
  Math.abs(buffer[3] - ball.position.x) < 1e-5,
  "Float32 tether endpoint follows the ball",
);
state.players[0].item = "POWER_HITTER";
fx.update(state, pose, ball, camera, 1 / 60, 10);
assert.ok(fx.slots[0].aura.visible);
assert.equal(fx.slots[0].tether.visible, false);
state.players[0].item = "SPIKES";
state.players[0].remaining = 5;
state.players[0].attachment = {
  local: { x: 2, y: 0, z: 0 },
  contact: { x: 1, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  age: 1,
};
car.rotation.z = Math.PI / 2;
fx.update(state, pose, ball, camera, 1 / 60, 10);
assert.ok(ball.position.distanceTo(new Vector3(3, 6, 5)) < 1e-6);
assert.ok(fx.slots[0].spikes.visible);
fx.reset();
fx.update(state, pose, ball, camera, 1 / 60, 0, true);
assert.equal(
  sounds,
  1,
  "Replay visual playback never runs activation audio/gameplay",
);
fx.update(null, pose, ball, camera, 1 / 60, 0);
assert.ok(
  fx.slots.every(
    (f) => !f.root.visible && !f.tether.visible && !f.flash.visible,
  ),
);
fx.dispose();
assert.equal(scene.children.length, 0);
console.log(
  "PASS reusable Rumble buffers/meshes, current tether endpoints, energy/spikes, local attachment interpolation, deduplicated sounds and replay/reset/disposal isolation",
);
