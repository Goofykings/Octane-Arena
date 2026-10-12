import assert from "node:assert/strict";
import { Input } from "../src/input/input";
import { ControllerInput } from "../src/input/controller";
import { Settings } from "../src/game/settings";
import { defaultBindings } from "../shared/controls";
import {
  controllerDefaults,
  controllerName,
  PAD,
  type ControllerBinding,
} from "../shared/controller";
import { preferencesSchema } from "../shared/accounts";
import { MouseLook } from "../src/camera/mouse-look";
import { JumpState } from "../src/car/dodge";
import { P } from "../src/config/physics";

const listeners = new Map<string, Function[]>();
let dialog = false,
  saved = "{}",
  pads: any[] = [];
(globalThis as any).window = {
  addEventListener(name: string, fn: Function) {
    listeners.set(name, [...(listeners.get(name) ?? []), fn]);
  },
};
(globalThis as any).document = {
  hidden: false,
  querySelector() {
    return dialog ? {} : null;
  },
};
(globalThis as any).localStorage = {
  getItem() {
    return saved;
  },
  setItem(_key: string, value: string) {
    saved = value;
  },
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { getGamepads: () => pads },
});
const makePad = (id: string, index = 0) => ({
  id,
  index,
  connected: true,
  mapping: "standard",
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
});
const press = (pad: any, index: number, value = 1) => {
  pad.buttons[index].value = value;
  pad.buttons[index].pressed = value > 0.5;
};
for (const id of [
  "Xbox Wireless Controller",
  "DualSense Wireless Controller",
]) {
  const pad = makePad(id),
    input = new Input();
  pads = [pad];
  press(pad, PAD.camera);
  listeners.get("gamepadconnected")!.at(-1)!({ gamepad: pad });
  input.sample();
  assert.equal(
    input.takeAction("camera"),
    true,
    "Connection event cannot consume the first button edge",
  );
  press(pad, PAD.camera, 0);
  let c = input.sample();
  assert.equal(input.controller.selectedIndex, 0);
  assert.ok(
    input.controller.status.includes(id) &&
      input.controller.status.includes("Connected"),
  );
  pad.axes = [0.06, -0.04, 0.05, -0.04];
  c = input.sample();
  assert.equal(c.steer, 0);
  assert.equal(c.pitch, 0);
  assert.equal(input.getAction("cameraLeft"), 0);
  pad.axes = [0.56, -0.3, 0.7, -0.6];
  press(pad, PAD.throttle, 0.37);
  c = input.sample();
  assert.equal(c.throttle, 0.37);
  assert.ok(c.steer > 0.4 && c.steer < 0.7);
  assert.ok(c.pitch > 0.1 && c.pitch < 0.4);
  assert.ok(
    input.getAction("cameraRight") > 0 && input.getAction("cameraUp") > 0,
  );
  input.keys.add("KeyA");
  c = input.sample();
  assert.equal(c.steer, -1, "Keyboard wins strongest/tied movement");
  input.keys.clear();
  pad.axes = [0, 0, 0, 0];
  press(pad, PAD.throttle, 0);
  press(pad, PAD.jump);
  c = input.sample();
  assert.ok(c.jump && input.justPressed.has("jump"));
  assert.equal(input.takeAction("jump"), true);
  assert.equal(input.takeAction("jump"), false);
  input.sample();
  assert.equal(input.justPressed.has("jump"), false);
  press(pad, PAD.jump, 0);
  input.sample();
  assert.ok(input.justReleased.has("jump"));
  for (const action of [
    "camera",
    "pause",
    "chat",
    "scoreboard",
    "reverseCam",
  ] as const) {
    input.controller.settings.bindings[action] = { type: "button", button: 16 };
    press(pad, 16);
    input.sample();
    assert.equal(input.isHeld(action), true);
    assert.equal(input.takeAction(action), true);
    input.sample();
    assert.equal(input.takeAction(action), false);
    press(pad, 16, 0);
    input.sample();
  }
  // Controller binding captures only new controls after neutral; drift isn't input.
  let binding: ControllerBinding | null = null;
  press(pad, PAD.jump);
  input.poll();
  input.controller.beginBind("jump", (b) => {
    binding = b;
  });
  input.poll();
  assert.equal(binding, null);
  press(pad, PAD.jump, 0);
  pad.axes[0] = 0.1;
  input.poll();
  input.poll();
  assert.equal(binding, null);
  press(pad, PAD.jump);
  input.poll();
  assert.deepEqual(binding, { type: "button", button: PAD.jump });
  assert.equal(
    input.sample().jump,
    false,
    "Captured held button stays suppressed until release",
  );
  press(pad, PAD.jump, 0);
  pad.axes[0] = 0;
  input.poll();
  binding = null;
  input.controller.beginBind("cameraLeft", (b) => {
    binding = b;
  });
  input.poll();
  pad.axes[2] = -0.4;
  input.poll();
  assert.equal(binding, null);
  pad.axes[2] = -0.8;
  input.poll();
  assert.deepEqual(binding, {
    type: "axis",
    axis: 2,
    direction: -1,
    threshold: 0.5,
    analog: true,
  });
  assert.equal(controllerName(binding), "Right Stick Left");
  input.controller.cancelBind();
  pad.axes = [0, 0, 0, 0];
  input.clear();
  input.poll();
  input.typing = true;
  press(pad, PAD.jump);
  assert.equal(input.sample().jump, false);
  assert.equal(input.takeAction("jump"), false);
  input.typing = false;
  press(pad, PAD.jump, 0);
  input.poll();
  dialog = true;
  press(pad, PAD.boost);
  assert.equal(input.sample().boost, false);
  dialog = false;
  input.gameplayEnabled = false;
  assert.equal(input.sample().boost, false);
  input.clear();
  press(pad, 16);
  input.poll();
  assert.equal(
    input.takeAction("camera"),
    false,
    "Menu navigation cannot toggle gameplay camera",
  );
  assert.equal(
    input.takeAction("pause"),
    true,
    "Pause/back remains available in menus",
  );
  press(pad, 16, 0);
  input.poll();
  input.gameplayEnabled = true;
  press(pad, PAD.boost, 0);
  input.controller.settings = controllerDefaults();
  pad.axes = [-1, 0, 0, 0];
  press(pad, PAD.rollRight);
  press(pad, PAD.jump);
  c = input.sample();
  assert.equal(c.directionalRoll, 1);
  assert.equal(c.yaw, -1);
  const jump = new JumpState();
  jump.step(c, false, P.dt);
  assert.equal(
    jump.stall,
    true,
    "Opposing yaw + dedicated roll still yields a stall",
  );
  pads = [];
  for (const fn of listeners.get("gamepaddisconnected") ?? [])
    fn({ gamepad: pad });
  input.keys.add("KeyW");
  c = input.sample();
  assert.equal(c.throttle, 1);
  assert.equal(c.roll, 0);
  assert.ok(input.controller.status.includes("disconnected"));
  pad.axes = [0, 0, 0, 0];
  press(pad, PAD.jump, 0);
  press(pad, PAD.rollRight, 0);
  pads = [pad];
  input.sample();
  assert.ok(input.controller.status.includes("Connected"));
  input.clear();
  press(pad, PAD.jump);
  assert.equal(input.sample().jump, true, "Reconnect resumes input");
  const other = makePad("Second", 1);
  press(other, PAD.boost);
  pads = [pad, other];
  input.sample();
  assert.equal(input.controller.selectedIndex, 0);
  assert.equal(
    input.sample().boost,
    false,
    "Independent controller cannot mix in input",
  );
  pads = [other];
  input.sample();
  assert.equal(input.controller.selectedIndex, 1);
  assert.equal(input.sample().boost, true);
}
// Options stays bindable on a tap, and supplies a controller-only cancel on hold.
const cancelPad = makePad("Capture cancel");
pads = [cancelPad];
let clock = 0,
  cancelled = 0,
  captured: ControllerBinding | null = null;
const captureInput = new ControllerInput(controllerDefaults(), () => clock);
captureInput.poll();
press(cancelPad, PAD.pause);
captureInput.beginBind(
  "jump",
  (b) => {
    captured = b;
  },
  () => cancelled++,
);
clock = 1000;
captureInput.poll();
assert.equal(cancelled, 0, "Already-held Options cannot cancel or bind");
press(cancelPad, PAD.pause, 0);
captureInput.poll();
press(cancelPad, PAD.pause);
captureInput.poll();
clock += 449;
captureInput.poll();
assert.equal(cancelled, 0);
clock += 1;
captureInput.poll();
assert.equal(cancelled, 1);
assert.equal(captured, null);
assert.equal(captureInput.binding, false);
assert.equal(
  captureInput.values.pause,
  0,
  "Cancelled held Options cannot trigger Pause",
);
press(cancelPad, PAD.pause, 0);
captureInput.poll();
captureInput.beginBind(
  "pause",
  (b) => {
    captured = b;
  },
  () => cancelled++,
);
captureInput.poll();
press(cancelPad, PAD.pause);
captureInput.poll();
clock += 100;
press(cancelPad, PAD.pause, 0);
captureInput.poll();
assert.deepEqual(captured, { type: "button", button: PAD.pause });
assert.equal(cancelled, 1);
saved = JSON.stringify({
  bindings: { jump: "KeyJ" },
  controller: {
    deadzone: 0.18,
    bindings: {
      jump: { type: "button", button: 3 },
      cameraLeft: {
        type: "axis",
        axis: 2,
        direction: -1,
        threshold: 0.6,
        analog: true,
      },
    },
  },
});
const settings = new Settings();
settings.save();
const restored = new Settings();
assert.equal(restored.value.bindings.jump, "KeyJ");
assert.deepEqual(restored.value.controller.bindings.jump, {
  type: "button",
  button: 3,
});
assert.equal(restored.value.controller.deadzone, 0.18);
assert.ok(
  preferencesSchema.safeParse(restored.value).success,
  "Frontend persistence and backend schema agree",
);
const legacy: any = structuredClone(restored.value);
delete legacy.controller;
for (const key of ["cameraLeft", "cameraRight", "cameraUp", "cameraDown"])
  delete legacy.bindings[key];
const migrated = preferencesSchema.parse(legacy);
assert.deepEqual(migrated.controller, controllerDefaults());
assert.equal(migrated.bindings.jump, "KeyJ");
delete legacy.bindings.jump;
assert.equal(
  preferencesSchema.safeParse(legacy).success,
  false,
  "Existing required keyboard bindings remain validated",
);
const invalid: any = structuredClone(restored.value);
invalid.controller.bindings.jump = { type: "button", button: -1 };
assert.equal(preferencesSchema.safeParse(invalid).success, false);
const look = new MouseLook();
for (let i = 0; i < 60; i++) {
  look.controllerLook(0.7, -0.3, 1 / 60);
  look.update(1 / 60, settings.value.camera);
}
assert.ok(look.yaw > 0.5 && look.pitch < -0.1);
const yaw = look.yaw;
look.controllerLook(0, 0, 1 / 60);
look.update(1 / 60, settings.value.camera);
assert.ok(look.yaw > 0 && look.yaw < yaw, "Release eases, never snaps");
for (let i = 0; i < 180; i++) {
  look.controllerLook(0, 0, 1 / 60);
  look.update(1 / 60, settings.value.camera);
}
assert.equal(look.active, false);
look.begin();
look.move(20, 10);
const target = look.targetYaw;
look.controllerLook(1, 1, 1 / 60);
assert.equal(look.targetYaw, target, "Mouse drag has priority");
console.log(
  "PASS Xbox/PlayStation standard input, analog/radial deadzone, strongest-device coexistence, edges, button/axis neutral capture, drift/disconnect/reconnect, menu/chat blocking, stall chord, persistence/migration and eased camera",
);
