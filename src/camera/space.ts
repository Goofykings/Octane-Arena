import { HOOPS_NET_GROUP, HOOPS_RIM_GROUP } from "../physics/collision-groups";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";

export interface CameraCollisionSpace {
  world: RAPIER.World;
  arenaCollider?: RAPIER.Collider;
  cameraObstacles?: (collider: RAPIER.Collider) => boolean;
}
export const cameraIgnores = (col: RAPIER.Collider) =>
  col.collisionGroups() === HOOPS_NET_GROUP ||
  col.collisionGroups() === HOOPS_RIM_GROUP;
export type CameraCollisionCategory = "ARENA_BOUNDARY" | "BLOCKING" | "IGNORE";
export function cameraCollisionCategory(
  space: CameraCollisionSpace,
  col: RAPIER.Collider,
): CameraCollisionCategory {
  if (cameraIgnores(col)) return "IGNORE";
  if (space.cameraObstacles)
    return space.cameraObstacles(col) ? "BLOCKING" : "IGNORE";
  if (col.handle === space.arenaCollider?.handle) return "ARENA_BOUNDARY";
  return col.parent() === null ? "BLOCKING" : "IGNORE";
}
const staticSurface = (col: RAPIER.Collider) =>
  col.parent() === null && !cameraIgnores(col);
const policies = new WeakMap<
  CameraCollisionSpace,
  ReturnType<typeof createPolicy>
>();
function createPolicy(space: CameraCollisionSpace) {
  return {
    // Context queries help ground heading; they never constrain a boundary boom.
    surfaces: (col: RAPIER.Collider) =>
      !cameraIgnores(col) && (space.cameraObstacles ?? staticSurface)(col),
    blockers: (col: RAPIER.Collider) =>
      cameraCollisionCategory(space, col) === "BLOCKING",
    outsideArena: !!space.arenaCollider && !space.cameraObstacles,
  };
}
export function cameraCollisionPolicy(space: CameraCollisionSpace) {
  let policy = policies.get(space);
  if (!policy) {
    policy = createPolicy(space);
    policies.set(space, policy);
  }
  return policy;
}
/** Keep the lens above the real floor, preserving orbit length rather than
 * pushing it toward the car. Walls, corners and ceiling impose no such clamp. */
export function cameraFloorClearance(
  offset: Vector3,
  pivot: Vector3,
  minY = 0.25,
) {
  const length = offset.length();
  if (pivot.y + offset.y >= minY || length < 1e-6) return;
  const y = Math.min(length * 0.99, minY - pivot.y);
  const horizontal = Math.sqrt(Math.max(0, length * length - y * y));
  const h = Math.hypot(offset.x, offset.z);
  offset.set(
    h > 1e-6 ? (offset.x / h) * horizontal : 0,
    y,
    h > 1e-6 ? (offset.z / h) * horizontal : horizontal,
  );
}
