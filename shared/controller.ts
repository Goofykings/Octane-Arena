import { defaultBindings, type Action } from "./controls.js";

export type ControllerBinding =
  | { type: "button"; button: number }
  | { type: "analogButton"; button: number; threshold: number }
  | {
      type: "axis";
      axis: number;
      direction: -1 | 1;
      threshold: number;
      analog: boolean;
    };
export type ControllerBindings = Record<Action, ControllerBinding | null>;
export interface ControllerSettings {
  bindings: ControllerBindings;
  deadzone: number;
}
export const PAD = {
  jump: 0,
  boost: 1,
  slide: 2,
  camera: 3,
  rollLeft: 4,
  rollRight: 5,
  reverse: 6,
  throttle: 7,
  scoreboard: 8,
  pause: 9,
  reverseCam: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;
const buttonNames = [
  "A / Cross",
  "B / Circle",
  "X / Square",
  "Y / Triangle",
  "LB / L1",
  "RB / R1",
  "LT / L2",
  "RT / R2",
  "Back / Share",
  "Start / Options",
  "LS",
  "RS",
  "D-pad Up",
  "D-pad Down",
  "D-pad Left",
  "D-pad Right",
  "Home / PS",
];
export const controllerActions = Object.keys(defaultBindings) as Action[];
export const analogActions = new Set<Action>([
  "throttle",
  "reverse",
  "left",
  "right",
  "pitchForward",
  "pitchBack",
  "yawLeft",
  "yawRight",
  "rollLeft",
  "rollRight",
  "cameraLeft",
  "cameraRight",
  "cameraUp",
  "cameraDown",
]);
export function controllerDefaults(): ControllerSettings {
  const bindings = Object.fromEntries(
    controllerActions.map((k) => [k, null]),
  ) as ControllerBindings;
  const axis = (axis: number, direction: -1 | 1): ControllerBinding => ({
    type: "axis",
    axis,
    direction,
    threshold: 0.5,
    analog: true,
  });
  Object.assign(bindings, {
    throttle: { type: "analogButton", button: PAD.throttle, threshold: 0.5 },
    reverse: { type: "analogButton", button: PAD.reverse, threshold: 0.5 },
    left: axis(0, -1),
    right: axis(0, 1),
    pitchForward: axis(1, -1),
    pitchBack: axis(1, 1),
    jump: { type: "button", button: PAD.jump },
    boost: { type: "button", button: PAD.boost },
    slide: { type: "button", button: PAD.slide },
    airRoll: { type: "button", button: PAD.slide },
    rollLeft: { type: "button", button: PAD.rollLeft },
    rollRight: { type: "button", button: PAD.rollRight },
    camera: { type: "button", button: PAD.camera },
    reverseCam: { type: "button", button: PAD.reverseCam },
    scoreboard: { type: "button", button: PAD.scoreboard },
    pause: { type: "button", button: PAD.pause },
    cameraLeft: axis(2, -1),
    cameraRight: axis(2, 1),
    cameraUp: axis(3, -1),
    cameraDown: axis(3, 1),
  });
  return { bindings, deadzone: 0.12 };
}
export function validControllerBinding(
  value: unknown,
): value is ControllerBinding | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const b = value as ControllerBinding;
  const index = (n: number) => Number.isInteger(n) && n >= 0 && n <= 63;
  const threshold = (n: number) => Number.isFinite(n) && n >= 0.1 && n <= 1;
  if (b.type === "button") return index(b.button);
  if (b.type === "analogButton")
    return index(b.button) && threshold(b.threshold);
  return (
    b.type === "axis" &&
    index(b.axis) &&
    (b.direction === -1 || b.direction === 1) &&
    threshold(b.threshold) &&
    typeof b.analog === "boolean"
  );
}
export function controllerName(
  binding: ControllerBinding | null,
  standard = true,
) {
  if (!binding) return "Unbound";
  if (binding.type !== "axis")
    return standard
      ? (buttonNames[binding.button] ?? `Button ${binding.button}`)
      : `Button ${binding.button}`;
  const stick =
    binding.axis < 2
      ? "Left Stick"
      : binding.axis < 4
        ? "Right Stick"
        : `Axis ${binding.axis}`;
  return `${stick} ${binding.axis < 4 ? (binding.axis % 2 ? (binding.direction < 0 ? "Up" : "Down") : binding.direction < 0 ? "Left" : "Right") : binding.direction < 0 ? "−" : "+"}`;
}
