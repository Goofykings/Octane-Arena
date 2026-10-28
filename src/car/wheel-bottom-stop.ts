import type RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { P } from "../config/physics";
import type { BodyId } from "../../shared/catalog";
import { wheelClearance, wheelMount, wheelRadius } from "./wheels";

/** Unilateral hard stop only for excessive spring bottoming. Like the chassis
 * guard, it stops approach at actual wheel points, never pulls inward or sets
 * a pose. The normal spring/damper/tire model and ray travel are unchanged. */
export class WheelBottomStop {
  readonly correction = new Vector3();
  private position = new Vector3();
  private rotation = new Quaternion();
  private up = new Vector3();
  private normal = new Vector3();
  private arm = new Vector3();
  private torque = new Vector3();
  private response = new Vector3();
  private velocity = new Vector3();
  private impulse = new Vector3();
  private constraints = Array.from({ length: 4 }, () => ({
    point: new Vector3(),
    normal: new Vector3(),
    minimum: 0,
  }));
  before(
    world: RAPIER.World,
    id: BodyId,
    collider: RAPIER.Collider,
    body: RAPIER.RigidBody,
    steer: number,
    gravity: number,
  ) {
    this.position.copy(body.translation());
    this.rotation.copy(body.rotation());
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const clearance = wheelClearance(
        world,
        this.position,
        this.rotation,
        id,
        i,
        collider,
        body,
        i < 2 ? steer : 0,
        this.normal,
        1,
      );
      if (!Number.isFinite(clearance) || this.up.dot(this.normal) < 0.6)
        continue;
      const c = this.constraints[count++];
      wheelMount(id, i, c.point)
        .applyQuaternion(this.rotation)
        .add(this.position)
        .addScaledVector(this.up, -P.suspension.minWheelLength - wheelRadius);
      c.normal.copy(this.normal);
      const gap =
        Math.max(0, -clearance - P.suspension.minWheelLength - P.suspension.bottomStopSkin) *
        this.up.dot(c.normal);
      c.minimum = -gap / P.dt + gravity * c.normal.y * P.dt;
    }
    for (let pass = 0; pass < 4; pass++)
      for (let k = 0; k < count; k++) {
        const c = this.constraints[pass % 2 ? count - 1 - k : k];
        this.arm.copy(c.point).sub(body.worldCom());
        this.velocity
          .crossVectors(body.angvel() as Vector3, this.arm)
          .add(body.linvel() as Vector3);
        const deficit = c.minimum - this.velocity.dot(c.normal);
        if (deficit <= 0) continue;
        const m = body.effectiveWorldInvInertia();
        this.torque.crossVectors(this.arm, c.normal);
        this.response.set(
          m.m11 * this.torque.x + m.m12 * this.torque.y + m.m13 * this.torque.z,
          m.m12 * this.torque.x + m.m22 * this.torque.y + m.m23 * this.torque.z,
          m.m13 * this.torque.x + m.m23 * this.torque.y + m.m33 * this.torque.z,
        );
        const effective = body.invMass() + this.torque.dot(this.response);
        if (effective > 1e-9)
          body.applyImpulseAtPoint(
            this.impulse.copy(c.normal).multiplyScalar(deficit / effective),
            c.point,
            true,
          );
      }
  }
  after(
    world: RAPIER.World,
    id: BodyId,
    collider: RAPIER.Collider,
    body: RAPIER.RigidBody,
    steer: number,
  ) {
    this.correction.set(0, 0, 0);
    this.position.copy(body.translation());
    this.rotation.copy(body.rotation());
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    let height = 0;
    for (let i = 0; i < 4; i++) {
      const clearance = wheelClearance(
        world,
        this.position,
        this.rotation,
        id,
        i,
        collider,
        body,
        i < 2 ? steer : 0,
        this.normal,
        1,
      );
      if (Number.isFinite(clearance) && this.up.dot(this.normal) >= 0.6)
        height = Math.max(
          height,
          clearance + P.suspension.minWheelLength + P.suspension.bottomStopSkin,
        );
    }
    if (height > 0) {
      this.correction
        .copy(this.up)
        .multiplyScalar(Math.min(P.car.maxContactCorrection, height));
      body.setTranslation(this.position.add(this.correction), true);
    }
  }
}
