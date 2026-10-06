import { Vector3, Quaternion } from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { bodies, type BodyId } from "../../shared/catalog";
import { P } from "../config/physics";
export const wheelRadius = 0.18;
export const wheelHalfWidth = 0.0575;
export const wheelMountY = -0.12;
/** Round only the sidewall/shoulder. Ordinary tread contacts retain the existing
 * rigid cylinder envelope and ramp clearance exactly. */
function roundedWheelOffset(axle: Vector3, normal: Vector3) {
  const axial = axle.dot(normal),
    radial = normal.clone().addScaledVector(axle, -axial);
  const radialLength = radial.length();
  if (radialLength > 1e-8) radial.multiplyScalar(1 / radialLength);
  const blend = Math.max(0, Math.min(1, (Math.abs(axial) - 0.65) / 0.3));
  const denominator = Math.hypot(
    wheelRadius * radialLength,
    wheelHalfWidth * axial,
  );
  const roundedRadial =
    (wheelRadius * wheelRadius * radialLength) / Math.max(1e-8, denominator);
  const roundedAxial =
    (wheelHalfWidth * wheelHalfWidth * axial) / Math.max(1e-8, denominator);
  return radial
    .multiplyScalar(wheelRadius + (roundedRadial - wheelRadius) * blend)
    .addScaledVector(
      axle,
      Math.sign(axial) * wheelHalfWidth * (1 - blend) + roundedAxial * blend,
    );
}
/** Actual fixed cylinder support point, including camber and tread width. */
export function wheelSupportPoint(
  origin: Vector3,
  rotation: Quaternion,
  normal: Vector3,
  steer = 0,
) {
  const up = new Vector3(0, 1, 0).applyQuaternion(rotation);
  const axle = new Vector3(
    Math.cos(steer),
    0,
    -Math.sin(steer),
  ).applyQuaternion(rotation);
  return origin
    .clone()
    .addScaledVector(up, wheelMountY)
    .sub(roundedWheelOffset(axle, normal));
}
export function wheelMount(id: BodyId, index: number, out = new Vector3()) {
  const d = bodies[id];
  return out.set(
    (index % 2 ? 1 : -1) * (d.halfWidth + 0.005),
    0,
    (index < 2 ? -1 : 1) * d.axle,
  );
}
/** Rigid wheel-envelope clearance against the same static collision mesh.
 * Cylinder support radius accounts for wheel camber and tread width on a slope. */
export function wheelClearance(
  world: RAPIER.World,
  position: Vector3,
  rotation: Quaternion,
  id: BodyId,
  index: number,
  collider: RAPIER.Collider,
  body: RAPIER.RigidBody,
  steer = 0,
  surfaceNormal = new Vector3(),
) {
  const up = new Vector3(0, 1, 0).applyQuaternion(rotation);
  const origin = wheelMount(id, index).applyQuaternion(rotation).add(position);
  const hit = world.castRayAndGetNormal(
    new RAPIER.Ray(origin, up.clone().negate()),
    P.car.rayLength + wheelRadius * 2,
    true,
    undefined,
    undefined,
    collider,
    body,
    (col) => col.parent() === null,
  );
  if (!hit || up.dot(hit.normal) < 0.25) return -Infinity;
  surfaceNormal.copy(hit.normal);
  const axle = new Vector3(
    Math.cos(steer),
    0,
    -Math.sin(steer),
  ).applyQuaternion(rotation);
  const support = roundedWheelOffset(axle, new Vector3().copy(hit.normal)).dot(
    hit.normal,
  );
  // Required rigid mount clearance. The whole chassis is corrected by physics;
  // this value must never displace a rendered wheel relative to the chassis.
  let height =
    -hit.timeOfImpact + (support + P.car.contactSkin) / up.dot(hit.normal);
  // The centre tangent plane alone misses the curved surface under the tread's
  // leading/trailing edges. Fit those planes too, without animated spring travel.
  const tread = new Vector3(
    Math.sin(steer),
    0,
    Math.cos(steer),
  ).applyQuaternion(rotation);
  for (const sign of [-1, 1]) {
    const offset = tread.clone().multiplyScalar(sign * wheelRadius * 0.8);
    const edge = world.castRayAndGetNormal(
      new RAPIER.Ray(origin.clone().add(offset), up.clone().negate()),
      P.car.rayLength + wheelRadius * 2,
      true,
      undefined,
      undefined,
      collider,
      body,
      (col) => col.parent() === null,
    );
    if (!edge || up.dot(edge.normal) < 0.25) continue;
    const support = roundedWheelOffset(
      axle,
      new Vector3().copy(edge.normal),
    ).dot(edge.normal);
    const edgeHeight =
      -edge.timeOfImpact +
      (support + P.car.contactSkin + offset.dot(edge.normal)) /
        up.dot(edge.normal);
    if (edgeHeight > height) {
      height = edgeHeight;
      surfaceNormal.copy(edge.normal);
    }
  }
  return height;
}
