import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { Input } from "../src/input/input";
import { PAD, controllerActions } from "../shared/controller";
import { JumpState } from "../src/car/dodge";
import { Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
(globalThis as any).window = { addEventListener() {} };
(globalThis as any).document = {
  hidden: false,
  querySelector() {
    return null;
  },
};
const pad = {
  id: "Standard multi-input fixture",
  index: 0,
  mapping: "standard",
  connected: true,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { getGamepads: () => [pad] },
});
const input = new Input();
const press = (i: number, value = 1) => {
  pad.buttons[i] = { value, pressed: value > 0.5 };
};
const reset = () => {
  pad.axes.fill(0);
  pad.buttons.forEach((b) => {
    b.value = 0;
    b.pressed = false;
  });
  input.poll();
  input.clear();
};
// Real repro: boost is also a generic air-roll modifier in a custom layout.
// Opposite steering used to cancel the dedicated roll: 1 + (-1) = 0.
input.controller.settings.bindings.airRoll = {
  type: "button",
  button: PAD.boost,
};
pad.axes[0] = -1;
press(PAD.boost);
press(PAD.rollRight);
for (let i = 0; i < 180; i++) {
  const c = input.sample();
  assert.equal(c.boost, true);
  assert.equal(c.steer, -1);
  assert.equal(c.yaw, -1);
  assert.equal(c.directionalRoll, 1);
  assert.equal(
    c.roll,
    1,
    "Generic steer-remapping cannot cancel dedicated roll",
  );
}
reset();
pad.axes[1] = -0.8;
press(PAD.boost);
press(PAD.rollLeft);
let c = input.sample();
assert.ok(c.pitch > 0.7);
assert.equal(c.roll, -1);
assert.ok(c.boost);
reset();
pad.axes[0] = 0.7;
press(PAD.throttle, 0.55);
press(PAD.slide);
c = input.sample();
assert.equal(c.throttle, 0.55);
assert.ok(c.steer > 0.6);
assert.ok(c.slide);
assert.ok(c.roll > 0.6);
assert.equal(
  c.yaw,
  0,
  "Generic roll alone keeps its established steering-remap behavior",
);
reset();
pad.axes[0] = 0.65;
press(PAD.boost);
press(PAD.jump);
press(PAD.rollRight);
pad.axes[1] = -0.4;
c = input.sample();
assert.ok(c.jump && c.boost && c.steer > 0.4 && c.pitch > 0.2 && c.roll === 1);
assert.ok(
  input.justPressed.has("jump") &&
    input.justPressed.has("boost") &&
    input.justPressed.has("rollRight"),
);
input.takeAction("jump");
input.takeAction("boost");
input.takeAction("rollRight");
press(PAD.jump, 0);
c = input.sample();
assert.equal(c.jump, false);
assert.ok(input.justReleased.has("jump"));
assert.ok(c.boost && c.roll === 1 && c.steer > 0.4);
reset();
pad.axes[0] = -1;
press(PAD.boost);
press(PAD.rollRight);
press(PAD.jump);
c = input.sample();
const jump = new JumpState();
assert.equal(jump.step(c, false, P.dt), "dodge");
assert.equal(
  jump.stall,
  true,
  "Stall chord remains detected with boost and generic modifier held",
);
reset();
// Every binding is evaluated even when all physical buttons are held together.
const all = new Input();
controllerActions.forEach(
  (action, i) =>
    (all.controller.settings.bindings[action] = {
      type: "button",
      button: i % 17,
    }),
);
pad.buttons.forEach((b) => {
  b.value = 1;
  b.pressed = true;
});
all.poll();
for (const action of controllerActions) {
  assert.equal(all.controller.values[action], 1);
  assert.ok(all.justPressed.has(action));
  assert.ok(all.isHeld(action));
}
press(PAD.jump, 0);
all.poll();
for (let i = 0; i < controllerActions.length; i++)
  assert.equal(
    all.controller.values[controllerActions[i]],
    i % 17 === PAD.jump ? 0 : 1,
  );
reset();
delete (globalThis as any).window; // Restore Node environment for Rapier/WASM initialization.
await RAPIER.init();
for (const body of ["ion", "vector"] as const) {
  const sim = new Simulation(true);
  const car = sim.cars[0];
  car.setBody(body);
  car.reset(0, 0, 0, 10);
  sim.ball.setTranslation({ x: 50, y: 20, z: 50 }, true);
  pad.axes[0] = -1;
  press(PAD.boost);
  press(PAD.rollRight);
  c = input.sample();
  sim.step([c, neutralInput()]);
  const spin = new Vector3().copy(car.body.angvel()).dot(car.forward);
  assert.ok(
    Math.abs(spin) > 0.1,
    "Boost + opposite steer + dedicated roll generates real roll torque",
  );
  sim.dispose();
  reset();
  const flip = new Simulation(true),
    f = flip.cars[0];
  f.setBody(body);
  f.reset(0, 0, 0, 10);
  pad.axes[1] = -1;
  press(PAD.jump);
  press(PAD.boost);
  c = input.sample();
  flip.step([c, neutralInput()]);
  assert.ok(f.jump.flipLeft > 0);
  press(PAD.jump, 0);
  pad.axes[1] = 1;
  c = input.sample();
  assert.ok(c.boost && c.pitch === -1);
  flip.step([c, neutralInput()]);
  assert.equal(
    Math.abs(f.flipPitchAcceleration),
    0,
    "Flip cancel suppresses sustained pitch torque while boost remains held",
  );
  assert.ok(f.boost < 100);
  flip.dispose();
  reset();
}
console.log(
  "PASS simultaneous boost/steer/generic+dedicated roll, pitch/yaw, throttle/slide, jump/release, all bound actions, boosted stall, real both-body roll torque and boosted flip cancels",
);
