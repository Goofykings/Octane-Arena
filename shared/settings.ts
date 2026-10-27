import { defaultBindings, type Bindings } from "./controls.js";
import { controllerDefaults, type ControllerSettings } from "./controller.js";
export type Quality = "low" | "medium" | "high" | "ultra";
export const qualities = {
  low: { scale: 0.65, shadows: 0, particles: 0.2, aa: false },
  medium: { scale: 0.85, shadows: 1024, particles: 0.5, aa: true },
  high: { scale: 1, shadows: 2048, particles: 1, aa: true },
  ultra: { scale: 1.3, shadows: 4096, particles: 1.5, aa: true },
};
/** Rocket League camera settings, in RL units: horizontal FOV (degrees at
 * 16:9), distance/height in uu (100 uu = 1 m), angle in degrees. */
export interface CameraSettings {
  fov: number;
  distance: number;
  height: number;
  angle: number;
  stiffness: number;
  swivel: number;
  transition: number;
  shake: boolean;
}
export type CameraRangeKey = Exclude<keyof CameraSettings, "shake">;
/** Settings payload version; camera values before 3 used metres and vertical FOV. */
export const SETTINGS_VERSION = 3;
export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  engine: number;
  ui: number;
}
export interface Preferences {
  infiniteBoost: boolean;
  quickChat: "off" | "friends" | "everyone";
  showHitboxes: boolean;
  camera: CameraSettings;
  bindings: Bindings;
  controller: ControllerSettings;
  quality: Quality;
  audio: AudioSettings;
}
export const defaults = (): Preferences => ({
  infiniteBoost: true,
  quickChat: "off",
  showHitboxes: false,
  camera: cameraDefaults(),
  bindings: { ...defaultBindings },
  controller: controllerDefaults(),
  quality: "high",
  audio: { master: 0.7, music: 0.25, sfx: 0.8, engine: 0.65, ui: 0.65 },
});
/** Rocket League-like default preset. */
export function cameraDefaults(): CameraSettings {
  return {
    fov: 110,
    distance: 270,
    height: 100,
    angle: -3,
    stiffness: 0.4,
    swivel: 5,
    transition: 1.3,
    shake: false,
  };
}
/** Rocket League's own setting ranges. */
export const cameraRanges: Record<CameraRangeKey, [number, number, number]> = {
  fov: [60, 110, 1],
  distance: [100, 400, 10],
  height: [40, 200, 10],
  angle: [-15, 0, 1],
  stiffness: [0, 1, 0.05],
  swivel: [1, 10, 0.1],
  transition: [1, 2, 0.1],
};
/** Legacy camera blocks (metres, vertical FOV, no shake flag) cannot map onto
 * the RL rig one-to-one, so they restart from the RL preset. */
export function migrateCamera(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const camera = value as Record<string, unknown>;
  return typeof camera.shake === "boolean" ? camera : cameraDefaults();
}
