import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { bodies, type BodyId } from "../../shared/catalog";

/** Same outer dimensions, roof and sides; tapered bumper ends cannot stand on
 * the former full-height rectangular end faces. Shared by CCD and the collider. */
export function chassisPoints(id: BodyId) {
  const d = bodies[id],
    inset = 0.09,
    bumperY = -0.065;
  const profile = [
    [-d.halfLength + inset, -d.halfHeight],
    [-d.halfLength, bumperY],
    [-d.halfLength + inset, d.halfHeight],
    [d.halfLength - inset, d.halfHeight],
    [d.halfLength, bumperY],
    [d.halfLength - inset, -d.halfHeight],
  ];
  return [-d.halfWidth, d.halfWidth].flatMap((x) =>
    profile.map(([z, y]) => new Vector3(x, y + d.hitboxY, z)),
  );
}
export function chassisShape(id: BodyId) {
  const d = bodies[id];
  const points = chassisPoints(id).flatMap((p) => [p.x, p.y - d.hitboxY, p.z]);
  return RAPIER.ColliderDesc.convexHull(new Float32Array(points))!;
}
