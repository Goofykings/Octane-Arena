import { Vector3, Quaternion } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Car } from "../car/car";
import { bodies } from "../../shared/catalog";
import { P, lookup } from "../config/physics";

export class CarBallContact {
  kind: "NONE" | "DRIBBLE" | "IMPACT" = "NONE";
  local = new Vector3();
  normal = new Vector3();
  point = new Vector3();
  linear = new Vector3();
  angular = new Vector3();
  pointVelocity = new Vector3();
  relative = new Vector3();
  impulse = new Vector3();
  roofImpulse = new Vector3();
  closing = 0;
  lastImpulse = new Vector3();
  impactAge = Infinity;
  impactCount = 0;
  private position = new Vector3();
  private com = new Vector3();
  private rotation = new Quaternion();
  private ballPosition = new Vector3();
  private ballVelocity = new Vector3();
  private ballAngular = new Vector3();
  private armed = true;
  private quietTicks = 0;
  private cooldown = 0;
  reset() {
    this.kind = "NONE";
    this.armed = true;
    this.quietTicks = 0;
    this.cooldown = 0;
    this.impulse.set(0, 0, 0);
    this.roofImpulse.set(0, 0, 0);
    this.lastImpulse.set(0, 0, 0);
    this.impactAge = Infinity;
    this.impactCount = 0;
  }
  sample(car: Car, ball: RAPIER.RigidBody) {
    this.position.copy(car.body.translation());
    this.com.copy(car.body.worldCom());
    this.rotation.copy(car.body.rotation());
    this.linear.copy(car.body.linvel());
    this.angular.copy(car.body.angvel());
    this.ballPosition.copy(ball.translation());
    this.ballVelocity.copy(ball.linvel());
    this.ballAngular.copy(ball.angvel());
    this.cooldown = Math.max(0, this.cooldown - P.dt);
    this.impulse.set(0, 0, 0);
    this.roofImpulse.set(0, 0, 0);
    this.kind = "NONE";
    this.closing = 0;
    this.impactAge += P.dt;
  }
  resolve(car: Car, ball: RAPIER.RigidBody, point: Vector3, normal: Vector3) {
    this.point.copy(point);
    this.normal.copy(normal);
    this.local
      .copy(point)
      .sub(car.body.translation())
      .applyQuaternion(new Quaternion().copy(car.body.rotation()).invert());
    // Reconstruct the contact arm in the pre-solver frame. Solver impulses have
    // already reduced relative velocity; sampling them afterwards weakens flicks.
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
    this.relative.copy(this.pointVelocity).sub(ballPointVelocity);
    this.closing = Math.max(0, this.relative.dot(normal));
    const d = bodies[car.bodyId],
      up = new Vector3(0, 1, 0).applyQuaternion(car.body.rotation());
    const roof =
      normal.dot(up) > 0.7 && this.local.y > d.hitboxY + d.halfHeight - 0.06;
    this.kind = this.closing >= P.hit.minClosing ? "IMPACT" : "DRIBBLE";
    if (this.closing < P.hit.rearmClosing) {
      if (++this.quietTicks >= 2) this.armed = true;
    } else this.quietTicks = 0;
    if (this.kind === "IMPACT" && this.armed && this.cooldown === 0) {
      // RocketSim-inspired speed curve, scaled by true normal approach so a
      // grazing/sliding contact cannot launch the ball using tangential speed.
      const speed = Math.min(P.hit.maxRelative, this.relative.length());
      const gain = lookup(speed, [
        [0, 0.65],
        [5, 0.65],
        [23, 0.55],
        [46, 0.3],
      ]);
      const approach = Math.min(1, this.closing / Math.max(speed, 0.001));
      const onset = Math.min(
        1,
        (this.closing - P.hit.minClosing) / P.hit.impactRamp,
      );
      const direction = normal.clone();
      // Preserve roof lift for flicks; only front/side shots receive the modest
      // world-up reduction used by the behavioural reference.
      if (!roof) direction.y *= P.hit.verticalScale;
      const forward = new Vector3(0, 0, -1).applyQuaternion(
        car.body.rotation(),
      );
      direction
        .addScaledVector(
          forward,
          -direction.dot(forward) * (1 - P.hit.forwardScale),
        )
        .normalize();
      this.impulse
        .copy(direction)
        .multiplyScalar(speed * gain * approach * onset * P.ball.mass);
      ball.applyImpulseAtPoint(this.impulse, point, true);
      this.lastImpulse.copy(this.impulse);
      this.impactAge = 0;
      this.impactCount++;
      this.armed = false;
      this.cooldown = P.hit.cooldown;
    }
    if (roof && this.kind === "DRIBBLE" && up.y > 0.65) {
      // A small outward tilt of the support reaction, without changing the box.
      // Cubic offset is flat near centre and smoothly grows toward each edge.
      const x = Math.max(-1, Math.min(1, this.local.x / d.halfWidth));
      const z = Math.max(-1, Math.min(1, this.local.z / d.halfLength));
      const tilt = new Vector3(x * x * x, 0, z * z * z).multiplyScalar(
        P.hit.roofTilt,
      );
      tilt.applyQuaternion(car.body.rotation());
      const support = P.gravity * Math.max(0, up.y) * P.ball.mass * P.dt;
      this.roofImpulse.copy(tilt).multiplyScalar(support);
      // Tangential support shaping produces real rolling torque; no upward
      // spring or pose lock, and no extra impact impulse during a resting dribble.
      ball.applyImpulseAtPoint(this.roofImpulse, point, true);
      car.body.applyImpulseAtPoint(
        this.roofImpulse.clone().negate(),
        point,
        true,
      );
    }
  }
  separate() {
    if (++this.quietTicks >= 2) this.armed = true;
    this.kind = "NONE";
  }
}
