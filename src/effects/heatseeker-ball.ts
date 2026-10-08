import * as T from "three";
import type { HeatseekerState } from "../../shared/soccer";
import { HEATSEEKER as H } from "../config/heatseeker";
export function heatIntensity(state: HeatseekerState | null | undefined) {
  return state?.active
    ? T.MathUtils.clamp(
        (state.speed - H.initialSpeed) / (H.maxSpeed - H.initialSpeed),
        0,
        1,
      )
    : 0;
}
// Restore the original Soccar materials/vertex colors exactly when this treatment
// is removed. Histories belong to each ball instance, including replay models.
export const HEAT_VISUAL = {
  neutral: 0xf5f8ff,
  blue: 0x399cff,
  orange: 0xff8b32,
  maximum: 0xf6a9ff,
  transition: 0.18,
} as const;
export function heatColor(state: HeatseekerState | null | undefined) {
  if (!state?.active || state.ownerTeam === null) return HEAT_VISUAL.neutral;
  return state.speed >= H.maxSpeed - 1e-6
    ? HEAT_VISUAL.maximum
    : state.ownerTeam === 0
      ? HEAT_VISUAL.blue
      : HEAT_VISUAL.orange;
}
interface Finish {
  current: T.Color;
  from: T.Color;
  target: T.Color;
  targetHex: number;
  elapsed: number;
  heat: number;
  power: number;
  panel: T.MeshStandardMaterial;
  core: T.MeshStandardMaterial;
  attribute: T.BufferAttribute;
  colors: Float32Array;
  gray: Float32Array;
  original: {
    color: T.Color;
    emissive: T.Color;
    intensity: number;
    roughness: number;
    metalness: number;
  }[];
  applied: boolean;
}
const finishes = new WeakMap<T.Group, Finish>();
export function heatseekerBall(
  ball: T.Group,
  state: HeatseekerState | null | undefined,
  dt = 1 / 60,
) {
  let finish = finishes.get(ball);
  if (!state && !finish?.applied) return;
  if (!finish) {
    const panel = ball.userData.panelMaterial as T.MeshStandardMaterial,
      core = ball.userData.coreMaterial as T.MeshStandardMaterial,
      geometry = ball.userData.panelGeometry as T.BufferGeometry;
    if (!panel || !core || !geometry) return;
    const attribute = geometry.getAttribute("color") as T.BufferAttribute;
    const colors = new Float32Array(attribute.array),
      gray = new Float32Array(colors.length);
    for (let i = 0; i < colors.length; i += 3) {
      const value =
        0.84 +
        0.14 *
          T.MathUtils.clamp(
            colors[i] * 0.2126 +
              colors[i + 1] * 0.7152 +
              colors[i + 2] * 0.0722,
            0,
            1,
          );
      gray[i] = gray[i + 1] = gray[i + 2] = value;
    }
    finish = {
      current: new T.Color(),
      from: new T.Color(),
      target: new T.Color(),
      targetHex: -1,
      elapsed: 0,
      heat: 0,
      power: 0,
      panel,
      core,
      attribute,
      colors,
      gray,
      applied: false,
      original: [panel, core].map((m) => ({
        color: m.color.clone(),
        emissive: m.emissive.clone(),
        intensity: m.emissiveIntensity,
        roughness: m.roughness,
        metalness: m.metalness,
      })),
    };
    finishes.set(ball, finish);
  }
  const { panel, core, attribute } = finish;
  if (!state) {
    attribute.array.set(finish.colors);
    attribute.needsUpdate = true;
    [panel, core].forEach((m, i) => {
      const original = finish!.original[i];
      m.color.copy(original.color);
      m.emissive.copy(original.emissive);
      m.emissiveIntensity = original.intensity;
      m.roughness = original.roughness;
      m.metalness = original.metalness;
    });
    finish.applied = false;
    return;
  }
  const fresh = !finish.applied;
  if (fresh) {
    attribute.array.set(finish.gray);
    attribute.needsUpdate = true;
    finish.applied = true;
  }
  const owned = state.active && state.ownerTeam !== null;
  const color = heatColor(state);
  if (fresh || !owned) {
    finish.current.setHex(color);
    finish.from.copy(finish.current);
    finish.target.copy(finish.current);
    finish.targetHex = color;
    finish.elapsed = HEAT_VISUAL.transition;
  } else if (color !== finish.targetHex) {
    finish.from.copy(finish.current);
    finish.target.setHex(color);
    finish.targetHex = color;
    finish.elapsed = 0;
  }
  finish.elapsed = Math.min(
    HEAT_VISUAL.transition,
    finish.elapsed + Math.max(0, dt),
  );
  finish.current.lerpColors(
    finish.from,
    finish.target,
    T.MathUtils.smoothstep(finish.elapsed, 0, HEAT_VISUAL.transition),
  );
  const intensity = heatIntensity(state);
  if (fresh || !owned) {
    finish.heat = intensity;
    finish.power = owned ? 1 : 0;
  }
  const blend = 1 - Math.exp(-Math.max(0, dt) / 0.08);
  finish.heat += (intensity - finish.heat) * blend;
  finish.power += ((owned ? 1 : 0) - finish.power) * blend;
  panel.color.copy(finish.current);
  panel.emissive.copy(finish.current);
  panel.emissiveIntensity = 0.075 + 0.145 * finish.power + 0.3 * finish.heat;
  panel.metalness = 0.22;
  panel.roughness = 0.42;
  core.color.copy(finish.current).multiplyScalar(owned ? 0.65 : 0.72);
  core.emissive.copy(finish.current);
  core.emissiveIntensity = 0.025 + 0.135 * finish.power;
  core.metalness = 0.35;
  core.roughness = 0.45;
  for (const lamp of ball.userData.lamps as T.Mesh<
    T.BufferGeometry,
    T.MeshBasicMaterial
  >[])
    lamp.material.color
      .copy(finish.current)
      .multiplyScalar(0.85 + 0.15 * finish.power + finish.heat * 0.4);
}
