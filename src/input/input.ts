import { neutral, type Controls } from "./types";
import { defaultBindings, type Bindings, type Action } from "./bindings";
export class Input {
  keys = new Set<string>();
  actions = new Set<string>();
  private padPrevious = new Set<number>();
  capturing = false;
  constructor(public bindings: Bindings = { ...defaultBindings }) {
    window.addEventListener("keydown", (e) => {
      if((e.target as HTMLElement)?.matches('input,textarea,select,[contenteditable="true"]'))return;
      if (this.capturing || document.querySelector("dialog[open]")) return;
      if (Object.values(this.bindings).includes(e.code)) e.preventDefault();
      if (!e.repeat) this.actions.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.clear());
  }
  clear() {
    this.keys.clear();
    this.actions.clear();
  }
  take(code: string) {
    const has = this.actions.has(code);
    this.actions.delete(code);
    return has;
  }
  takeAction(action: Action) {
    return this.take(this.bindings[action]);
  }
  sample(): Controls {
    const c = neutral(),
      down = (action: Action) => this.keys.has(this.bindings[action]);
    if (this.capturing || document.querySelector("dialog[open]")) return c;
    c.throttle = Number(down("throttle")) - Number(down("reverse"));
    c.steer = Number(down("right")) - Number(down("left"));
    c.pitch =
      c.throttle + Number(down("pitchForward")) - Number(down("pitchBack"));
    c.yaw = c.steer + Number(down("yawRight")) - Number(down("yawLeft"));
    c.roll = Number(down("rollRight")) - Number(down("rollLeft"));
    c.jump = down("jump") || this.actions.has(this.bindings.jump);
    c.boost = down("boost");
    c.slide = down("slide");
    c.dodgeX = c.yaw || c.roll;
    c.dodgeY = c.pitch;
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(
      (p) => p?.connected && p.buttons.length >= 10 && p.axes.length >= 2,
    );
    if (pad) {
      const dead = (v: number) =>
        Math.abs(v) < 0.12 ? 0 : ((Math.abs(v) - 0.12) / 0.88) * Math.sign(v);
      c.throttle += pad.buttons[7].value - pad.buttons[6].value;
      c.steer += dead(pad.axes[0]);
      c.pitch -= dead(pad.axes[1]);
      c.yaw += dead(pad.axes[0]);
      c.roll += Number(pad.buttons[5].pressed) - Number(pad.buttons[4].pressed);
      c.jump ||= pad.buttons[0].pressed;
      c.boost ||= pad.buttons[1].pressed;
      c.slide ||= pad.buttons[2].pressed;
      for (const [button, code] of [
        [3, this.bindings.camera],
        [9, this.bindings.pause],
      ] as const) {
        if (pad.buttons[button].pressed && !this.padPrevious.has(button))
          this.actions.add(code);
        if (pad.buttons[button].pressed) this.padPrevious.add(button);
        else this.padPrevious.delete(button);
      }
    }
    if (pad) {
      c.dodgeX = deadAxis(pad.axes[0]);
      c.dodgeY = -deadAxis(pad.axes[1]);
    }
    if (down("airRoll") || c.slide) {
      c.roll += c.steer;
      c.yaw = 0;
    }
    for (const key of ["throttle", "steer", "pitch", "yaw", "roll"] as const)
      c[key] = Math.max(-1, Math.min(1, c[key]));
    return c;
  }
}
function deadAxis(v: number) {
  return Math.abs(v) < 0.15 ? 0 : v;
}
