import * as T from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Simulation } from "../physics/simulation";
import { defaults, type CameraSettings } from "../game/settings";
import { P } from "../config/physics";
const angleDelta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
export class GameCamera {
  settings: CameraSettings = defaults().camera;
  ballMode = true;
  private heading = 0;
  private orbit = 0;
  private yaw = 0;
  private pitch = 0;
  private ready = false;
  private aim = new T.Vector3();
  private wallTangent = new T.Vector3();
  private wallBlend = 0;
  private wallClearTime = 0;
  private previousCar = new T.Vector3();
  private modeBlend = 1;
  constructor(public camera: T.PerspectiveCamera) {}
  get baseFov() {
    return this.settings.fov;
  }
  set baseFov(v: number) {
    this.settings.fov = v;
  }
  reset() {
    this.ready = false;
    this.wallTangent.set(0, 0, 0);
    this.wallBlend = 0;
    this.wallClearTime = 0;
  }
  update(
    car: T.Object3D,
    ball: T.Object3D,
    s: Simulation,
    dt: number,
    home: boolean,
    time: number,
    goalFocus?: { x: number; y: number; z: number } | null,
  ) {
    const c = this.camera,
      p = this.settings;
    if (home) {
      c.position.set(9 + Math.sin(time * 0.06) * 1.5, 2.7, 19);
      c.up.set(0, 1, 0);
      c.lookAt(5, 0.6, 10);
      c.fov = p.fov;
      c.updateProjectionMatrix();
      this.reset();
      return;
    }
    // Follow car translation directly; smooth the relative orbit. Otherwise a
    // bounded zoom rate can leave the camera behind a fast-moving vehicle.
    if (this.ready) c.position.add(car.position.clone().sub(this.previousCar));
    this.previousCar.copy(car.position);
    const velocity = new T.Vector3().copy(s.cars[0].body.linvel()),
      speed = velocity.length();
    const nose = new T.Vector3(0, 0, -1).applyQuaternion(car.quaternion);
    // Airborne heading follows travel, not the flipping/rolling body. At low speed retain the last heading.
    const guide = s.cars[0].grounded
      ? nose.clone().setY(0)
      : velocity.clone().setY(0);
    const reliable = guide.lengthSq() > (s.cars[0].grounded ? 0.08 : 4);
    if (!this.ready) {
      this.heading = Math.atan2(-nose.x, -nose.z);
      this.orbit = this.heading;
    }
    if (reliable) {
      const goal = Math.atan2(-guide.x, -guide.z);
      this.heading +=
        angleDelta(this.heading, goal) *
        (1 - Math.exp(-dt * (s.cars[0].grounded ? 12 : 5)));
    }
    const subject = goalFocus ? new T.Vector3().copy(goalFocus) : ball.position;
    const tracking = this.ballMode && (s.ball.isEnabled() || !!goalFocus);
    this.modeBlend = this.ready
      ? T.MathUtils.lerp(
          this.modeBlend,
          tracking ? 1 : 0,
          1 - Math.exp(-dt * p.transition * 5),
        )
      : tracking
        ? 1
        : 0;
    const toBall = subject.clone().sub(car.position).setY(0);
    // Horizontal bearing is undefined near/above the car. Keep the last orbit
    // there, and gradually resume tracking as the ball moves away.
    const bearingWeight = T.MathUtils.smoothstep(toBall.length(), 1.2, 3);
    const ballHeading =
      this.orbit +
      angleDelta(this.orbit, Math.atan2(-toBall.x, -toBall.z)) * bearingWeight;
    const goal =
      this.heading + angleDelta(this.heading, ballHeading) * this.modeBlend;
    const turn =
      angleDelta(this.orbit, goal) * (1 - Math.exp(-dt * p.transition * 10));
    this.orbit += T.MathUtils.clamp(turn, -p.swivel * dt, p.swivel * dt);
    const dir = new T.Vector3(-Math.sin(this.orbit), 0, -Math.cos(this.orbit));
    const overhead =
      T.MathUtils.smoothstep(Math.abs(subject.y - car.position.y), 4, 18) *
      (1 - T.MathUtils.smoothstep(toBall.length(), 2, 14)) *
      this.modeBlend;
    const framingDistance =
      p.distance + overhead * Math.min(5, p.distance * 0.8 + 1);
    const desired = car.position
      .clone()
      .addScaledVector(dir, -(framingDistance + speed * 0.045))
      .add(new T.Vector3(0, p.height, 0));
    const ray = desired.clone().sub(car.position),
      length = ray.length();
    ray.normalize();
    const hit = s.world.castRayAndGetNormal(
      new RAPIER.Ray(car.position, ray),
      length + 2,
      true,
      undefined,
      undefined,
      s.cars[0].collider,
      s.cars[0].body,
      (col) => col.parent() === null,
    );
    let wallAdjusted = false;
    let avoidance = 0;
    if (hit) {
      // Begin avoidance before the desired camera reaches the wall.
      avoidance = 1 - T.MathUtils.smoothstep(hit.timeOfImpact - length, 0, 2);
      // A wall behind the desired orbit should move the camera into the arena,
      // rather than collapse the orbit onto the car's roof.
      const normal = new T.Vector3().copy(hit.normal);
      const offset = desired.clone().sub(car.position);
      wallAdjusted = Math.abs(normal.y) < 0.9;
      offset.addScaledVector(
        normal,
        Math.max(
          0,
          (wallAdjusted ? 1.4 : Math.min(p.distance, 3.5)) - offset.dot(normal),
        ),
      );
      if (wallAdjusted) {
        const tangent = new T.Vector3()
          .crossVectors(normal, new T.Vector3(0, 1, 0))
          .normalize();
        // Keep the chosen side through vertical headings and adjacent wall facets.
        // Body pitch must not reverse the camera's collision escape direction.
        if (this.wallTangent.lengthSq() > 0.5) {
          if (tangent.dot(this.wallTangent) < 0) tangent.negate();
        } else {
          const previousOffset = c.position.clone().sub(car.position);
          const side = this.ready
            ? tangent.dot(previousOffset)
            : -tangent.dot(dir);
          if (side < -0.01) tangent.negate();
        }
        this.wallTangent.copy(tangent);
        // Offset along the wall as well as inward, keeping the car in front of the lens.
        const along = offset.dot(tangent),
          minimum = Math.max(3, p.distance * 0.85);
        if (along < minimum) offset.addScaledVector(tangent, minimum - along);
      }
      const alternatives = [
        offset,
        offset.clone().add(new T.Vector3(0, -p.height * 0.75, 0)),
      ];
      let best = car.position
        .clone()
        .addScaledVector(ray, Math.max(0.4, hit.timeOfImpact - 0.3));
      let clearance = best.distanceTo(car.position);
      for (const candidate of alternatives) {
        const distance = candidate.length();
        candidate.normalize();
        const obstruction = s.world.castRay(
          new RAPIER.Ray(car.position, candidate),
          distance,
          true,
          undefined,
          undefined,
          s.cars[0].collider,
          s.cars[0].body,
          (col) => col.parent() === null,
        );
        const available = obstruction
          ? Math.max(0.4, obstruction.timeOfImpact - 0.3)
          : distance;
        if (available > clearance) {
          clearance = available;
          best = car.position.clone().addScaledVector(candidate, available);
        }
      }
      desired.lerp(best, avoidance);
    }
    desired.y = Math.max(0.3, desired.y);
    const target = car.position
      .clone()
      .addScaledVector(dir, 3)
      .add(
        new T.Vector3(
          0,
          p.height + Math.tan((p.angle * Math.PI) / 180) * (p.distance + 3),
          0,
        ),
      );
    this.wallClearTime = wallAdjusted ? 0 : this.wallClearTime + dt;
    if (this.wallClearTime > 0.3) this.wallTangent.set(0, 0, 0);
    this.wallBlend = this.ready
      ? T.MathUtils.lerp(
          this.wallBlend,
          wallAdjusted ? avoidance : 0,
          1 - Math.exp(-dt * 8),
        )
      : wallAdjusted
        ? avoidance
        : 0;
    target.lerp(
      car.position
        .clone()
        .addScaledVector(dir, 1.5)
        .add(new T.Vector3(0, 0.2, 0)),
      (1 - this.modeBlend) * this.wallBlend,
    );
    if (!this.ready) {
      c.position.copy(desired);
      this.aim.copy(target);
    } else {
      // Interpolate around the car, not through it. Linear position interpolation
      // crossed the body and triggered a hard 2.2 m snap when wall avoidance changed.
      const offset = c.position.clone().sub(car.position);
      const destination = desired.clone().sub(car.position);
      const radius = offset.length(),
        destinationRadius = destination.length();
      const blend = 1 - Math.exp(-dt * (6 + 18 * p.stiffness));
      if (radius > 0.001 && destinationRadius > 0.001) {
        offset.normalize();
        destination.normalize();
        const angle = offset.angleTo(destination);
        const rotation = new T.Quaternion().setFromUnitVectors(
          offset,
          destination,
        );
        const orbitRate = T.MathUtils.lerp(
          p.swivel,
          Math.min(p.swivel, 2),
          Math.max(this.wallBlend, avoidance),
        );
        const fraction =
          angle > 0.00001 ? Math.min(blend, (orbitRate * dt) / angle) : blend;
        offset.applyQuaternion(new T.Quaternion().slerp(rotation, fraction));
        const nextRadius =
          radius +
          T.MathUtils.clamp(
            (destinationRadius - radius) * blend,
            -6 * dt,
            6 * dt,
          );
        c.position.copy(car.position).addScaledVector(offset, nextRadius);
      } else c.position.lerp(desired, blend);
      this.aim.lerp(target, 1 - Math.exp(-dt * 22));
    }
    // The smoothed route also needs clearance; two safe endpoints can arc through a wall.
    const actualOffset = c.position.clone().sub(car.position),
      actualDistance = actualOffset.length();
    if (actualDistance > 0.001) {
      actualOffset.normalize();
      const obstruction = s.world.castRayAndGetNormal(
        new RAPIER.Ray(car.position, actualOffset),
        actualDistance + 20,
        true,
        undefined,
        undefined,
        s.cars[0].collider,
        s.cars[0].body,
        (col) => col.parent() === null,
      );
      if (obstruction) {
        const normal = new T.Vector3().copy(obstruction.normal);
        const point = car.position
          .clone()
          .addScaledVector(actualOffset, obstruction.timeOfImpact);
        // Push away along the wall normal. Pulling back along a grazing ray turns
        // tiny wall penetrations into large zoom jumps on curved transitions.
        c.position.addScaledVector(
          normal,
          Math.max(0, 0.35 - c.position.clone().sub(point).dot(normal)),
        );
      }
    }
    // Frame two angular subjects, rather than aiming at a fixed fraction of
    // their world-space separation. That fraction hid high balls and wall play.
    const carSubject = car.position.clone().add(new T.Vector3(0, 0.12, 0));
    const carRay = carSubject.clone().sub(c.position).normalize();
    const ballRay = subject.clone().sub(c.position).normalize();
    const ballLook = carRay.clone().add(ballRay).normalize();
    const look = this.aim
      .clone()
      .sub(c.position)
      .normalize()
      .lerp(ballLook, this.modeBlend)
      .normalize();
    const targetYaw = Math.atan2(-look.x, -look.z),
      targetPitch =
        Math.asin(T.MathUtils.clamp(look.y, -0.98, 0.98)) +
        this.modeBlend * T.MathUtils.degToRad(p.angle) * 0.15;
    if (!this.ready) {
      this.yaw = targetYaw;
      this.pitch = targetPitch;
      this.ready = true;
    }
    this.yaw += angleDelta(this.yaw, targetYaw) * (1 - Math.exp(-dt * 20));
    this.pitch = T.MathUtils.lerp(
      this.pitch,
      targetPitch,
      1 - Math.exp(-dt * 20),
    );
    // Explicit zero roll avoids quaternion interpolation introducing a tilted horizon.
    c.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    // Expand framing only when the two subjects need it, including their radii.
    // The horizon is still world-up, independent of car roll on walls/ceilings.
    let framingFov = p.fov + Math.min(9, speed * 0.35);
    if (this.modeBlend > 0.01) {
      const inverse = c.quaternion.clone().invert();
      for (const [point, radius] of [
        [carSubject, 0.85],
        [subject, P.ball.radius],
      ] as const) {
        const local = point.clone().sub(c.position).applyQuaternion(inverse);
        const depth = Math.max(0.1, -local.z);
        const extent = Math.max(
          Math.abs(local.y) + radius,
          (Math.abs(local.x) + radius) / c.aspect,
        );
        const required =
          T.MathUtils.radToDeg(2 * Math.atan2(extent, depth)) + 8;
        framingFov = Math.max(
          framingFov,
          T.MathUtils.lerp(p.fov, required, this.modeBlend),
        );
      }
    }
    c.fov = T.MathUtils.lerp(
      c.fov,
      Math.min(120, framingFov),
      1 - Math.exp(-dt * 8),
    );
    c.updateProjectionMatrix();
  }
}
