import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { P } from "../config/physics";
import { bodies, type BodyId } from "../../shared/catalog";
import { chassisPoints } from "./chassis";
import { suspensionSurface } from "./suspension";

/** Chassis collision robustness against static geometry only.
 *
 * Rapier's discrete contacts run below its CCD threshold, and its CCD sweeps
 * linear motion only, so a fast or tumbling car can push a hull corner up to a
 * full tick of travel (~0.2 m at 23 m/s) into the arena shell before the solver
 * reacts. This guard treats the twelve hull vertices like per-vertex CCD:
 *
 * - before the step, a vertex that would cross a static surface this tick has
 *   its approach velocity limited so it arrives exactly at the surface
 *   (unilateral, normal-only, never pulls a separating body), and
 * - after the step, any residual vertex penetration is corrected positionally
 *   (bounded, no velocity change).
 *
 * It never touches wheels, tire forces or orientation targets. */
export class ChassisGuard {
  readonly correction = new Vector3();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  private q = new Quaternion();
  private position = new Vector3();
  private velocity = new Vector3();
  private angular = new Vector3();
  private com = new Vector3();
  private offset = new Vector3();
  private point = new Vector3();
  private travel = new Vector3();
  private normal = new Vector3();
  private arm = new Vector3();
  private torque = new Vector3();
  private response = new Vector3();
  private center = new Vector3();
  private direction = new Vector3();
  private constraints: { point: Vector3; normal: Vector3; minimum: number }[] =
    Array.from({ length: 12 }, () => ({
      point: new Vector3(),
      normal: new Vector3(),
      minimum: 0,
    }));

  private cast(
    world: RAPIER.World,
    origin: Vector3,
    direction: Vector3,
    length: number,
    collider: RAPIER.Collider,
    body: RAPIER.RigidBody,
  ) {
    Object.assign(this.ray.origin, origin);
    Object.assign(this.ray.dir, direction);
    return world.castRayAndGetNormal(
      this.ray,
      length,
      false,
      undefined,
      undefined,
      collider,
      body,
      suspensionSurface,
    );
  }
  /** Impulse at a hull point so its normal velocity reaches `minimum`. */
  private constrain(
    body: RAPIER.RigidBody,
    point: Vector3,
    normal: Vector3,
    minimum: number,
  ) {
    this.velocity.copy(body.linvel());
    this.angular.copy(body.angvel());
    this.com.copy(body.worldCom());
    this.arm.subVectors(point, this.com);
    const current = this.torque
      .crossVectors(this.angular, this.arm)
      .add(this.velocity)
      .dot(normal);
    const deficit = minimum - current;
    if (deficit <= 0) return;
    const m = body.effectiveWorldInvInertia();
    this.torque.crossVectors(this.arm, normal);
    this.response.set(
      m.m11 * this.torque.x + m.m12 * this.torque.y + m.m13 * this.torque.z,
      m.m12 * this.torque.x + m.m22 * this.torque.y + m.m23 * this.torque.z,
      m.m13 * this.torque.x + m.m23 * this.torque.y + m.m33 * this.torque.z,
    );
    const effective = body.invMass() + this.torque.dot(this.response);
    if (effective <= 1e-9) return;
    body.applyImpulseAtPoint(
      this.direction.copy(normal).multiplyScalar(deficit / effective),
      point,
      true,
    );
  }
  /** Pre-step speculative vertex contacts. */
  before(
    world: RAPIER.World,
    id: BodyId,
    collider: RAPIER.Collider,
    body: RAPIER.RigidBody,
    gravity: number,
  ) {
    const dt = P.dt,
      skin = P.car.contactSkin;
    this.q.copy(body.rotation());
    this.position.copy(body.translation());
    this.velocity.copy(body.linvel());
    this.angular.copy(body.angvel());
    let count = 0;
    for (const local of chassisPoints(id)) {
      this.offset.copy(local).applyQuaternion(this.q);
      this.point.copy(this.offset).add(this.position);
      this.travel
        .crossVectors(this.angular, this.offset)
        .add(this.velocity);
      this.travel.y -= gravity * dt;
      const speed = this.travel.length();
      if (speed < 0.01) continue;
      this.travel.multiplyScalar(1 / speed);
      const hit = this.cast(
        world,
        this.point,
        this.travel,
        speed * dt + skin,
        collider,
        body,
      );
      if (!hit) continue;
      this.normal.copy(hit.normal);
      const approach = -this.travel.dot(this.normal) * speed;
      if (approach <= 0) continue;
      const gap = Math.max(
        0,
        hit.timeOfImpact * (approach / speed) - skin,
      );
      const c = this.constraints[count++];
      c.point.copy(this.point);
      c.normal.copy(this.normal);
      // Arrive at the surface this tick, after the step's gravity.
      c.minimum = -gap / dt + gravity * this.normal.y * dt;
    }
    // Solve the vertex set together, alternating order so no corner is favoured.
    for (let pass = 0; pass < 4; pass++)
      for (let k = 0; k < count; k++) {
        const c = this.constraints[pass % 2 ? count - 1 - k : k];
        this.constrain(body, c.point, c.normal, c.minimum);
      }
  }
  /** Post-step positional correction of residual vertex penetration. */
  after(
    world: RAPIER.World,
    id: BodyId,
    collider: RAPIER.Collider,
    body: RAPIER.RigidBody,
  ) {
    const d = bodies[id],
      skin = P.car.contactSkin;
    this.correction.set(0, 0, 0);
    this.q.copy(body.rotation());
    this.position.copy(body.translation());
    this.center.set(0, d.hitboxY, 0).applyQuaternion(this.q).add(this.position);
    for (const local of chassisPoints(id)) {
      this.point.copy(local).applyQuaternion(this.q).add(this.position);
      this.direction.subVectors(this.point, this.center);
      const length = this.direction.length();
      if (length < 1e-6) continue;
      this.direction.multiplyScalar(1 / length);
      const hit = this.cast(
        world,
        this.center,
        this.direction,
        length + skin,
        collider,
        body,
      );
      if (!hit) continue;
      this.normal.copy(hit.normal);
      const alignment = -this.normal.dot(this.direction);
      if (alignment < 0.01) continue;
      const depth =
        (length - hit.timeOfImpact) * alignment +
        skin -
        this.correction.dot(this.normal);
      if (depth > 0) this.correction.addScaledVector(this.normal, depth);
    }
    if (this.correction.lengthSq() === 0) return;
    this.correction.clampLength(0, P.car.maxContactCorrection);
    body.setTranslation(this.position.add(this.correction), true);
  }
}
