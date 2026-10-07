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
interface Finish {
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
      const value = T.MathUtils.clamp(
        colors[i] * 0.2126 + colors[i + 1] * 0.7152 + colors[i + 2] * 0.0722,
        0.18,
        0.9,
      );
      gray[i] = gray[i + 1] = gray[i + 2] = value;
    }
    finish = {
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
  if (!finish.applied) {
    attribute.array.set(finish.gray);
    attribute.needsUpdate = true;
    finish.applied = true;
  }
  const owned = state.active && state.ownerTeam !== null;
  const color = owned
    ? state.ownerTeam === 0
      ? 0x399cff
      : 0xff8b32
    : 0xb1b8c0;
  panel.color.setHex(color);
  panel.emissive.setHex(owned ? color : 0x66717c);
  panel.emissiveIntensity = owned ? 0.2 + 0.35 * heatIntensity(state) : 0.035;
  panel.metalness = owned ? 0.4 : 0.7;
  panel.roughness = owned ? 0.38 : 0.32;
  core.color.setHex(owned ? color : 0x4a5057).multiplyScalar(owned ? 0.3 : 1);
  core.emissive.setHex(owned ? color : 0x66717c);
  core.emissiveIntensity = owned ? 0.12 : 0.025;
  core.metalness = 0.7;
  core.roughness = 0.32;
  for (const lamp of ball.userData.lamps as T.Mesh<
    T.BufferGeometry,
    T.MeshBasicMaterial
  >[])
    lamp.material.color
      .setHex(color)
      .multiplyScalar(owned ? 1 + heatIntensity(state) : 0.4);
}
