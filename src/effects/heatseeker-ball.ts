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
export function heatseekerBall(
  ball: T.Group,
  state: HeatseekerState | null | undefined,
) {
  const material = ball.userData.panelMaterial as
    | T.MeshStandardMaterial
    | undefined;
  if (!material) return;
  if (!state?.active || state.ownerTeam === null) {
    material.color.setHex(0xffffff);
    material.emissive.setHex(0);
    material.emissiveIntensity = 1;
    return;
  }
  const color = state.ownerTeam === 0 ? 0x399cff : 0xff8b32;
  material.color.setHex(state.ownerTeam === 0 ? 0x98c7ff : 0xffc392);
  material.emissive.setHex(color);
  material.emissiveIntensity = 0.2 + 0.35 * heatIntensity(state);
  for (const lamp of ball.userData.lamps as T.Mesh<
    T.BufferGeometry,
    T.MeshBasicMaterial
  >[])
    lamp.material.color.setHex(color).multiplyScalar(1 + heatIntensity(state));
}
