import RAPIER from "@dimforge/rapier3d-compat";
import { P } from "../config/physics";
import { arenaShell, goalShell } from "./geometry";
export function createArena(world: RAPIER.World, flat = false) {
  const a = P.arena;
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
  box(
    0,
    -0.5,
    0,
    flat ? 1000 : a.halfWidth,
    0.5,
    flat ? 1000 : a.halfLength + a.goalDepth,
  );
  if (flat) return;
  const shell = arenaShell();
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      shell.vertices,
      shell.indices,
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
    )
      .setFriction(0.3)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
  );
  box(0, a.height + 0.5, 0, a.halfWidth, 0.5, a.halfLength);
  for (const s of [-1, 1]) {
    const goal = goalShell(s);
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        goal.vertices,
        goal.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      )
        .setFriction(0.3)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
    );
  }
}
