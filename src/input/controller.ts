import type { Action } from "./bindings";
import {
  analogActions,
  controllerActions,
  controllerDefaults,
  PAD,
  type ControllerBinding,
  type ControllerSettings,
} from "../../shared/controller";

/** Standard mapping is supplied by the browser, never inferred from device names.
 * Poll once per render frame; gameplay reads only cached action values. */
export class ControllerInput {
  pad: Gamepad | null = null;
  selectedIndex: number | null = null;
  status = "No Controller Connected";
  readonly values = Object.fromEntries(
    controllerActions.map((k) => [k, 0]),
  ) as Record<Action, number>;
  readonly pressed = new Set<Action>();
  readonly released = new Set<Action>();
  private blocked = new Set<Action>();
  private axes = new Float32Array(64);
  private capture: {
    action: Action;
    neutral: boolean;
    done: (binding: ControllerBinding) => void;
    cancel?: () => void;
    menuSince: number | null;
  } | null = null;
  constructor(
    public settings: ControllerSettings = controllerDefaults(),
    private now = () => performance.now(),
  ) {
    window.addEventListener("gamepadconnected", (event) => {
      const pad = (event as GamepadEvent).gamepad;
      if (this.selectedIndex === null || this.selectedIndex === pad.index) {
        this.selectedIndex = pad.index;
        this.status = `${pad.id} — Connected${pad.mapping === "standard" ? "" : " (custom mapping)"}`;
      }
      // Values/edges belong to the frame poll. An event-time poll would consume
      // the first button press that made the controller visible to the browser.
    });
    window.addEventListener("gamepaddisconnected", (event) => {
      if ((event as GamepadEvent).gamepad.index === this.selectedIndex) {
        this.status = "Controller disconnected — keyboard available";
        this.pad = null;
        this.clearValues();
      }
    });
  }
  get binding() {
    return this.capture !== null;
  }
  axisValue(index: number) {
    return this.axes[index] ?? 0;
  }
  beginBind(
    action: Action,
    done: (binding: ControllerBinding) => void,
    cancel?: () => void,
  ) {
    this.capture = { action, neutral: false, done, cancel, menuSince: null };
    this.quarantine();
  }
  cancelBind() {
    this.capture = null;
    this.quarantine();
  }
  quarantine() {
    for (const action of controllerActions)
      if (
        this.values[action] > 0 ||
        (this.pad && this.read(this.settings.bindings[action], this.pad) > 0)
      )
        this.blocked.add(action);
    this.pressed.clear();
    this.released.clear();
  }
  private clearValues() {
    for (const action of controllerActions) this.values[action] = 0;
    this.pressed.clear();
    this.released.clear();
    this.blocked.clear();
  }
  poll() {
    let pads: (Gamepad | null)[] | readonly (Gamepad | null)[];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch {
      pads = [];
    }
    let selected: Gamepad | null = null,
      fallback: Gamepad | null = null;
    for (const pad of pads) {
      if (!pad?.connected) continue;
      if (
        !fallback ||
        (pad.mapping === "standard" && fallback.mapping !== "standard")
      )
        fallback = pad;
      if (pad.index === this.selectedIndex) selected = pad;
    }
    // Keep the selected device; otherwise prefer the first actively used pad.
    if (!selected) {
      for (const pad of pads) {
        if (
          pad?.connected &&
          (pad.buttons.some((b) => b.value > 0.2) ||
            pad.axes.some((v) => Math.abs(v) > 0.3))
        ) {
          selected = pad;
          break;
        }
      }
      selected ??= fallback;
    }
    if (selected?.index !== this.pad?.index || selected?.id !== this.pad?.id) {
      this.clearValues();
      if (this.capture) this.capture.neutral = false;
    }
    this.pad = selected;
    if (selected) {
      this.selectedIndex = selected.index;
      this.status = `${selected.id} — Connected${selected.mapping === "standard" ? "" : " (custom mapping)"}`;
    } else if (!this.status.startsWith("Controller disconnected")) {
      this.status =
        this.selectedIndex === null
          ? "No Controller Connected"
          : "Controller disconnected — keyboard available";
    }
    this.pressed.clear();
    this.released.clear();
    if (!selected) {
      this.clearValues();
      return;
    }
    this.readAxes(selected);
    const capture = this.capture;
    if (capture) {
      const neutral =
        !selected.buttons.some((b) => b.value > 0.2) &&
        !selected.axes.some((v) => Math.abs(v) > 0.25);
      if (!capture.neutral) capture.neutral = neutral;
      else {
        let binding: ControllerBinding | null = null;
        const menuHeld =
          !!capture.cancel && !!selected.buttons[PAD.pause]?.pressed;
        if (menuHeld) {
          capture.menuSince ??= this.now();
          if (this.now() - capture.menuSince >= 450) {
            this.capture = null;
            capture.cancel!();
            this.quarantine();
          }
        } else if (capture.menuSince !== null) {
          binding = { type: "button", button: PAD.pause };
          capture.menuSince = null;
        }
        if (!menuHeld && !binding)
          for (let i = 0; i < selected.buttons.length; i++) {
            if (selected.buttons[i].value < 0.6) continue;
            binding = analogActions.has(capture.action)
              ? { type: "analogButton", button: i, threshold: 0.5 }
              : { type: "button", button: i };
            break;
          }
        if (!menuHeld && !binding)
          for (let i = 0; i < Math.min(64, selected.axes.length); i++) {
            if (Math.abs(selected.axes[i]) < 0.6) continue;
            binding = {
              type: "axis",
              axis: i,
              direction: selected.axes[i] < 0 ? -1 : 1,
              threshold: 0.5,
              analog: analogActions.has(capture.action),
            };
            break;
          }
        if (binding) {
          this.capture = null;
          capture.done(binding);
          this.quarantine();
        }
      }
    }
    for (const action of controllerActions) {
      const previous = this.values[action];
      const raw = this.read(this.settings.bindings[action], selected);
      if (raw === 0) this.blocked.delete(action);
      const value = this.capture || this.blocked.has(action) ? 0 : raw;
      this.values[action] = value;
      if (value > 0.5 && previous <= 0.5) this.pressed.add(action);
      if (value <= 0.5 && previous > 0.5) this.released.add(action);
    }
  }
  private readAxes(pad: Gamepad) {
    this.axes.fill(0);
    const dz = this.settings.deadzone;
    for (let i = 0; i < Math.min(64, pad.axes.length); i += 2) {
      const x = Number.isFinite(pad.axes[i]) ? pad.axes[i] : 0;
      const y = Number.isFinite(pad.axes[i + 1]) ? pad.axes[i + 1] : 0;
      const length = Math.hypot(x, y);
      if (length <= dz) continue;
      const scale = Math.min(1, (length - dz) / (1 - dz)) / length;
      this.axes[i] = x * scale;
      if (i + 1 < 64) this.axes[i + 1] = y * scale;
    }
  }
  private read(binding: ControllerBinding | null, pad: Gamepad) {
    if (!binding) return 0;
    if (binding.type === "button")
      return Number(!!pad.buttons[binding.button]?.pressed);
    if (binding.type === "analogButton") {
      const value = Math.max(
        0,
        Math.min(1, pad.buttons[binding.button]?.value ?? 0),
      );
      return value < 0.03 ? 0 : value;
    }
    const value = Math.max(
      0,
      (this.axes[binding.axis] ?? 0) * binding.direction,
    );
    return binding.analog ? value : Number(value >= binding.threshold);
  }
}
