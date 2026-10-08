export const defaultBindings = {
  throttle: "KeyW",
  reverse: "KeyS",
  left: "KeyA",
  right: "KeyD",
  pitchForward: "ArrowUp",
  pitchBack: "ArrowDown",
  yawLeft: "ArrowLeft",
  yawRight: "ArrowRight",
  jump: "Space",
  boost: "ShiftLeft",
  slide: "ControlLeft",
  airRoll: "AltLeft",
  rollLeft: "KeyQ",
  rollRight: "KeyE",
  camera: "KeyC",
  reverseCam: "KeyB",
  chat: "KeyT",
  scoreboard: "Tab",
  reset: "KeyR",
  trainingReset: "Digit1",
  possession: "Digit2",
  dribble: "Digit3",
  launch: "Digit4",
  previousLevel: "BracketLeft",
  nextLevel: "BracketRight",
  pause: "Escape",
  debug: "F3",
};
export type Action = keyof typeof defaultBindings;
export type Bindings = Record<Action, string>;
export const actionLabels: Record<Action, string> = {
  throttle: "Throttle / pitch forward",
  reverse: "Reverse / pitch back",
  left: "Steer / yaw left",
  right: "Steer / yaw right",
  pitchForward: "Air pitch forward",
  pitchBack: "Air pitch back",
  yawLeft: "Air yaw left",
  yawRight: "Air yaw right",
  jump: "Jump / dodge",
  boost: "Boost",
  slide: "Powerslide",
  airRoll: "Air roll modifier",
  rollLeft: "Air roll left",
  rollRight: "Air roll right",
  camera: "Ball camera",
  reverseCam: "Reverse Cam (hold)",
  chat: "Chat",
  scoreboard: "Scoreboard (hold)",
  reset: "Reset point",
  trainingReset: "Free Play - Reset",
  possession: "Free Play - Take Possession",
  dribble: "Free Play - Start Dribble",
  launch: "Free Play - Launch Ball",
  previousLevel: "Challenge - Previous Level",
  nextLevel: "Challenge - Next Level",
  pause: "Pause",
  debug: "Physics diagnostics",
};
export const trainingActions = [
  "trainingReset",
  "possession",
  "dribble",
  "launch",
] as const;
export type TrainingAction = (typeof trainingActions)[number];
export const keyName = (code: string) =>
  (({ BracketLeft: "[", BracketRight: "]" })[code] ?? code)
    .replace(/^Key|^Digit/, "")
    .replace("Arrow", "")
    .replace("Left", " L")
    .replace("Right", " R");
export function conflicts(bindings: Bindings, action: Action) {
  // Retained in stored account payloads for compatibility; no longer a gameplay action.
  if (action === "reset") return [];
  return (Object.keys(bindings) as Action[]).filter(
    (k) => k !== "reset" && k !== action && bindings[k] === bindings[action],
  );
}
