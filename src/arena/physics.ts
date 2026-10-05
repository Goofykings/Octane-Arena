import RAPIER from "@dimforge/rapier3d-compat";
import { P } from "../config/physics";
import { collisionShell } from "./shell";
import { goalFrame } from "./posts";
export function createArena(world: RAPIER.World, flat = false) {
  const box = (
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
  ) =>
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setFriction(0.3)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
    );
  if (flat) {
    box(0, -0.5, 0, 1000, 0.5, 1000);
    return;
  }
  const shell = collisionShell();
  const collider = world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      shell.vertices,
      shell.indices,
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.ORIENTED,
    )
      .setFriction(0.3)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
  );
  for (const s of [-1, 1])
    for (const part of goalFrame(s)) {
      world.createCollider(
        (part.kind === "bar"
          ? RAPIER.ColliderDesc.roundCuboid(
              part.size[0] / 2 - part.bevel,
              part.size[1] / 2 - part.bevel,
              part.size[2] / 2 - part.bevel,
              part.bevel,
            )
          : RAPIER.ColliderDesc.capsule(part.length / 2, part.radius)
        )
          .setTranslation(...part.position)
          .setRotation(part.rotation)
          .setFriction(0.3)
          .setRestitution(0)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
      );
    }
  return collider;
}

/** The arena cavity is an X-monotone volume, including both goals. Interior
 * points have a shell crossing in each horizontal direction. This uses the
 * actual closed shell, not oversized boxes covering a broken seam. */
export function insideArena(
  shell: RAPIER.Collider,
  p: RAPIER.Vector,
  tolerance = 0.08,
) {
  if (![p.x, p.y, p.z].every(Number.isFinite)) return false;
  const limit = P.arena.halfWidth * 3;
  if (
    [-1, 1].every(
      (x) =>
        shell.castRay(new RAPIER.Ray(p, { x, y: 0, z: 0 }), limit, false) >= 0,
    )
  )
    return true;
  const near = shell.projectPoint(p, false);
  return (
    !!near &&
    Math.hypot(p.x - near.point.x, p.y - near.point.y, p.z - near.point.z) <
      tolerance
  );
}
