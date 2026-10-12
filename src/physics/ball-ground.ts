import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion } from "three";
/** One physical ground signal. Only the arena shell/floor participates: posts,
 * cars and unrelated colliders cannot end zero-second play. */
export class BallGroundContact {
  grounded = false;
  started = false;
  sequence = 0;
  private triangles: number[][] = [];
  constructor(
    private world: RAPIER.World,
    private ball: RAPIER.Collider,
    private surface: RAPIER.Collider,
  ) {
    const shape = surface.shape;
    if (shape instanceof RAPIER.TriMesh) {
      const v = shape.vertices,
        ids = shape.indices;
      for (let i = 0; i < ids.length; i += 3) {
        const a = ids[i] * 3,
          b = ids[i + 1] * 3,
          c = ids[i + 2] * 3;
        if (Math.abs(v[a + 1]) + Math.abs(v[b + 1]) + Math.abs(v[c + 1]) < 1e-5)
          this.triangles.push([v[a], v[a + 2], v[b], v[b + 2], v[c], v[c + 2]]);
      }
    }
  }
  reset() {
    this.grounded = false;
    this.started = false;
  }
  private floorPoint(x: number, z: number) {
    if (!this.triangles.length) return true; // The flat calibration floor is a cuboid.
    for (const [ax, az, bx, bz, cx, cz] of this.triangles) {
      const a = (bx - ax) * (z - az) - (bz - az) * (x - ax),
        b = (cx - bx) * (z - bz) - (cz - bz) * (x - bx),
        c = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
      if (
        (a >= -1e-5 && b >= -1e-5 && c >= -1e-5) ||
        (a <= 1e-5 && b <= 1e-5 && c <= 1e-5)
      )
        return true;
    }
    return false;
  }
  update() {
    let touching = false;
    if (this.ball.parent()?.isEnabled())
      this.world.contactPair(this.ball, this.surface, (m, flipped) => {
        if (Math.abs(m.normal().y) < 0.995) return;
        // Use the point on the arena, not the solver midpoint between surfaces:
        // that midpoint can be below the floor during a valid fast impact.
        for (let i = 0; i < m.numContacts(); i++) {
          const local = flipped
            ? m.localContactPoint1(i)
            : m.localContactPoint2(i);
          if (!local) continue;
          const p = new Vector3()
            .copy(local)
            .applyQuaternion(new Quaternion().copy(this.surface.rotation()))
            .add(this.surface.translation());
          if (
            m.contactDist(i) <= 0.002 &&
            Math.abs(p.y) <= 0.004 &&
            this.floorPoint(p.x, p.z)
          ) {
            touching = true;
            break;
          }
        }
      });
    this.started = touching && !this.grounded;
    this.grounded = touching;
    if (this.started) this.sequence++;
  }
}
