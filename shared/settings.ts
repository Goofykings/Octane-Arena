import { defaultBindings, type Bindings } from "./controls.js";
export type Quality = "low" | "medium" | "high" | "ultra";
export const qualities = {
  low: { scale: 0.65, shadows: 0, particles: 0.2, aa: false },
  medium: { scale: 0.85, shadows: 1024, particles: 0.5, aa: true },
  high: { scale: 1, shadows: 2048, particles: 1, aa: true },
  ultra: { scale: 1.3, shadows: 4096, particles: 1.5, aa: true },
};
export interface CameraSettings {
  fov: number;
  distance: number;
  height: number;
  angle: number;
  stiffness: number;
  swivel: number;
  transition: number;
}
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
  quality: Quality;
  audio: AudioSettings;
}
export const defaults = (): Preferences => ({
  infiniteBoost: true,
  quickChat: "off",
  showHitboxes: false,
  camera: {
    fov: 73,
    distance: 5.2,
    height: 2.4,
    angle: -10,
    stiffness: 0.65,
    swivel: 5,
    transition: 1.2,
  },
  bindings: { ...defaultBindings },
  quality: "high",
  audio: { master: 0.7, music: 0.25, sfx: 0.8, engine: 0.65, ui: 0.65 },
});
export const cameraRanges: Record<
  keyof CameraSettings,
  [number, number, number]
> = {
  fov: [60, 110, 1],
  distance: [2.5, 8, 0.1],
  height: [0.5, 4, 0.1],
  angle: [-25, 0, 1],
  stiffness: [0, 1, 0.05],
  swivel: [1, 10, 0.1],
  transition: [0.3, 3, 0.1],
};
