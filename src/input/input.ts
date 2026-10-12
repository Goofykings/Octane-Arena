import { neutral, type Controls } from "./types";
import { defaultBindings, type Bindings, type Action } from "./bindings";
import { ControllerInput } from "./controller";
import {
  controllerDefaults,
  controllerActions,
  type ControllerSettings,
} from "../../shared/controller";
export class Input {
  keys = new Set<string>();
  actions = new Set<string>();
  readonly controller: ControllerInput;
  private controllerActions = new Set<Action>();
  private previousValues = new Map<Action, number>();
  readonly justPressed = new Set<Action>();
  readonly justReleased = new Set<Action>();
  gameplayEnabled = true;
  capturing = false;
  typing = false;
  scoreboardActive = false;
  constructor(
    public bindings: Bindings = { ...defaultBindings },
    controller: ControllerSettings = controllerDefaults(),
  ) {
    this.controller = new ControllerInput(controller);
    window.addEventListener("keydown", (e) => {
      if (
        (e.target as HTMLElement)?.matches(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if (
        this.capturing ||
        this.typing ||
        document.querySelector("dialog[open]")
      )
        return;
      if (
        Object.values(this.bindings).includes(e.code) &&
        (e.code !== this.bindings.scoreboard || this.scoreboardActive)
      )
        e.preventDefault();
      if (!e.repeat) this.actions.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.clear());
  }
  clear() {
    this.keys.clear();
    this.actions.clear();
    this.controllerActions.clear();
    this.controller.quarantine();
    this.justPressed.clear();
    this.justReleased.clear();
  }
  take(code: string) {
    const has = this.actions.has(code);
    this.actions.delete(code);
    return has;
  }
  takeControllerAction(action: Action) {
    const has = this.controllerActions.has(action);
    this.controllerActions.delete(action);
    return has;
  }
  takeAction(action: Action) {
    const keyboard = this.take(this.bindings[action]);
    const controller = this.takeControllerAction(action);
    return keyboard || controller;
  }
  requestAction(action: Action) {
    this.controllerActions.add(action);
  }
  get blocked() {
    return (
      this.capturing ||
      this.controller.binding ||
      this.typing ||
      !!document.querySelector("dialog[open]") ||
      !!document.hidden
    );
  }
  getAction(action: Action) {
    if (this.blocked) return 0;
    return Math.max(
      Number(this.keys.has(this.bindings[action])),
      this.controller.values[action],
    );
  }
  isHeld(action: Action) {
    return this.getAction(action) > 0.5;
  }
  poll() {
    this.controller.poll();
    this.justPressed.clear();
    this.justReleased.clear();
    const blocked = this.blocked;
    for (const action of controllerActions) {
      const value = blocked
          ? 0
          : Math.max(
              Number(this.keys.has(this.bindings[action])),
              this.controller.values[action],
            ),
        previous = this.previousValues.get(action) ?? 0;
      if (value > 0.5 && previous <= 0.5) this.justPressed.add(action);
      if (value <= 0.5 && previous > 0.5) this.justReleased.add(action);
      this.previousValues.set(action, value);
      if (
        !blocked &&
        (this.gameplayEnabled || action === "pause") &&
        this.controller.pressed.has(action)
      )
        this.controllerActions.add(action);
    }
    if (blocked) {
      this.actions.clear();
      this.controllerActions.clear();
    }
  }
  sample(poll = true): Controls {
    if (poll) this.poll();
    const c = neutral();
    if (this.blocked || !this.gameplayEnabled) return c;
    const key = (action: Action) =>
      Number(this.keys.has(this.bindings[action]));
    // Resolve opposing movement by strongest device magnitude; keyboard wins ties.
    const strongest = (keyboard: number, controller: number) =>
      Math.abs(keyboard) >= Math.abs(controller) ? keyboard : controller;
    const pad = this.controller.values;
    c.throttle = strongest(
      key("throttle") - key("reverse"),
      pad.throttle - pad.reverse,
    );
    c.steer = strongest(key("right") - key("left"), pad.right - pad.left);
    // Keyboard W/S retain their historic aerial behavior; controller triggers are
    // purely throttle/brake, and the left stick supplies independent pitch.
    c.pitch = strongest(
      key("throttle") - key("reverse") + key("pitchForward") - key("pitchBack"),
      pad.pitchForward - pad.pitchBack,
    );
    c.yaw = strongest(
      key("right") - key("left") + key("yawRight") - key("yawLeft"),
      pad.right - pad.left + pad.yawRight - pad.yawLeft,
    );
    c.roll = strongest(
      key("rollRight") - key("rollLeft"),
      pad.rollRight - pad.rollLeft,
    );
    c.directionalRoll = c.roll;
    c.jump =
      this.isHeld("jump") ||
      this.actions.has(this.bindings.jump) ||
      this.controllerActions.has("jump");
    c.usePowerup =
      this.isHeld("usePowerup") ||
      this.actions.has(this.bindings.usePowerup) ||
      this.controllerActions.has("usePowerup");
    c.boost = this.isHeld("boost");
    c.slide = this.isHeld("slide");
    c.dodgeX = c.yaw || c.roll;
    c.dodgeY = c.pitch;
    // A dedicated roll is explicit intent. Generic air roll may remap steering
    // only when no dedicated roll is active; adding both could cancel roll.
    if ((this.isHeld("airRoll") || c.slide) && c.directionalRoll === 0) {
      c.roll += c.steer;
      c.yaw = 0;
    }
    for (const action of ["throttle", "steer", "pitch", "yaw", "roll"] as const)
      c[action] = Math.max(-1, Math.min(1, c[action]));
    c.directionalRoll = Math.max(-1, Math.min(1, c.directionalRoll));
    return c;
  }
}
