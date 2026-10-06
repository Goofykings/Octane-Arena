import * as T from "three";
import type { CameraSettings } from "../game/settings";
import type { CameraWorld } from "./camera";
import { CameraClearance } from "./collision";

/** Radians per CSS-pixel delta, independent of resolution and frame rate. */
export const MOUSE_LOOK = {
  sensitivity: 0.0045,
  yawLimit: Math.PI,
  pitchLimit: 1.12,
  orbitFriction: 5.5,
  orbitMaxSpeed: 8,
};
const up = new T.Vector3(0, 1, 0);

/** Outward input approaches the bound exponentially; inward input is immediate. */
export function softAngle(value: number, movement: number, limit: number) {
  if (!movement) return value;
  if (value * movement < 0) {
    if (Math.abs(movement) <= Math.abs(value)) return value + movement;
    movement += value;
    value = 0;
  }
  return (
    Math.sign(movement) *
    (limit - (limit - Math.abs(value)) * Math.exp(-Math.abs(movement) / limit))
  );
}
const pitchOffset = (
  base: number,
  offset: number,
  low: number,
  high: number,
) => {
  if (!offset) return base;
  const room = Math.max(1e-6, offset > 0 ? high - base : base - low);
  return (
    base + Math.sign(offset) * room * (1 - Math.exp(-Math.abs(offset) / room))
  );
};

/** Only view offsets. Never touches player input, Ball Cam state or car physics. */
export class MouseLook {
  behavior: "look" | "orbit" = "look";
  dragging = false;
  yaw = 0;
  pitch = 0;
  targetYaw = 0;
  targetPitch = 0;
  yawVelocity = 0;
  pitchVelocity = 0;
  private idleTime = 0;
  private yawRotation = new T.Quaternion();
  private pitchRotation = new T.Quaternion();
  private direction = new T.Vector3();
  private right = new T.Vector3();
  get active() {
    return this.dragging || this.yaw !== 0 || this.pitch !== 0;
  }
  get moving() {
    return (
      this.dragging ||
      Math.abs(this.yawVelocity) + Math.abs(this.pitchVelocity) > 0 ||
      Math.abs(
        Math.atan2(
          Math.sin(this.targetYaw - this.yaw),
          Math.cos(this.targetYaw - this.yaw),
        ),
      ) +
        Math.abs(this.targetPitch - this.pitch) >
        1e-5
    );
  }
  setBehavior(behavior: "look" | "orbit") {
    if (this.behavior === behavior) return;
    this.reset();
    this.behavior = behavior;
  }
  begin() {
    this.dragging = true;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.yawVelocity = this.pitchVelocity = 0;
    this.idleTime = 0;
  }
  move(dx: number, dy: number, elapsed = 1 / 60) {
    if (!this.dragging || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const oldPitch = this.targetPitch;
    const yawMovement = -dx * MOUSE_LOOK.sensitivity;
    this.targetYaw =
      this.behavior === "orbit"
        ? this.targetYaw + yawMovement
        : softAngle(
            this.targetYaw,
            -dx * MOUSE_LOOK.sensitivity,
            MOUSE_LOOK.yawLimit,
          );
    this.targetPitch = softAngle(
      this.targetPitch,
      dy * MOUSE_LOOK.sensitivity,
      MOUSE_LOOK.pitchLimit,
    );
    if (this.behavior === "orbit") {
      const dt = T.MathUtils.clamp(elapsed, 1 / 240, 0.1);
      const alpha = 1 - Math.exp(-20 * dt);
      const speed = (movement: number) =>
        T.MathUtils.clamp(
          movement / dt,
          -MOUSE_LOOK.orbitMaxSpeed,
          MOUSE_LOOK.orbitMaxSpeed,
        );
      this.yawVelocity += (speed(yawMovement) - this.yawVelocity) * alpha;
      this.pitchVelocity +=
        (speed(this.targetPitch - oldPitch) - this.pitchVelocity) * alpha;
      this.idleTime = 0;
    }
  }
  end() {
    this.dragging = false;
    if (this.behavior === "look") this.targetYaw = this.targetPitch = 0;
  }
  reset() {
    this.end();
    this.yaw = this.pitch = 0;
    this.targetYaw =
      this.targetPitch =
      this.yawVelocity =
      this.pitchVelocity =
        0;
  }
  update(dt: number, settings: Pick<CameraSettings, "transition" | "swivel">) {
    dt = Math.max(0, dt);
    if (this.behavior === "orbit") {
      const decay = Math.exp(-MOUSE_LOOK.orbitFriction * dt);
      if (!this.dragging) {
        const travel = (1 - decay) / MOUSE_LOOK.orbitFriction;
        this.targetYaw += this.yawVelocity * travel;
        this.targetPitch = softAngle(
          this.targetPitch,
          this.pitchVelocity * travel,
          MOUSE_LOOK.pitchLimit,
        );
        this.yawVelocity *= decay;
        this.pitchVelocity *= decay;
      } else {
        // A held, stationary pointer should not release an old fling.
        this.idleTime += dt;
        if (this.idleTime > 0.06) {
          this.yawVelocity *= decay;
          this.pitchVelocity *= decay;
        }
      }
      if (Math.abs(this.yawVelocity) < 0.01) this.yawVelocity = 0;
      if (Math.abs(this.pitchVelocity) < 0.01) this.pitchVelocity = 0;
      // Wrap equivalent angles without imposing a stop or retaining huge turns.
      this.targetYaw = Math.atan2(
        Math.sin(this.targetYaw),
        Math.cos(this.targetYaw),
      );
      const difference = Math.atan2(
        Math.sin(this.targetYaw - this.yaw),
        Math.cos(this.targetYaw - this.yaw),
      );
      const alpha = 1 - Math.exp(-settings.swivel * 8 * dt);
      this.yaw += difference * alpha;
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      this.pitch += (this.targetPitch - this.pitch) * alpha;
      if (
        !this.dragging &&
        !this.yawVelocity &&
        !this.pitchVelocity &&
        Math.abs(difference) + Math.abs(this.targetPitch - this.pitch) < 1e-5
      ) {
        this.yaw = this.targetYaw;
        this.pitch = this.targetPitch;
      }
      return;
    }
    const rate = this.dragging ? settings.swivel * 8 : settings.transition * 5;
    const alpha = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
    this.yaw += (this.targetYaw - this.yaw) * alpha;
    this.pitch += (this.targetPitch - this.pitch) * alpha;
    if (!this.dragging && Math.abs(this.yaw) + Math.abs(this.pitch) < 1e-5)
      this.yaw = this.pitch = 0;
  }
  /** Apply after automatic framing/FOV. The next rig update still uses its own
   * yaw/pitch history, so release follows the CURRENT automatic target. */
  apply(camera: T.PerspectiveCamera) {
    if (!this.active) return;
    this.direction.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const basePitch = Math.asin(T.MathUtils.clamp(this.direction.y, -1, 1));
    const pitch = pitchOffset(basePitch, this.pitch, -1.48, 1.48) - basePitch;
    this.yawRotation.setFromAxisAngle(up, -this.yaw);
    camera.quaternion.premultiply(this.yawRotation);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.pitchRotation.setFromAxisAngle(this.right, pitch);
    camera.quaternion.premultiply(this.pitchRotation).normalize();
    camera.updateMatrixWorld(true);
  }
}

/** Display cameras orbit a fixed focus. The car's pose is never modified. */
export class MouseOrbit {
  readonly clearance = new CameraClearance();
  private offset = new T.Vector3();
  private first = true;
  apply(
    camera: T.PerspectiveCamera,
    focus: T.Vector3,
    look: MouseLook | undefined,
    dt: number,
    world?: CameraWorld,
    minY = 0.2,
  ) {
    if (!look?.active) {
      this.first = true;
      return;
    }
    this.offset.copy(camera.position).sub(focus);
    const length = this.offset.length();
    const basePitch = Math.asin(
      T.MathUtils.clamp(this.offset.y / Math.max(length, 1e-6), -1, 1),
    );
    const floorPitch = Math.asin(
      T.MathUtils.clamp((minY - focus.y) / Math.max(length, 1e-6), -1, 1),
    );
    const pitch = pitchOffset(
      basePitch,
      look.pitch,
      Math.min(basePitch, floorPitch),
      1.48,
    );
    const yaw = Math.atan2(this.offset.x, this.offset.z) + look.yaw;
    this.offset.set(
      Math.sin(yaw) * Math.cos(pitch) * length,
      Math.sin(pitch) * length,
      Math.cos(yaw) * Math.cos(pitch) * length,
    );
    if (world) {
      this.clearance.survey(
        world.world,
        focus,
        length + 1,
        dt,
        this.first,
        world.cameraObstacles,
      );
      this.clearance.resolve(
        world.world,
        focus,
        this.offset,
        camera.position,
        dt,
        this.first,
      );
    } else camera.position.copy(focus).add(this.offset);
    this.first = false;
    camera.up.copy(up);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
  }
}
