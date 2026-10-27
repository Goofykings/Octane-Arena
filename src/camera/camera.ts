import * as T from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { defaults, type CameraSettings } from "../game/settings";
import { P } from "../config/physics";
import { CameraClearance } from "./collision";
import { CameraFraming } from "./framing";
import type { MouseLook } from "./mouse-look";
import {
  cameraCollisionPolicy,
  cameraFloorClearance,
  type CameraCollisionSpace,
} from "./space";
import type { CameraViewFrame } from "../render/camera-occlusion";

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const worldUp = new T.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
/** RL camera units are uu; the rig works in metres. */
const UU = 0.01;
export const CAMERA_TRANSITION = {
  /** Seconds for a full Car Cam ↔ Ball Cam blend at Transition Speed 1. */
  duration: 0.55,
} as const;
export const CAMERA_RIG = {
  /** Car Cam heading follow rate (1/s) at stiffness 0 and its stiffness gain. */
  followRate: 9,
  followStiffnessGain: 9,
  /** Ball Cam bearing follow rate (1/s). */
  ballRate: 7,
  /** Hard ceiling on boom/aim follow speed (rad/s): no snaps. */
  maxTurnRate: 4.5,
  /** Rendered view rate while blending modes, per unit Transition Speed (rad/s). */
  transitionTurnRate: 3.5,
  /** Rendered view rate otherwise (rad/s): a lagging view never snaps. */
  maxViewRate: 8,
  /** Positional lag (s) at stiffness 0; stiffness 1 is rigid. */
  lag: 0.05,
  maxLag: 1.5,
  /** Fraction of the half-FOV that Ball Cam keeps the car inside. */
  carMargin: 0.8,
  /** Hard bound (NDC) on the car's centre, even while the view lags. */
  carReadable: 0.84,
  /** Reference-up rates (1/s): onto a surface, and back to world up in the air. */
  surfaceUpRate: 7,
  airUpRate: 2.6,
  /** Cap on the view roll rate (rad/s) so a fresh wall/ceiling frame rolls in. */
  maxRollRate: 6,
  /** Minimum camera height above the surface under the car (m). */
  minHeight: 0.25,
  /** A surface this close along the car's down axis is "under the wheels" (m). */
  surfaceReach: 0.7,
  /** ...when held this long (s) with the car's up turning relative to that
   * surface's normal slower than surfaceSpin (rad/s): a curve keeps the frame,
   * a car tumbling past a wall does not. */
  surfaceSettle: 0.1,
  surfaceSpin: 3,
  /** Low-pass rate (1/s) of that relative spin. */
  spinFilter: 10,
} as const;
/** RL FOV is horizontal at 16:9. Wider screens keep that vertical FOV (Hor+);
 * narrower ones keep the horizontal FOV down to 4:3 so the field stays readable. */
export function verticalFov(horizontal: number, aspect: number) {
  const reference = T.MathUtils.clamp(aspect, 4 / 3, 16 / 9);
  return (
    2 * Math.atan(Math.tan((horizontal * DEG) / 2) / reference) * (180 / Math.PI)
  );
}
/** Camera queries work in both closed arenas and open extra-mode worlds. */
export interface CameraWorld extends CameraCollisionSpace {
  ball?: { isEnabled(): boolean };
  physics?: { ball: { radius: number } };
  cameraObstacles?: (collider: RAPIER.Collider) => boolean;
}
/** Signed angle from a to b about axis (both already perpendicular to it). */
function signedAngle(a: T.Vector3, b: T.Vector3, axis: T.Vector3) {
  return Math.atan2(
    axis.x * (a.y * b.z - a.z * b.y) +
      axis.y * (a.z * b.x - a.x * b.z) +
      axis.z * (a.x * b.y - a.y * b.x),
    a.dot(b),
  );
}

/** One gameplay rig, shared by local and snapshot-rendered network matches.
 * All spatial inputs are render poses; physics supplies only arena queries and
 * whether the ball is enabled. The camera keeps its own reference up: the
 * surface under a wheel-down car (walls and ceiling roll the view, as in RL)
 * or world up in the air, so body rotation and air roll never roll the view. */
export class GameCamera {
  reverseHeld = false;
  private reverseApplied = false;
  private normalPosition = new T.Vector3();
  private normalRotation = new T.Quaternion();
  private normalFov = 77;
  private reverseOffset = new T.Vector3();
  mouseLook?: MouseLook;
  private viewFrame: CameraViewFrame = {
    car: new T.Vector3(),
    ball: new T.Vector3(),
    ballEnabled: false,
    position: new T.Vector3(),
    rotation: new T.Quaternion(),
  };
  settings: CameraSettings = defaults().camera;
  ballMode = true;
  /** Smoothed camera up (world up in the air, surface normal on walls/ceiling). */
  readonly referenceUp = new T.Vector3(0, 1, 0);
  /** Lagged follow point (stiffness), the boom origin. */
  readonly pivot = new T.Vector3();
  /** Automatic boom position before collision and free look. */
  readonly desiredPosition = new T.Vector3();
  /** Automatic aim, independent of manual free look. */
  readonly lookDirection = new T.Vector3(0, 0, -1);
  readonly framing = new CameraFraming();
  readonly clearance = new CameraClearance();
  readonly debug = {
    mode: "Ball Cam",
    fovAdjustment: 0,
    singularity: false,
    safe: true,
    blend: 1,
    fov: 0,
    verticalFov: 0,
    distance: 0,
    height: 0,
    angle: 0,
    stiffness: 0,
    swivel: 0,
    transition: 0,
    shake: 0,
    lag: 0,
  };
  /** True while the Car Cam ↔ Ball Cam blend is moving. */
  transitioning = false;
  private ready = false;
  private modeBlend = 1;
  private carDir = new T.Vector3(0, 0, -1);
  private ballDir = new T.Vector3(0, 0, -1);
  /** Rendered boom heading and aim; they follow the blended targets at a capped rate. */
  private boomDir = new T.Vector3(0, 0, -1);
  private aimDir = new T.Vector3(0, 0, -1);
  private aimAxis = new T.Vector3();
  private underRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  /** Car up minus the normal under it, last frame (valid when hadUnder). */
  private previousTilt = new T.Vector3();
  private previousCarUp = new T.Vector3(0, 1, 0);
  private tilt = new T.Vector3();
  private hadUnder = false;
  private relativeSpin = 0;
  private identity = new T.Quaternion();
  private surfaceTime = 0;
  private ballSign = 1;
  private blendSign = 1;
  private aimYaw = 0;
  private aimPitch = 0;
  private previousCar = new T.Vector3();
  private velocity = new T.Vector3();
  private shakeEnergy = 0;
  private previousVelocity = new T.Vector3();
  private carPosition = new T.Vector3();
  private subject = new T.Vector3();
  private nose = new T.Vector3();
  private carUp = new T.Vector3();
  private target = new T.Vector3();
  private dir = new T.Vector3();
  private back = new T.Vector3();
  private side = new T.Vector3();
  private offset = new T.Vector3();
  private look = new T.Vector3();
  private carLook = new T.Vector3();
  private ballLook = new T.Vector3();
  private toward = new T.Vector3();
  private basis = new T.Matrix4();
  private axisRight = new T.Vector3(1, 0, 0);
  private axisUp = new T.Vector3(0, 1, 0);
  private axisBack = new T.Vector3(0, 0, 1);
  private previousUp = new T.Vector3(0, 1, 0);
  private turn = new T.Quaternion();
  private lastRight = new T.Vector3(1, 0, 0);
  private orbitDir = new T.Vector3();
  private shakeRotation = new T.Quaternion();
  private shakeEuler = new T.Euler();

  constructor(public camera: T.PerspectiveCamera) {}
  get baseFov() {
    return this.settings.fov;
  }
  set baseFov(value: number) {
    this.settings.fov = value;
  }
  reset() {
    this.restoreNormal();
    this.ready = false;
    this.transitioning = false;
    this.clearance.reset();
  }
  private restoreNormal() {
    if (!this.reverseApplied) return;
    this.camera.position.copy(this.normalPosition);
    this.camera.quaternion.copy(this.normalRotation);
    this.camera.fov = this.normalFov;
    this.reverseApplied = false;
  }
  private reverseView(car: T.Object3D, simulation: CameraWorld) {
    const c = this.camera;
    const policy = cameraCollisionPolicy(simulation);
    this.normalPosition.copy(c.position);
    this.normalRotation.copy(c.quaternion);
    this.normalFov = c.fov;
    this.reverseOffset
      .set(0, 0, -1)
      .applyQuaternion(car.quaternion)
      .addScaledVector(this.referenceUp, -this.reverseOffset.dot(this.referenceUp))
      .normalize()
      .multiplyScalar(this.settings.distance * UU)
      .addScaledVector(this.referenceUp, this.settings.height * UU);
    if (policy.outsideArena)
      cameraFloorClearance(this.reverseOffset, car.position);
    const hit = simulation.world.castRay(
      new RAPIER.Ray(car.position, this.reverseOffset.clone().normalize()),
      this.reverseOffset.length(),
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      policy.blockers,
    );
    if (hit)
      this.reverseOffset.setLength(Math.max(0.1, hit.timeOfImpact - 0.2));
    c.position.copy(car.position).add(this.reverseOffset);
    this.look
      .copy(car.position)
      .addScaledVector(this.referenceUp, 0.3)
      .sub(c.position)
      .normalize();
    this.orientation(this.look, c.quaternion);
    c.fov = verticalFov(this.settings.fov, c.aspect);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    this.debug.mode = "Reverse Cam";
    this.reverseApplied = true;
  }
  /** Explicit basis from a look direction and the reference up. At the pole the
   * previous right vector is kept, so the frame can never flip. */
  private orientation(look: T.Vector3, result: T.Quaternion, _fallback = 0) {
    this.axisBack.copy(look).negate().normalize();
    this.axisRight.crossVectors(this.referenceUp, this.axisBack);
    const length = this.axisRight.length();
    this.debug.singularity = length < 0.05;
    if (length < 1e-4) this.axisRight.copy(this.lastRight);
    else {
      this.axisRight.multiplyScalar(1 / length);
      if (length < 0.05)
        this.axisRight
          .lerp(this.lastRight, 1 - length / 0.05)
          .addScaledVector(this.axisBack, -this.axisRight.dot(this.axisBack))
          .normalize();
    }
    this.lastRight.copy(this.axisRight);
    this.axisUp.crossVectors(this.axisBack, this.axisRight).normalize();
    this.basis.makeBasis(this.axisRight, this.axisUp, this.axisBack);
    result.setFromRotationMatrix(this.basis);
  }
  /** A rate-limited view can trail a fast boom swing (a ball whipping overhead),
   * and floor clearance can swing the lens after aiming. Turn `look` just far
   * enough that the car's centre stays readable from `eye`. */
  private keepCarReadable(
    look: T.Vector3,
    eye: T.Vector3,
    vHalf: number,
    hHalf: number,
  ) {
    const limit = CAMERA_RIG.carReadable,
      maxX = Math.tan(hHalf) * limit,
      maxY = Math.tan(vHalf) * limit;
    // The view basis is re-derived roll-free from the reference up, which
    // shifts a steeply pitched correction, so refine it a few times.
    for (let pass = 0; pass < 4; pass++) {
      this.axisBack.copy(look).negate();
      this.axisRight.crossVectors(this.referenceUp, this.axisBack);
      if (this.axisRight.lengthSq() < 1e-8) this.axisRight.copy(this.lastRight);
      this.axisRight.normalize();
      this.axisUp.crossVectors(this.axisBack, this.axisRight).normalize();
      this.toward.copy(this.carPosition).sub(eye);
      const depth = -this.toward.dot(this.axisBack),
        x = this.toward.dot(this.axisRight),
        y = this.toward.dot(this.axisUp);
      if (depth > 1e-3 && Math.abs(x) <= maxX * depth && Math.abs(y) <= maxY * depth)
        return;
      const u = depth > 1e-3 ? T.MathUtils.clamp(x / depth, -maxX, maxX) : Math.sign(x) * maxX,
        v = depth > 1e-3 ? T.MathUtils.clamp(y / depth, -maxY, maxY) : Math.sign(y) * maxY;
      // Where the car should appear, and the turn that puts it there.
      this.aimAxis
        .copy(this.axisRight)
        .multiplyScalar(u)
        .addScaledVector(this.axisUp, v)
        .sub(this.axisBack)
        .normalize();
      this.turn.setFromUnitVectors(this.aimAxis, this.toward.normalize());
      look.applyQuaternion(this.turn).normalize();
    }
  }
  /** Rotate a reference-plane direction toward a target by a rate-limited step. */
  private follow(
    direction: T.Vector3,
    targetDir: T.Vector3,
    alpha: number,
    maxStep: number,
    continuity?: "ball" | "blend",
  ) {
    let angle = signedAngle(direction, targetDir, this.referenceUp);
    if (continuity) {
      // At the antipode tiny bearing noise must not flip the chosen path.
      const sign = continuity === "ball" ? this.ballSign : this.blendSign;
      // Keep the remembered direction: the long way round is angle - 2π·sign.
      if (Math.abs(angle) > Math.PI - 0.15 && Math.sign(angle) !== sign)
        angle -= 2 * Math.PI * Math.sign(angle);
      else if (Math.abs(angle) > 0.1) {
        if (continuity === "ball") this.ballSign = Math.sign(angle);
        else this.blendSign = Math.sign(angle);
      }
    }
    const step = T.MathUtils.clamp(angle * alpha, -maxStep, maxStep);
    direction.applyAxisAngle(this.referenceUp, step).normalize();
    return angle;
  }
  /** Project onto the reference plane; returns the projected length. */
  private flatten(v: T.Vector3, out: T.Vector3) {
    out.copy(v).addScaledVector(this.referenceUp, -v.dot(this.referenceUp));
    const length = out.length();
    if (length > 1e-6) out.multiplyScalar(1 / length);
    return length;
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
      p = this.settings,
      r = CAMERA_RIG;
    this.restoreNormal();
    c.rotation.order = "YXZ";
    dt = T.MathUtils.clamp(dt, 0, 0.1);
    if (home) {
      delete c.userData.cameraView;
      this.referenceUp.copy(worldUp);
      c.position.set(9 + Math.sin(time * 0.06) * 1.5, 2.7, 19);
      this.look.set(5, 0.6, 10).sub(c.position).normalize();
      this.orientation(this.look, c.quaternion);
      c.fov = verticalFov(p.fov, c.aspect);
      c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
      this.reset();
      return;
    }
    const first = !this.ready;
    const policy = cameraCollisionPolicy(simulation);
    this.carPosition.copy(car.position);
    this.velocity
      .copy(car.position)
      .sub(this.previousCar)
      .divideScalar(Math.max(dt, 1e-6));
    if (first) this.velocity.set(0, 0, 0);
    this.previousCar.copy(car.position);
    const distance = p.distance * UU,
      height = p.height * UU;

    // ---- Reference up: surface under a wheel-down car, else world up -----
    this.clearance.survey(
      simulation.world,
      this.carPosition,
      distance + 4,
      dt,
      first,
      policy.surfaces,
      policy.blockers,
      policy.outsideArena,
    );
    this.carUp.set(0, 1, 0).applyQuaternion(car.quaternion);
    this.nose.set(0, 0, -1).applyQuaternion(car.quaternion);
    // The surface actually under the wheels (render pose ray along the car's
    // down axis), never a nearby wall: a wheels-down car on a wall or ceiling
    // rolls the view as in RL; anything else keeps world up.
    Object.assign(this.underRay.origin, this.carPosition);
    this.underRay.dir.x = -this.carUp.x;
    this.underRay.dir.y = -this.carUp.y;
    this.underRay.dir.z = -this.carUp.z;
    const under = simulation.world.castRayAndGetNormal(
      this.underRay,
      r.surfaceReach,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      policy.surfaces,
    );
    // Wheels-down must also be stable: a tumbling car whose underside swings
    // past a wall is not driving on it. Measure the car's up relative to the
    // surface under it, so driving through a curve (both turn together) and
    // yawing on a wall (up unchanged) keep the surface frame.
    if (under)
      this.tilt.set(
        this.carUp.x - under.normal.x,
        this.carUp.y - under.normal.y,
        this.carUp.z - under.normal.z,
      );
    // Filtered, so a step between faceted curve normals is not a tumble.
    const spin = first
      ? 0
      : (under && this.hadUnder
          ? this.tilt.distanceTo(this.previousTilt)
          : this.carUp.angleTo(this.previousCarUp)) / Math.max(dt, 1e-6);
    this.relativeSpin = first
      ? 0
      : this.relativeSpin + (spin - this.relativeSpin) * damp(r.spinFilter, dt);
    this.previousTilt.copy(this.tilt);
    this.previousCarUp.copy(this.carUp);
    this.hadUnder = !!under;
    const wheelsDown =
      !!under &&
      this.relativeSpin < r.surfaceSpin &&
      this.carUp.x * under.normal.x +
        this.carUp.y * under.normal.y +
        this.carUp.z * under.normal.z >
        0.8;
    this.surfaceTime = wheelsDown
      ? first
        ? r.surfaceSettle
        : this.surfaceTime + dt
      : 0;
    const onSurface = this.surfaceTime >= r.surfaceSettle ? 1 : 0;
    if (onSurface) this.target.copy(under!.normal).normalize();
    else this.target.copy(worldUp);
    this.previousUp.copy(this.referenceUp);
    if (first) this.referenceUp.copy(this.target);
    else {
      this.turn
        .setFromUnitVectors(this.referenceUp, this.target)
        .slerp(
          this.identity,
          1 - damp(onSurface > 0.5 ? r.surfaceUpRate : r.airUpRate, dt),
        );
      const roll = 2 * Math.acos(Math.min(1, Math.abs(this.turn.w))),
        maxRoll = r.maxRollRate * dt;
      if (roll > maxRoll) this.turn.slerp(this.identity, 1 - maxRoll / roll);
      this.referenceUp.applyQuaternion(this.turn).normalize();
    }
    // Parallel-transport both headings with the reference frame.
    this.turn.setFromUnitVectors(this.previousUp, this.referenceUp);
    for (const d of [this.carDir, this.ballDir, this.boomDir]) {
      d.applyQuaternion(this.turn);
      if (this.flatten(d, d) < 1e-3) this.flatten(this.nose, d);
      if (d.lengthSq() < 0.5) d.copy(this.axisBack).negate();
    }
    this.aimDir.applyQuaternion(this.turn).normalize();

    // ---- Stiffness: positional lag of the follow point ---------------------
    const lagTime = r.lag * (1 - T.MathUtils.clamp(p.stiffness, 0, 1));
    if (first || lagTime <= 1e-4) this.pivot.copy(this.carPosition);
    else {
      this.pivot.lerp(this.carPosition, 1 - Math.exp(-dt / lagTime));
      this.offset.copy(this.pivot).sub(this.carPosition);
      if (this.offset.length() > r.maxLag)
        this.pivot.copy(this.carPosition).add(this.offset.setLength(r.maxLag));
    }

    // ---- Car Cam heading: nose on a surface, travel direction in the air ---
    const noseLength = this.flatten(this.nose, this.toward);
    const followAlpha = damp(r.followRate + r.followStiffnessGain * p.stiffness, dt);
    const maxStep = r.maxTurnRate * dt;
    if (first) {
      if (noseLength > 0.2) this.carDir.copy(this.toward);
      else this.carDir.set(0, 0, -1);
    } else {
      const travel = this.flatten(this.velocity, this.target);
      if (onSurface > 0.5 && noseLength > 0.2)
        this.follow(this.carDir, this.toward, followAlpha, maxStep);
      else if (travel > 4)
        this.follow(this.carDir, this.target, damp(5, dt), maxStep);
      else if (noseLength > 0.6)
        this.follow(this.carDir, this.toward, damp(4, dt), maxStep);
    }

    // ---- Ball Cam bearing: behind the car, opposite the ball ---------------
    this.subject.copy(goalFocus ?? ball?.position ?? car.position);
    const tracking =
      this.ballMode && (!!simulation.ball?.isEnabled() || !!goalFocus);
    this.toward.copy(this.subject).sub(this.carPosition);
    const subjectHeight = this.toward.dot(this.referenceUp);
    const horizontal = this.flatten(this.toward, this.target);
    // Overhead: the bearing is undefined, so its authority fades smoothly out.
    const bearing =
      T.MathUtils.smoothstep(horizontal, 0.6, 3) *
      T.MathUtils.smoothstep(horizontal / Math.max(Math.abs(subjectHeight), 1e-3), 0.12, 0.6);
    this.debug.singularity = bearing < 0.5;
    if (first) this.ballDir.copy(bearing > 0.5 ? this.target : this.carDir);
    else if (bearing > 0)
      this.follow(
        this.ballDir,
        this.target,
        damp(r.ballRate * bearing, dt),
        maxStep,
        "ball",
      );

    // ---- Transition: one continuous blend, same rate both directions -------
    const goal = Number(tracking);
    if (first) this.modeBlend = goal;
    else {
      const rate = Math.max(0.05, p.transition) / CAMERA_TRANSITION.duration;
      this.modeBlend =
        goal > this.modeBlend
          ? Math.min(goal, this.modeBlend + rate * dt)
          : Math.max(goal, this.modeBlend - rate * dt);
    }
    this.transitioning = this.modeBlend !== goal;
    const m = T.MathUtils.smootherstep(this.modeBlend, 0, 1);

    // ---- Boom: blended heading, Ball Cam may lower to look up --------------
    this.dir.copy(this.carDir);
    const between = signedAngle(this.carDir, this.ballDir, this.referenceUp);
    let angle = between;
    if (
      Math.abs(between) > Math.PI - 0.15 &&
      Math.sign(between) !== this.blendSign
    )
      angle -= 2 * Math.PI * Math.sign(between);
    else if (Math.abs(between) > 0.1) this.blendSign = Math.sign(between);
    this.dir.applyAxisAngle(this.referenceUp, angle * m).normalize();
    // One rendered view: transitions swing at a rate set by Transition Speed.
    const viewStep =
      (this.transitioning
        ? r.transitionTurnRate * Math.max(0.05, p.transition)
        : r.maxViewRate) * dt;
    if (first) this.boomDir.copy(this.dir);
    else this.follow(this.boomDir, this.dir, 1, viewStep);
    this.dir.copy(this.boomDir);
    const boomLength = Math.hypot(distance, height),
      boomPitch = Math.atan2(height, distance);
    this.back.copy(this.dir).negate();
    this.offset
      .copy(this.back)
      .multiplyScalar(Math.cos(boomPitch) * boomLength)
      .addScaledVector(this.referenceUp, Math.sin(boomPitch) * boomLength);
    this.desiredPosition.copy(this.pivot).add(this.offset);

    // ---- Aim -----------------------------------------------------------------
    const vHalf = (verticalFov(p.fov, c.aspect) * DEG) / 2,
      hHalf = Math.atan(Math.tan(vHalf) * c.aspect);
    this.carLook
      .copy(this.dir)
      .multiplyScalar(Math.cos(p.angle * DEG))
      .addScaledVector(this.referenceUp, Math.sin(p.angle * DEG));
    this.side.crossVectors(this.dir, this.referenceUp).normalize();
    // Car direction from the boom, in boom yaw/pitch.
    this.toward.copy(this.carPosition).sub(this.desiredPosition).normalize();
    const carPitch = Math.asin(T.MathUtils.clamp(this.toward.dot(this.referenceUp), -1, 1));
    const carYaw = Math.atan2(this.toward.dot(this.side), this.toward.dot(this.dir));
    this.toward.copy(this.subject).sub(this.desiredPosition).normalize();
    const ballPitch = Math.asin(T.MathUtils.clamp(this.toward.dot(this.referenceUp), -1, 1));
    const ballYaw =
      Math.atan2(this.toward.dot(this.side), this.toward.dot(this.dir)) * bearing;
    const pitchLimit = carPitch + vHalf * r.carMargin;
    const targetPitch = T.MathUtils.clamp(
      ballPitch,
      carPitch - vHalf * r.carMargin,
      Math.min(pitchLimit, 80 * DEG),
    );
    const targetYaw = T.MathUtils.clamp(
      ballYaw,
      carYaw - hHalf * r.carMargin,
      carYaw + hHalf * r.carMargin,
    );
    // RL keeps the boom fixed: a very high ball only pitches the view, up to
    // the limit that keeps the car readable at the bottom of the frame.
    if (first) {
      this.aimYaw = targetYaw;
      this.aimPitch = targetPitch;
    } else {
      const a = damp(9, dt);
      this.aimYaw += T.MathUtils.clamp((targetYaw - this.aimYaw) * a, -maxStep, maxStep);
      this.aimPitch += T.MathUtils.clamp(
        (targetPitch - this.aimPitch) * a,
        -maxStep,
        maxStep,
      );
    }
    this.ballLook
      .copy(this.dir)
      .applyAxisAngle(this.referenceUp, -this.aimYaw)
      .multiplyScalar(Math.cos(this.aimPitch))
      .addScaledVector(this.referenceUp, Math.sin(this.aimPitch))
      .normalize();
    this.lookDirection.copy(this.carLook).lerp(this.ballLook, m).normalize();
    if (first) this.aimDir.copy(this.lookDirection);
    else {
      const turn = this.aimDir.angleTo(this.lookDirection);
      if (turn > viewStep) {
        this.aimAxis.crossVectors(this.aimDir, this.lookDirection);
        if (this.aimAxis.lengthSq() < 1e-12) this.aimAxis.copy(this.referenceUp);
        this.aimDir.applyAxisAngle(this.aimAxis.normalize(), viewStep);
      } else this.aimDir.copy(this.lookDirection);
    }
    this.keepCarReadable(this.aimDir, this.desiredPosition, vHalf, hHalf);
    this.lookDirection.copy(this.aimDir);

    // ---- Free look: position-based orbit around the car --------------------
    const look = this.mouseLook,
      yaw = look ? look.yaw : 0,
      pitch = look ? look.pitch : 0;
    // The orbit turns the boom about the car itself (not the lagged pivot), so
    // its length to the car is preserved and releasing returns exactly.
    this.offset.copy(this.desiredPosition).sub(this.carPosition);
    this.look.copy(this.lookDirection);
    if (yaw || pitch) {
      this.offset.applyAxisAngle(this.referenceUp, -yaw);
      this.look.applyAxisAngle(this.referenceUp, -yaw);
      this.orbitDir.copy(this.offset);
      const length = this.orbitDir.length();
      const elevation = Math.asin(
        T.MathUtils.clamp(this.orbitDir.dot(this.referenceUp) / Math.max(length, 1e-6), -1, 1),
      );
      const raised = T.MathUtils.clamp(elevation + pitch, -0.35, 1.2);
      this.flatten(this.orbitDir, this.orbitDir);
      this.side.crossVectors(this.orbitDir, this.referenceUp).normalize();
      this.offset
        .copy(this.orbitDir)
        .multiplyScalar(Math.cos(raised) * length)
        .addScaledVector(this.referenceUp, Math.sin(raised) * length);
      this.look.applyAxisAngle(this.side, raised - elevation).normalize();
    }

    // ---- Collision: the arena shell is see-through; hard blockers shorten ---
    // Keep the lens above the surface under a wheel-down car (whose origin rides
    // P.car.contactHeight up) by raising the boom, preserving its length.
    const floor = r.minHeight - P.car.contactHeight,
      above = this.offset.dot(this.referenceUp);
    if (onSurface > 0.5 && above < floor) {
      const length = this.offset.length(),
        lift = Math.min(floor, length * 0.99);
      this.flatten(this.offset, this.orbitDir);
      this.offset
        .copy(this.orbitDir)
        .multiplyScalar(Math.sqrt(Math.max(0, length * length - lift * lift)))
        .addScaledVector(this.referenceUp, lift);
    }
    this.clearance.resolve(
      simulation.world,
      this.carPosition,
      this.offset,
      c.position,
      dt,
      first,
      true,
    );
    this.keepCarReadable(this.look, c.position, vHalf, hHalf);
    this.orientation(this.look, c.quaternion);

    // ---- Optional camera shake (off by default) ----------------------------
    const impact = first
      ? 0
      : this.velocity.distanceTo(this.previousVelocity) / Math.max(dt, 1e-3);
    this.previousVelocity.copy(this.velocity);
    const speed = this.velocity.length();
    this.shakeEnergy = Math.max(
      this.shakeEnergy * Math.exp(-6 * dt),
      T.MathUtils.smoothstep(impact, 60, 400),
    );
    const shake = p.shake
      ? Math.min(1, this.shakeEnergy + 0.35 * T.MathUtils.smoothstep(speed, 21, 23))
      : 0;
    if (shake > 0) {
      const amount = 0.0045 * shake;
      this.shakeEuler.set(
        Math.sin(time * 47.3) * amount + Math.sin(time * 71.1) * amount * 0.5,
        Math.sin(time * 53.7 + 1.3) * amount,
        Math.sin(time * 39.1 + 2.1) * amount * 0.4,
      );
      c.quaternion.multiply(this.shakeRotation.setFromEuler(this.shakeEuler));
    }

    c.fov = verticalFov(p.fov, c.aspect);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    this.framing.evaluate(
      c.position,
      c.quaternion,
      this.carPosition,
      this.subject,
      goalFocus ? 0.2 : (simulation.physics?.ball.radius ?? P.ball.radius),
      c.aspect,
      c.fov,
      0.9,
    );
    this.debug.mode = this.transitioning
      ? tracking
        ? "Car → Ball Cam"
        : "Ball → Car Cam"
      : tracking
        ? "Ball Cam"
        : "Car Cam";
    this.debug.fovAdjustment = 0;
    this.debug.safe = this.framing.feasible;
    this.debug.blend = this.modeBlend;
    this.debug.fov = p.fov;
    this.debug.verticalFov = c.fov;
    this.debug.distance = p.distance;
    this.debug.height = p.height;
    this.debug.angle = p.angle;
    this.debug.stiffness = p.stiffness;
    this.debug.swivel = p.swivel;
    this.debug.transition = p.transition;
    this.debug.shake = shake;
    this.debug.lag = this.pivot.distanceTo(this.carPosition);
    this.ready = true;
    if (this.reverseHeld) this.reverseView(car, simulation);
    this.viewFrame.car.copy(this.carPosition);
    this.viewFrame.ball.copy(this.subject);
    this.viewFrame.ballEnabled = !!simulation.ball?.isEnabled();
    this.viewFrame.position.copy(this.camera.position);
    this.viewFrame.rotation.copy(this.camera.quaternion);
    this.camera.userData.cameraView = this.viewFrame;
  }
}
