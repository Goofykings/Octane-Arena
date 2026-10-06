import * as T from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { defaults, type CameraSettings } from "../game/settings";
import { P } from "../config/physics";
import { CameraClearance } from "./collision";
import { CameraFraming, MAX_FRAMING_FOV } from "./framing";
import type { MouseLook } from "./mouse-look";

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const delta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
const worldUp = new T.Vector3(0, 1, 0);
/** Camera queries work in both closed arenas and open extra-mode worlds. */
export interface CameraWorld {
  world: RAPIER.World;
  ball?: { isEnabled(): boolean };
  cameraObstacles?: (collider: RAPIER.Collider) => boolean;
}

/** One gameplay rig, shared by local and snapshot-rendered network matches.
 * All spatial inputs are render poses; physics supplies only arena queries and
 * whether the ball is enabled. Body rotation never defines the camera's up. */
export class GameCamera {
  mouseLook?: MouseLook;
  settings: CameraSettings = defaults().camera;
  ballMode = true;
  readonly referenceUp = new T.Vector3(0, 1, 0);
  readonly pivot = new T.Vector3();
  readonly desiredPosition = new T.Vector3();
  readonly lookDirection = new T.Vector3(0, 0, -1);
  readonly framing = new CameraFraming();
  readonly clearance = new CameraClearance();
  readonly debug = {
    mode: "Ball Cam",
    fovAdjustment: 0,
    singularity: false,
    safe: true,
  };
  private ready = false;
  private heading = 0;
  private orbit = 0;
  private turnSign = 1;
  private yaw = 0;
  private pitch = 0;
  private modeBlend = 1;
  private zoom = 0;
  private previousCar = new T.Vector3();
  private velocity = new T.Vector3();
  private nose = new T.Vector3();
  private renderUp = new T.Vector3();
  private subject = new T.Vector3();
  private previousSubject = new T.Vector3();
  private subjectVelocity = new T.Vector3();
  private anticipatedSubject = new T.Vector3();
  private carSubject = new T.Vector3();
  private carTarget = new T.Vector3();
  private offset = new T.Vector3();
  private framingOffset = new T.Vector3();
  private framingPosition = new T.Vector3();
  private smoothedOffset = new T.Vector3();
  private forward = new T.Vector3();
  private ballLook = new T.Vector3();
  private carLook = new T.Vector3();
  private targetLook = new T.Vector3();
  private right = new T.Vector3(1, 0, 0);
  private basisUp = new T.Vector3(0, 1, 0);
  private back = new T.Vector3();
  private basis = new T.Matrix4();
  private desiredRotation = new T.Quaternion();
  private orbitRotation = new T.Quaternion();
  private identity = new T.Quaternion();
  private targetYaw = 0;
  private targetPitch = 0;
  private constraintEuler = new T.Euler(0, 0, 0, "YXZ");

  constructor(public camera: T.PerspectiveCamera) {}
  get baseFov() {
    return this.settings.fov;
  }
  set baseFov(value: number) {
    this.settings.fov = value;
  }
  reset() {
    this.ready = false;
    this.zoom = 0;
    this.clearance.reset();
  }

  private continuousAngle(from: number, to: number) {
    const difference = delta(from, to);
    // At the antipode tiny bearing noise must not change the chosen path.
    if (Math.abs(difference) > Math.PI - 0.12)
      return this.turnSign * Math.abs(difference);
    if (Math.abs(difference) > 0.1) this.turnSign = Math.sign(difference);
    return difference;
  }

  /** Explicit horizon basis. Keep the previous right at the polar singularity;
   * yaw continuity is retained and pitch stays inside the readable hemisphere. */
  private orientation(
    look: T.Vector3,
    result: T.Quaternion,
    yawFallback: number,
  ) {
    const horizontal = Math.hypot(look.x, look.z);
    this.debug.singularity = horizontal < 0.03;
    const yaw =
      yawFallback +
      delta(yawFallback, Math.atan2(-look.x, -look.z)) *
        T.MathUtils.smoothstep(horizontal, 0.03, 0.15);
    const pitch = T.MathUtils.clamp(
      Math.atan2(look.y, horizontal),
      -1.48,
      1.48,
    );
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.back.set(
      Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );
    this.basisUp.crossVectors(this.back, this.right).normalize();
    this.basis.makeBasis(this.right, this.basisUp, this.back);
    result.setFromRotationMatrix(this.basis);
    this.targetYaw = yaw;
    this.targetPitch = pitch;
  }

  update(
    car: T.Object3D,
    ball: T.Object3D | null,
    simulation: CameraWorld,
    dt: number,
    home: boolean,
    time: number,
    goalFocus?: { x: number; y: number; z: number } | null,
  ) {
    const c = this.camera,
      p = this.settings;
    dt = T.MathUtils.clamp(dt, 0, 0.1);
    if (home) {
      c.position.set(9 + Math.sin(time * 0.06) * 1.5, 2.7, 19);
      this.targetLook.set(5, 0.6, 10).sub(c.position).normalize();
      this.orientation(this.targetLook, c.quaternion, this.yaw);
      c.fov = p.fov;
      c.updateProjectionMatrix();
      this.reset();
      return;
    }
    const first = !this.ready;
    this.pivot.copy(car.position);
    this.velocity
      .copy(car.position)
      .sub(this.previousCar)
      .divideScalar(Math.max(dt, 1e-6));
    if (first) this.velocity.set(0, 0, 0);
    this.previousCar.copy(car.position);
    const speed = Math.min(60, this.velocity.length());
    this.clearance.survey(
      simulation.world,
      this.pivot,
      p.distance + 4,
      dt,
      first,
      simulation.cameraObstacles,
    );
    // Surface orientation guides the boom, while arena gravity owns the horizon.
    // This deliberately does not read individual wheel normals or physics poses.
    this.referenceUp.copy(worldUp);
    this.nose.set(0, 0, -1).applyQuaternion(car.quaternion);
    if (first) this.heading = Math.atan2(-this.nose.x, -this.nose.z);
    this.renderUp.copy(worldUp).applyQuaternion(car.quaternion);
    const groundWeight =
      T.MathUtils.smoothstep(this.clearance.surfaceUp.y, 0.85, 0.98) *
      (1 - T.MathUtils.smoothstep(this.clearance.nearestSurface, 0.7, 1.4)) *
      T.MathUtils.smoothstep(
        this.renderUp.dot(this.clearance.surfaceUp),
        0.7,
        0.95,
      );
    this.forward.copy(this.nose).setY(0);
    if (this.forward.lengthSq() > 0.15)
      this.heading +=
        delta(this.heading, Math.atan2(-this.forward.x, -this.forward.z)) *
        damp(12, dt) *
        groundWeight;
    this.forward.copy(this.velocity).setY(0);
    if (this.forward.lengthSq() > 4)
      this.heading +=
        delta(this.heading, Math.atan2(-this.forward.x, -this.forward.z)) *
        damp(5, dt) *
        (1 - groundWeight);
    this.subject.copy(goalFocus ?? ball?.position ?? car.position);
    this.subjectVelocity
      .copy(this.subject)
      .sub(this.previousSubject)
      .divideScalar(Math.max(dt, 1e-6))
      .clampLength(0, 60);
    if (first || goalFocus) this.subjectVelocity.set(0, 0, 0);
    this.previousSubject.copy(this.subject);
    this.anticipatedSubject
      .copy(this.subject)
      .addScaledVector(this.subjectVelocity, 0.28);
    this.carSubject.copy(car.position);
    const tracking =
      this.ballMode && (!!simulation.ball?.isEnabled() || !!goalFocus);
    this.modeBlend = first
      ? Number(tracking)
      : T.MathUtils.lerp(
          this.modeBlend,
          Number(tracking),
          damp(p.transition * 5, dt),
        );
    this.forward.copy(this.subject).sub(this.pivot).setY(0);
    const bearingWeight = T.MathUtils.smoothstep(this.forward.length(), 1.2, 3);
    if (first)
      this.orbit =
        tracking && bearingWeight > 0.99
          ? Math.atan2(-this.forward.x, -this.forward.z)
          : this.heading;
    const targetTurn =
      delta(this.orbit, this.heading) * (1 - this.modeBlend) +
      this.continuousAngle(
        this.orbit,
        Math.atan2(-this.forward.x, -this.forward.z),
      ) *
        bearingWeight *
        this.modeBlend;
    this.orbit += T.MathUtils.clamp(
      targetTurn * damp(p.transition * 10, dt),
      -p.swivel * dt,
      p.swivel * dt,
    );
    this.forward.set(-Math.sin(this.orbit), 0, -Math.cos(this.orbit));

    // Solve desired framing on the ideal boom. Extra distance is driven by
    // subject projection, not a separate overhead/wall camera mode.
    let requiredZoom = 0;
    const zoomLimit = p.distance * Math.max(1, 1 / (c.aspect * c.aspect));
    // Preserve horizontal room in portrait viewports; distance remains the
    // user's base boom length, scaled by the projection's narrower aperture.
    const baseDistance =
      (p.distance + speed * 0.025) * Math.max(1, 1 / Math.sqrt(c.aspect));
    for (let i = 0; i < 5; i++) {
      this.offset
        .copy(this.forward)
        .multiplyScalar(-(baseDistance + requiredZoom))
        .addScaledVector(worldUp, p.height);
      this.clearance.plan(
        this.offset,
        baseDistance + requiredZoom,
        this.smoothedOffset,
      );
      this.desiredPosition.copy(this.pivot).add(this.offset);
      this.framing.aim(
        this.desiredPosition,
        this.carSubject,
        this.subject,
        this.ballLook,
      );
      this.orientation(this.ballLook, this.desiredRotation, this.yaw);
      let need = this.framing.evaluate(
        this.desiredPosition,
        this.desiredRotation,
        this.carSubject,
        this.subject,
        goalFocus ? 0.2 : P.ball.radius,
        c.aspect,
        p.fov,
      );
      if (!first && tracking) {
        // Framing must also account for the current orbit while it catches a
        // fast bearing change; a perfectly framed future orbit is insufficient.
        this.framingOffset
          .copy(this.smoothedOffset)
          .normalize()
          .multiplyScalar(Math.hypot(baseDistance + requiredZoom, p.height));
        this.clearance.plan(
          this.framingOffset,
          baseDistance + requiredZoom,
          this.smoothedOffset,
        );
        this.framingPosition.copy(this.pivot).add(this.framingOffset);
        this.framing.aim(
          this.framingPosition,
          this.carSubject,
          this.subject,
          this.ballLook,
        );
        this.orientation(this.ballLook, this.desiredRotation, this.yaw);
        need = Math.max(
          need,
          this.framing.evaluate(
            this.framingPosition,
            this.desiredRotation,
            this.carSubject,
            this.subject,
            goalFocus ? 0.2 : P.ball.radius,
            c.aspect,
            p.fov,
          ),
        );
        this.framing.aim(
          this.framingPosition,
          this.carSubject,
          this.anticipatedSubject,
          this.ballLook,
        );
        this.orientation(this.ballLook, this.desiredRotation, this.yaw);
        need = Math.max(
          need,
          this.framing.evaluate(
            this.framingPosition,
            this.desiredRotation,
            this.carSubject,
            this.anticipatedSubject,
            goalFocus ? 0.2 : P.ball.radius,
            c.aspect,
            p.fov,
          ),
        );
      }
      if (need < p.fov + 10 || requiredZoom >= zoomLimit) break;
      requiredZoom = Math.min(
        zoomLimit,
        requiredZoom + (need - p.fov - 10) * 0.12,
      );
    }
    this.zoom = first
      ? requiredZoom
      : T.MathUtils.lerp(this.zoom, requiredZoom, damp(5, dt));
    this.offset
      .copy(this.forward)
      .multiplyScalar(-(baseDistance + this.zoom * this.modeBlend))
      .addScaledVector(worldUp, p.height);
    this.clearance.plan(
      this.offset,
      baseDistance + this.zoom * this.modeBlend,
      this.smoothedOffset,
    );
    this.desiredPosition.copy(this.pivot).add(this.offset);
    if (first) this.smoothedOffset.copy(this.offset);
    else {
      // Spherical boom damping cannot cut through the car during a mode change.
      const length = this.smoothedOffset.length(),
        targetLength = this.offset.length();
      this.smoothedOffset.divideScalar(Math.max(length, 1e-6));
      this.offset.divideScalar(Math.max(targetLength, 1e-6));
      const angle = this.smoothedOffset.angleTo(this.offset);
      this.orbitRotation.setFromUnitVectors(this.smoothedOffset, this.offset);
      const amount = Math.min(
        damp(6 + p.stiffness * 18, dt),
        (T.MathUtils.lerp(
          p.swivel,
          Math.min(2, p.swivel),
          T.MathUtils.smoothstep(
            1 - Math.abs(this.clearance.surfaceUp.y),
            0.02,
            0.7,
          ),
        ) *
          dt) /
          Math.max(angle, 1e-6),
      );
      this.orbitRotation.slerp(this.identity, 1 - amount);
      this.smoothedOffset
        .applyQuaternion(this.orbitRotation)
        .multiplyScalar(
          length +
            T.MathUtils.clamp(
              (targetLength - length) * damp(6 + 18 * p.stiffness, dt),
              -6 * dt,
              6 * dt,
            ),
        );
    }
    // Express the damped boom in the current smoothed arena frame as well.
    // Otherwise the previous frame's safe direction can lag behind a fast
    // curved-surface transition and collapse the final collision boom.
    this.clearance.plan(
      this.smoothedOffset,
      baseDistance + this.zoom * this.modeBlend,
      this.smoothedOffset,
    );
    this.clearance.resolve(
      simulation.world,
      this.pivot,
      this.smoothedOffset,
      c.position,
      dt,
      first,
    );

    this.carTarget
      .copy(this.pivot)
      .addScaledVector(this.forward, 3)
      .addScaledVector(
        worldUp,
        p.height + Math.tan(T.MathUtils.degToRad(p.angle)) * (p.distance + 3),
      );
    this.carLook.copy(this.carTarget).sub(c.position).normalize();
    this.framing.aim(c.position, this.carSubject, this.subject, this.ballLook);
    this.targetLook
      .copy(this.carLook)
      .lerp(this.ballLook, this.modeBlend)
      .normalize();
    this.orientation(this.targetLook, this.desiredRotation, this.yaw);
    const rate = 10 + p.stiffness * 14;
    const previousYaw = this.yaw,
      previousPitch = this.pitch;
    this.yaw = first
      ? this.targetYaw
      : this.yaw + delta(this.yaw, this.targetYaw) * damp(rate, dt);
    this.targetPitch += this.modeBlend * T.MathUtils.degToRad(p.angle) * 0.15;
    this.pitch = first
      ? this.targetPitch
      : T.MathUtils.lerp(this.pitch, this.targetPitch, damp(rate, dt));
    c.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    // Feedback is measured from the ACTUAL smoothed, collision-corrected pose.
    // Fast expansion keeps a safety reserve; return to user FOV is damped.
    let needed = this.framing.evaluate(
      c.position,
      c.quaternion,
      this.carSubject,
      this.subject,
      goalFocus ? 0.2 : P.ball.radius,
      c.aspect,
      c.fov,
    );
    if (tracking && needed > MAX_FRAMING_FOV - 12) {
      // Project the damped orientation into the feasible two-subject cone.
      // Take only the minimum correction needed; normal following still uses
      // independent damping. This prevents a narrow viewport or a fast ramp
      // from requiring an impossible FOV while a valid nearby aim exists.
      this.orientation(this.ballLook, this.desiredRotation, this.yaw);
      const best = this.framing.evaluate(
        c.position,
        this.desiredRotation,
        this.carSubject,
        this.subject,
        goalFocus ? 0.2 : P.ball.radius,
        c.aspect,
        c.fov,
        0.9,
      );
      if (best <= MAX_FRAMING_FOV - 2) {
        const coneFov = Math.max(MAX_FRAMING_FOV - 12, best + 1);
        const yawStep = delta(this.yaw, this.targetYaw),
          pitchStep = this.targetPitch - this.pitch;
        let low = 0,
          high = 1;
        for (let i = 0; i < 8; i++) {
          const fraction = (low + high) / 2;
          this.constraintEuler.set(
            this.pitch + pitchStep * fraction,
            this.yaw + yawStep * fraction,
            0,
            "YXZ",
          );
          this.desiredRotation.setFromEuler(this.constraintEuler);
          const requirement = this.framing.evaluate(
            c.position,
            this.desiredRotation,
            this.carSubject,
            this.subject,
            goalFocus ? 0.2 : P.ball.radius,
            c.aspect,
            c.fov,
            0.9,
          );
          if (requirement > coneFov) low = fraction;
          else high = fraction;
        }
        this.yaw += yawStep * high;
        this.pitch += pitchStep * high;
        c.rotation.set(this.pitch, this.yaw, 0, "YXZ");
        needed = this.framing.evaluate(
          c.position,
          c.quaternion,
          this.carSubject,
          this.subject,
          goalFocus ? 0.2 : P.ball.radius,
          c.aspect,
          c.fov,
          0.9,
        );
      }
    }
    if (!first) {
      const yawStep = delta(previousYaw, this.yaw),
        pitchStep = this.pitch - previousPitch;
      const fraction = Math.min(
        1,
        (Math.max(3, p.swivel) * Math.max(1, 1 / c.aspect) * dt) /
          Math.max(1e-6, Math.hypot(yawStep, pitchStep)),
      );
      this.yaw = previousYaw + yawStep * fraction;
      this.pitch = previousPitch + pitchStep * fraction;
      c.rotation.set(this.pitch, this.yaw, 0, "YXZ");
      needed = this.framing.evaluate(
        c.position,
        c.quaternion,
        this.carSubject,
        this.subject,
        goalFocus ? 0.2 : P.ball.radius,
        c.aspect,
        c.fov,
      );
    }
    const framingFov = T.MathUtils.lerp(
      p.fov,
      Math.max(p.fov, needed),
      this.modeBlend,
    );
    const targetFov = Math.min(MAX_FRAMING_FOV, framingFov);
    c.fov = first
      ? targetFov
      : T.MathUtils.lerp(
          c.fov,
          targetFov,
          damp(targetFov > c.fov ? 35 : 5, dt),
        );
    // The safety bound is already inside the screen; spending that reserve
    // avoids a frame of clipping while a fast-moving subject is being tracked.
    if (tracking) {
      const reserveFov =
        needed < 180
          ? T.MathUtils.radToDeg(
              2 *
                Math.atan(
                  (Math.tan(T.MathUtils.degToRad(needed / 2)) * 0.85) / 0.9,
                ),
            )
          : MAX_FRAMING_FOV;
      c.fov = Math.max(c.fov, Math.min(MAX_FRAMING_FOV, reserveFov));
    }
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    this.lookDirection.set(0, 0, -1).applyQuaternion(c.quaternion);
    this.framing.evaluate(
      c.position,
      c.quaternion,
      this.carSubject,
      this.subject,
      goalFocus ? 0.2 : P.ball.radius,
      c.aspect,
      c.fov,
      0.9,
    );
    this.debug.mode = tracking ? "Ball Cam" : "Car Cam";
    this.debug.fovAdjustment = c.fov - p.fov;
    this.debug.safe =
      this.framing.feasible && c.fov >= this.framing.requiredFov - 0.001;
    this.ready = true;
    this.mouseLook?.apply(c);
  }
}
