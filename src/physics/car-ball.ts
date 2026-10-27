import { Vector3, Quaternion } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Car } from "../car/car";
import { bodies } from "../../shared/catalog";
import { P, EXTRA_HIT_CURVE, lookup } from "../config/physics";
/** Bullet's contact breaking threshold (0.02 BT ≈ 1 uu), with a little margin. */
const CONTACT_BREAKING = 0.02;

/** Car-ball contact response, after the rigid solve.
 *
 * Rapier solves the pair with RL's car-ball material (restitution 0, friction 2)
 * on a dedicated ball shell, so the rigid response already uses the true
 * contact-point velocities v + ω × r of both bodies. RL then adds an extra
 * velocity to the ball along the car→ball direction, with the vertical part
 * reduced (×0.35) and the car-forward part reduced (×0.65), scaled by a
 * relative-speed curve. That extra impulse is applied at most every other
 * tick. Here its relative speed uses the car's pre-solve contact-point
 * velocity, so rotating (flip) hits are stronger than plain drive hits while
 * a slow touch stays soft. */
export class CarBallContact {
  kind: "NONE" | "DRIBBLE" | "IMPACT" = "NONE";
  local = new Vector3();
  normal = new Vector3();
  point = new Vector3();
  linear = new Vector3();
  angular = new Vector3();
  pointVelocity = new Vector3();
  relative = new Vector3();
  /** Extra (RL) impulse applied to the ball this tick, N·s. */
  impulse = new Vector3();
  /** Retained for diagnostics; the roof-tilt dribble hack was removed. */
  roofImpulse = new Vector3();
  closing = 0;
  rotationalClosing = 0;
  /** Retained for diagnostics; flips are stronger through ω × r, not a bonus. */
  dodgeImpulse = new Vector3();
  aerial = false;
  lastImpulse = new Vector3();
  impactAge = Infinity;
  impactCount = 0;
  private position = new Vector3();
  private com = new Vector3();
  private rotation = new Quaternion();
  private ballPosition = new Vector3();
  private ballVelocity = new Vector3();
  private ballAngular = new Vector3();
  private tick = 0;
  private extraTick = -Infinity;
  private touching = false;
  private extraLocal = new Vector3();
  private resetAwarded = false;
  private direction = new Vector3();
  private forward = new Vector3();
  reset() {
    this.resetAwarded = false;
    this.kind = "NONE";
    this.extraTick = -Infinity;
    this.touching = false;
    this.impulse.set(0, 0, 0);
    this.roofImpulse.set(0, 0, 0);
    this.dodgeImpulse.set(0, 0, 0);
    this.lastImpulse.set(0, 0, 0);
    this.impactAge = Infinity;
    this.impactCount = 0;
  }
  /** Pre-solve sample; the rigid solver changes both velocities during the step. */
  sample(car: Car, ball: RAPIER.RigidBody) {
    this.tick++;
    this.position.copy(car.body.translation());
    this.com.copy(car.body.worldCom());
    this.rotation.copy(car.body.rotation());
    this.linear.copy(car.body.linvel());
    this.angular.copy(car.body.angvel());
    this.ballPosition.copy(ball.worldCom());
    this.ballVelocity.copy(ball.linvel());
    this.ballAngular.copy(ball.angvel());
    this.impulse.set(0, 0, 0);
    this.roofImpulse.set(0, 0, 0);
    this.dodgeImpulse.set(0, 0, 0);
    this.kind = "NONE";
    this.closing = 0;
    this.rotationalClosing = 0;
    this.impactAge += P.dt;
  }
  private resetSurfaceContact = true;
  /** Rapier manifold wrappers are borrowed scratch storage: never query another
   * contactPair from inside the active car-ball manifold callback. */
  sampleResetSupport(car: Car, ball: RAPIER.RigidBody) {
    this.resetSurfaceContact =
      car.grounded || car.contacts > 0 || car.chassisContacts > 0;
    if (!this.resetSurfaceContact)
      car.world.contactPairsWith(car.collider, (other) => {
        if (other.parent()?.handle === ball.handle) return;
        car.world.contactPair(car.collider, other, (m) => {
          for (let i = 0; i < m.numContacts(); i++)
            if (m.contactDist(i) < 0.004) this.resetSurfaceContact = true;
        });
      });
  }
  /** `normal` points from the car into the ball. */
  resolve(car: Car, ball: RAPIER.RigidBody, point: Vector3, normal: Vector3) {
    this.point.copy(point);
    this.normal.copy(normal);
    const inverse = this.rotation.clone().invert();
    this.local.copy(point).sub(this.position).applyQuaternion(inverse);
    // Contact arm in the pre-solve frame: v + ω × r at the touching point.
    const beforePoint = this.local
      .clone()
      .applyQuaternion(this.rotation)
      .add(this.position);
    this.pointVelocity
      .copy(this.angular)
      .cross(beforePoint.clone().sub(this.com))
      .add(this.linear);
    const ballPointVelocity = this.ballAngular
      .clone()
      .cross(beforePoint.clone().sub(this.ballPosition))
      .add(this.ballVelocity);
    this.rotationalClosing = Math.max(
      0,
      this.pointVelocity.clone().sub(this.linear).dot(normal),
    );
    this.relative.copy(this.pointVelocity).sub(ballPointVelocity);
    this.closing = Math.max(0, this.relative.dot(normal));
    this.aerial = !car.grounded;
    const d = bodies[car.bodyId];
    const localNormal = normal.clone().applyQuaternion(inverse);
    if (
      this.aerial &&
      !this.resetSurfaceContact &&
      !this.resetAwarded &&
      localNormal.y < -0.75 &&
      this.local.y < d.hitboxY - d.halfHeight + 0.07 &&
      Math.abs(this.local.x) < d.halfWidth * 0.75 &&
      Math.abs(this.local.z) < d.axle * 0.85
    ) {
      car.acquireFlipReset(point, normal);
      this.resetAwarded = true;
    }
    this.kind = this.closing >= P.hit.minClosing ? "IMPACT" : "DRIBBLE";
    // RL adds it when Bullet creates a new contact point, never on two
    // consecutive ticks. A fresh touch is new; a persisting contact only gets
    // a new point once it migrates past Bullet's breaking threshold (rolling
    // or pushed dribbles). A resting or separating contact gets nothing.
    const fresh = !this.touching,
      migrated =
        this.local.distanceTo(this.extraLocal) > CONTACT_BREAKING &&
        this.closing > 1e-3;
    this.touching = true;
    if (this.tick <= this.extraTick + 1 || !(fresh || migrated)) return;
    this.extraTick = this.tick;
    this.extraLocal.copy(this.local);
    // Relative speed of the car's touching point against the ball centre.
    const relative = this.direction
      .copy(this.ballVelocity)
      .sub(this.pointVelocity);
    const speed = Math.min(P.hit.extraMaxRelative, relative.length());
    // A resting/rolling contact's residual per-tick velocity is not a touch.
    if (speed < P.hit.extraMinRelative) return;
    const hit = this.direction.copy(this.ballPosition).sub(this.com);
    hit.y *= P.hit.extraZScale;
    if (hit.lengthSq() < 1e-10) return;
    hit.normalize();
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation);
    hit
      .addScaledVector(
        this.forward,
        -hit.dot(this.forward) * (1 - P.hit.extraForwardScale),
      )
      .normalize();
    const added = hit.multiplyScalar(speed * lookup(speed, EXTRA_HIT_CURVE));
    const v = ball.linvel();
    ball.setLinvel(
      { x: v.x + added.x, y: v.y + added.y, z: v.z + added.z },
      true,
    );
    this.impulse.copy(added).multiplyScalar(ball.mass());
    this.lastImpulse.copy(this.impulse);
    this.impactAge = 0;
    this.impactCount++;
  }
  separate(car?: Car, ball?: RAPIER.RigidBody) {
    let gap = Infinity;
    if ((this.resetAwarded || this.touching) && car && ball) {
      const p = car.collider.projectPoint(ball.translation(), false);
      if (p)
        gap =
          new Vector3().copy(p.point).distanceTo(ball.translation()) -
          car.physics.ball.radius;
    }
    if (this.resetAwarded && (!car || gap > 0.04)) this.resetAwarded = false;
    this.kind = "NONE";
    // Like Bullet's persistent manifold, a sub-threshold hop keeps the contact.
    if (gap > CONTACT_BREAKING) this.touching = false;
  }
}
