import * as T from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Simulation } from "../physics/simulation";
import { P } from "../config/physics";

export function innerHeightRatio(height: number, range: number) {
  const t = T.MathUtils.clamp(height / Math.max(0.01, range), 0, 1);
  const readable = (Math.exp(-3 * t) - Math.exp(-3)) / (1 - Math.exp(-3));
  return 0.09 + 0.81 * readable;
}
export class BallHeightIndicator {
  readonly group = new T.Group();
  // A dark keyline keeps the existing height rings readable on pale sand too.
  readonly outline = new T.Mesh(
    new T.RingGeometry(0.92, 1.105, 48),
    new T.MeshBasicMaterial({
      color: 0x172d37,
      transparent: true,
      opacity: 0.65,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  readonly outer = new T.Mesh(
    new T.RingGeometry(0.95, 1.07, 48),
    new T.MeshBasicMaterial({
      color: 0xc2f9ec,
      transparent: true,
      opacity: 0.4,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  readonly inner = new T.Mesh(
    new T.RingGeometry(0.94, 1, 48),
    new T.MeshBasicMaterial({
      color: 0xc2f9ec,
      transparent: true,
      opacity: 0.32,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  height = 0;
  constructor(scene: T.Scene) {
    this.outline.position.z = -0.002;
    this.group.add(this.outline, this.outer, this.inner);
    scene.add(this.group);
  }
  update(ball: T.Object3D, simulation: Simulation) {
    this.group.visible = ball.visible;
    if (!ball.visible) return;
    const p = ball.position;
    const hit = simulation.world.castRayAndGetNormal(
      new RAPIER.Ray(p, { x: 0, y: -1, z: 0 }),
      P.arena.height + P.ball.radius,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (col) =>
        simulation.arenaCollider
          ? col === simulation.arenaCollider
          : col.parent() === null,
    );
    const floor = hit ? p.y - hit.timeOfImpact : 0;
    this.height = Math.max(0, p.y - floor - P.ball.radius);
    const ceiling =
      Math.abs(p.z) > P.arena.halfLength && Math.abs(p.x) < P.arena.goalHalf
        ? P.arena.goalHeight
        : P.arena.height;
    const outerRadius = 1 + p.y * 0.03;
    this.group.position.set(p.x, floor + 0.03, p.z);
    this.group.quaternion.setFromUnitVectors(
      new T.Vector3(0, 0, 1),
      hit ? new T.Vector3().copy(hit.normal) : new T.Vector3(0, 1, 0),
    );
    this.outer.scale.setScalar(outerRadius);
    this.outline.scale.setScalar(outerRadius);
    this.inner.scale.setScalar(
      outerRadius *
        innerHeightRatio(this.height, ceiling - floor - 2 * P.ball.radius),
    );
  }
}
