import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { P, curvature, throttleAcceleration } from "../config/physics";
import type { PlayerInput } from "../../shared/player";
import { JumpState } from "./dodge";
import { Pose } from "../physics/pose";
import { bodies, type BodyId } from "../game/inventory";
import {
  wheelMount,
  wheelClearance,
  wheelMountY,
  wheelSupportPoint,
} from "./wheels";
export class Car {
  id = "";
  team = 0;
  displayName = "Guest";
  demolitionState: "active" | "demolished" | "respawning" = "active";
  respawnTimer = 0;
  supersonic = false;
  private sonicGrace = 0;
  lateralSlip = 0;
  skidIntensity = 0;
  private stuckTime = 0;
  private roofSteer = 0;
  impactTime = 0;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pose: Pose;
  jump = new JumpState();
  boost = 100;
  forward = new Vector3();
  right = new Vector3();
  up = new Vector3();
  normal = new Vector3(0, 1, 0);
  grounded = false;
  contacts = 0;
  stableContact = false;
  forwardSpeed = 0;
  boosting = false;
  lastJump = false;
  normalJumpSequence = 0;
  normalJumpAge = Infinity;
  normalJumpOrigin = new Vector3();
  normalJumpNormal = new Vector3(0, 1, 0);
  bodyId: BodyId = "ion";
  steerAngle = 0;
  handbrake = 0;
  private driftSign = 1;
  private recovery = 0;
  private recoverySide = 1;
  private recoveryCooldown = 0;
  private contactGap = 1;
  contactState: "surface" | "transition" | "air" = "air";
  aerialControl = 1;
  get recovering() {
    return this.recovery > 0;
  }
  get angularLimit() {
    return this.jump.flipLeft > 0
      ? P.jump.flipMaxAngular
      : this.contacts >= 1 && this.surfaceTurn.length() > 0.5
        ? 14
        : P.car.maxAngular;
  }
  private surfaceForward = new Vector3();
  private surfaceRight = new Vector3();
  wheelOrigins = Array.from({ length: 4 }, () => new Vector3());
  wheelHits = Array.from({ length: 4 }, () => new Vector3());
  wheelContact = [false, false, false, false];
  wheelNormals = Array.from({ length: 4 }, () => new Vector3());
  adhesionAcceleration = new Vector3();
  contactCorrection = new Vector3();
  normalCorrectionAcceleration = new Vector3();
  pitchInput = 0;
  flipPitchAcceleration = 0;
  flipCancelAcceleration = 0;
  get pitchLocked() {
    return (
      this.jump.second &&
      this.jump.flipAge < P.jump.flipTime + P.jump.pitchLockExtra
    );
  }
  private q = new Quaternion();
  private v = new Vector3();
  private w = new Vector3();
  private tmp = new Vector3();
  private acceleration = new Vector3();
  private angular = new Vector3();
  private normalReady = false;
  private surfaceTurn = new Vector3();
  constructor(public world: RAPIER.World) {
    const c = P.car;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(c.halfWidth, c.halfHeight, c.halfLength)
        .setTranslation(0, c.hitboxY, 0)
        .setMassProperties(
          c.mass,
          { x: 0, y: c.comY, z: 0 },
          { x: 25, y: 35, z: 20 },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(P.car.chassisFriction)
        .setContactSkin(P.car.contactSkin)
        .setRestitution(0.05),
      this.body,
    );
    this.pose = new Pose(this.body);
    this.reset(0, 25, 0);
  }
  reset(x: number, z: number, yaw: number, y = 0.36) {
    this.demolitionState = "active";
    this.respawnTimer = 0;
    this.supersonic = false;
    this.sonicGrace = 0;
    this.stuckTime = 0;
    this.roofSteer = 0;
    this.lateralSlip = this.skidIntensity = 0;
    this.handbrake = 0;
    this.recovery = 0;
    this.recoveryCooldown = 0;
    this.contactGap = 1;
    this.contactState = "air";
    this.aerialControl = 1;
    this.contacts = 0;
    this.grounded = false;
    this.stableContact = false;
    this.normalReady = false;
    this.surfaceTurn.set(0, 0, 0);
    this.wheelContact.fill(false);
    this.wheelNormals.forEach((n) => n.set(0, 0, 0));
    this.adhesionAcceleration.set(0, 0, 0);
    this.contactCorrection.set(0, 0, 0);
    this.normalCorrectionAcceleration.set(0, 0, 0);
    this.pitchInput =
      this.flipPitchAcceleration =
      this.flipCancelAcceleration =
        0;
    this.impactTime = 0;
    this.boosting = false;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.jump.reset();
    this.normalJumpSequence = 0;
    this.normalJumpAge = Infinity;
    this.jump.wasDown = false;
    this.boost = 100;
    this.pose.snap();
  }
  setBody(id: BodyId) {
    this.bodyId = id;
    const d = bodies[id];
    this.collider.setShape(
      new RAPIER.Cuboid(d.halfWidth, d.halfHeight, d.halfLength),
    );
    this.collider.setTranslationWrtParent({ x: 0, y: d.hitboxY, z: 0 });
    this.body.recomputeMassPropertiesFromColliders();
  }
  /** Countdown changes only the displayed steering rack, never rigid-body state. */
  steerAtKickoff(input: PlayerInput) {
    this.steerAngle =
      -input.steer * Math.atan(2 * bodies[this.bodyId].axle * curvature(0));
  }
  tick(input: PlayerInput) {
    if (this.demolitionState !== "active") return;
    this.normalJumpAge += P.dt;
    this.impactTime = Math.max(0, this.impactTime - P.dt);
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - P.dt);
    const dt = P.dt,
      c = P.car,
      b = this.body;
    this.q.copy(b.rotation());
    this.v.copy(b.linvel());
    this.w.copy(b.angvel());
    this.forward.set(0, 0, -1).applyQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.forwardSpeed = this.v.dot(this.forward);
    const dimensions = bodies[this.bodyId];
    const slide = P.powerslide;
    if (this.handbrake === 0)
      this.driftSign =
        Math.sign(this.forwardSpeed) || Math.sign(input.throttle) || 1;
    this.handbrake = Math.max(
      0,
      Math.min(
        1,
        this.handbrake + (input.slide ? slide.rise : -slide.fall) * dt,
      ),
    );
    const ordinaryAngle = Math.atan(
      2 * dimensions.axle * curvature(this.forwardSpeed),
    );
    const baseSlideAngle =
      slide.lowSpeedSteer +
      (slide.highSpeedSteer - slide.lowSpeedSteer) *
        Math.min(1, Math.abs(this.forwardSpeed) / slide.steerCurveEnd);
    // Scale curvature (and therefore yaw target), keeping wheel visuals in sync.
    const slideAngle = Math.atan(
      Math.tan(baseSlideAngle) * slide.rotationScale,
    );
    this.steerAngle =
      -input.steer *
      (ordinaryAngle + (slideAngle - ordinaryAngle) * this.handbrake);
    this.acceleration.set(0, 0, 0);
    this.adhesionAcceleration.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.pitchInput = input.pitch;
    this.flipPitchAcceleration = this.flipCancelAcceleration = 0;
    const contactNormal = new Vector3();
    this.contacts = 0;
    for (let i = 0; i < 4; i++) {
      const o = wheelMount(this.bodyId, i, this.wheelOrigins[i])
        .applyQuaternion(this.q)
        .add(b.translation());
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray(o, this.tmp.copy(this.up).negate()),
        c.rayLength,
        true,
        undefined,
        undefined,
        this.collider,
        this.body,
        (col) => col.parent() === null,
      );
      this.wheelContact[i] = false;
      this.wheelNormals[i].set(0, 0, 0);
      this.wheelHits[i].copy(o).addScaledVector(this.up, -c.rayLength);
      if (
        hit &&
        hit.normal.x * this.up.x +
          hit.normal.y * this.up.y +
          hit.normal.z * this.up.z >
          0.25
      ) {
        this.wheelHits[i].copy(o).addScaledVector(this.up, -hit.timeOfImpact);
        this.wheelNormals[i].copy(hit.normal);
        const weight = Math.max(
          0.1,
          Math.min(
            1,
            1 -
              (hit.timeOfImpact - c.contactHeight) /
                (c.rayLength - c.contactHeight),
          ),
        );
        contactNormal.addScaledVector(this.wheelNormals[i], weight);
        if (
          hit.timeOfImpact <
            c.contactReach +
              (this.stableContact ? c.maxContactCorrection : 0) &&
          !(this.jump.used && this.jump.age < 0.18)
        ) {
          this.contacts++;
          this.wheelContact[i] = true;
          this.wheelNormals[i].copy(hit.normal);
        }
      }
    }
    this.grounded = this.contacts >= 2;
    if (this.contacts >= 1) {
      contactNormal.normalize();
      // Fit the wheel footprint, rather than selecting a single triangle's normal.
      const active = this.wheelHits.filter(
        (_, i) => this.wheelNormals[i].lengthSq() > 0,
      );
      const flatFloor = this.wheelNormals.every(
        (n) => n.lengthSq() === 0 || n.y > 0.9999,
      );
      const plane = new Vector3();
      for (let i = 0; i < active.length; i++)
        for (let j = i + 1; j < active.length; j++)
          for (let k = j + 1; k < active.length; k++) {
            const n = new Vector3()
              .subVectors(active[j], active[i])
              .cross(new Vector3().subVectors(active[k], active[i]));
            if (n.dot(contactNormal) < 0) n.negate();
            plane.add(n);
          }
      if (
        active.length === 4 &&
        plane.lengthSq() > 1e-8 &&
        plane.normalize().dot(contactNormal) > 0.7
      )
        contactNormal.lerp(plane, 0.65).normalize();
      const previousNormal = this.normal.clone();
      if (
        flatFloor ||
        !this.normalReady ||
        this.normal.dot(contactNormal) < 0.5
      )
        this.normal.copy(contactNormal);
      else
        this.normal
          .lerp(contactNormal, 1 - Math.exp(-c.normalResponse * dt))
          .normalize();
      this.surfaceTurn
        .copy(previousNormal)
        .cross(this.normal)
        .multiplyScalar(this.normalReady && !flatFloor ? 1 / dt : 0)
        .clampLength(0, 12);
      this.normalReady ||= active.length >= 3 || this.contacts >= 2;
      // Touching is not yet stable support. Keep the established ramp controller
      // through short wheel unloading, but let a tilted touchdown settle through
      // the physical wheel-point constraints before enabling orientation feedback.
      this.stableContact =
        this.normalReady &&
        this.up.dot(this.normal) > (this.stableContact ? 0.94 : 0.98) &&
        (this.contacts >= 3 || (this.stableContact && active.length >= 3));
    } else if (!this.contacts) {
      this.stableContact = false;
      this.normalReady = false;
      this.surfaceTurn.set(0, 0, 0);
      this.normal.copy(this.up);
    }
    // Held input may begin recovery on touchdown; the timed state/cooldown prevents retriggering.
    const recoveryInput = input.jump || Math.abs(input.throttle) > 0.1;
    if (
      !this.grounded &&
      recoveryInput &&
      this.recoveryCooldown === 0 &&
      this.recovery === 0
    ) {
      const support = this.world.castRayAndGetNormal(
        new RAPIER.Ray(b.translation(), this.up),
        dimensions.hitboxY + dimensions.halfHeight + 0.13,
        true,
        undefined,
        undefined,
        this.collider,
        b,
        (col) => col.parent() === null,
      );
      if (support && this.up.dot(this.tmp.copy(support.normal)) < -0.65) {
        // Player-requested roof recovery needs a full half-turn. Previously
        // the driving alignment controller finished it on partial touchdown;
        // that controller must now wait for real stable support instead.
        this.recovery = 0.6;
        this.recoveryCooldown = c.recoveryCooldown;
        this.recoverySide =
          input.roll ||
          input.steer ||
          (this.right.dot(this.tmp.copy(support.normal)) >= 0 ? 1 : -1);
        this.v.addScaledVector(this.tmp.copy(support.normal), 1.5);
      }
    }
    let sideSupport: Vector3 | null = null;
    if (
      this.contacts < 3 &&
      Math.abs(input.throttle) > 0.1 &&
      this.v.length() < 2 &&
      this.w.length() < 1.5 &&
      !this.recovering
    ) {
      // A center-only side ray can miss support at a tilted bumper/roof corner.
      // Prefer real near-touching static manifolds, then fall back to side rays.
      this.world.contactPairsWith(this.collider, (other) => {
        if (other.parent() !== null) return;
        this.world.contactPair(this.collider, other, (manifold, flipped) => {
          const normal = new Vector3()
            .copy(manifold.normal())
            .multiplyScalar(flipped ? 1 : -1);
          if (this.up.dot(normal) >= 0.55) return;
          for (let k = 0; k < manifold.numContacts(); k++)
            if (manifold.contactDist(k) < 0.025) sideSupport = normal;
        });
      });
      for (const sign of [-1, 1]) {
        if (sideSupport) break;
        const hit = this.world.castRayAndGetNormal(
          new RAPIER.Ray(
            b.translation(),
            this.right.clone().multiplyScalar(sign),
          ),
          dimensions.halfWidth + 0.14,
          true,
          undefined,
          undefined,
          this.collider,
          b,
          (col) => col.parent() === null,
        );
        if (hit && this.up.dot(hit.normal) < 0.55) {
          sideSupport = new Vector3().copy(hit.normal);
          break;
        }
      }
    }
    this.stuckTime = sideSupport ? this.stuckTime + dt : 0;
    if (
      sideSupport &&
      this.stuckTime >= c.stuckTime &&
      this.recoveryCooldown === 0
    ) {
      this.recovery = 0.4;
      this.recoveryCooldown = c.recoveryCooldown;
      this.recoverySide =
        Math.sign(this.up.clone().cross(sideSupport).dot(this.forward)) || 1;
      this.v.addScaledVector(sideSupport, 1.5);
      this.stuckTime = 0;
    }
    this.contactGap = this.contacts ? 0 : this.contactGap + dt;
    const leavingByJump = this.jump.used && this.jump.age < 0.18;
    this.contactState =
      this.stableContact && this.contacts >= 3
        ? "surface"
        : this.contacts ||
            (!leavingByJump && this.contactGap < c.contactRelease)
          ? "transition"
          : "air";
    // Chassis support is independent of wheel grounding. Roof contacts must not
    // run the aerial pitch/damping controller while the solver is turning the
    // rigid body around a ramp. Average all near-touching roof manifolds.
    const roofNormal = new Vector3();
    let roofContacts = 0;
    this.world.contactPairsWith(this.collider, (other) => {
      if (other.parent() !== null) return;
      this.world.contactPair(this.collider, other, (manifold, flipped) => {
        const normal = new Vector3()
          .copy(manifold.normal())
          .multiplyScalar(flipped ? 1 : -1);
        if (normal.dot(this.up) > -0.5) return;
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) > c.contactSkin * 2) continue;
          roofNormal.add(normal);
          roofContacts++;
        }
      });
    });
    if (roofContacts) roofNormal.normalize();
    this.roofSteer =
      roofContacts && !this.recovering ? Math.abs(input.steer) : 0;
    // Contact suppresses commanded air torque, never physical angular momentum.
    this.aerialControl =
      this.contactState !== "air" || this.recovering || roofContacts > 0
        ? 0
        : leavingByJump
          ? 1
          : Math.min(1, this.aerialControl + dt / c.airControlBlend);
    this.boosting = input.boost && this.boost > 0;
    const throttle = this.boosting ? 1 : input.throttle;
    if (this.contacts) {
      const support = this.contacts >= 2 ? 1 : 0.25;
      this.surfaceForward
        .copy(this.forward)
        .addScaledVector(this.normal, -this.forward.dot(this.normal))
        .normalize();
      this.surfaceRight
        .crossVectors(this.surfaceForward, this.normal)
        .normalize();
      // Grip and adhesion are separate. Gravity remains world-down; neither
      // throttle at rest nor ceiling contact can sustain a magnetic attachment.
      const drive = Math.min(1, Math.abs(this.forwardSpeed) / c.wallDriveSpeed);
      const floor = Math.max(0, this.normal.y);
      const overhead = Math.max(
        0,
        Math.min(1, 1 - this.normal.y / c.ceilingAdhesionEnd),
      );
      const wallGrip =
        floor * floor +
        (1 - floor * floor) *
          (c.wallIdleGrip + (1 - c.wallIdleGrip) * drive * drive);
      this.acceleration.addScaledVector(
        this.normal,
        -(c.adhesion + P.gravity * (1 - floor) * drive) *
          overhead *
          support *
          Number(this.stableContact),
      );
      this.adhesionAcceleration
        .copy(this.normal)
        .multiplyScalar(
          -(c.adhesion + P.gravity * (1 - floor) * drive) *
            overhead *
            support *
            Number(this.stableContact),
        );
      const vf = this.v.dot(this.surfaceForward);
      let engine = 0;
      if (Math.abs(throttle) < 0.01)
        engine = -Math.sign(vf) * Math.min(c.coast, Math.abs(vf) / dt);
      else if (throttle * vf < -0.1)
        engine = Math.sign(throttle) * Math.min(c.brake, Math.abs(vf) / dt);
      else engine = throttle * throttleAcceleration(vf);
      const lateral = this.v.dot(this.surfaceRight);
      const slipRatio =
        Math.abs(lateral) / (Math.abs(vf) + Math.abs(lateral) + 0.001);
      const lateralFactor = Math.max(
        slide.minimumLateralGrip,
        (slide.lateralAtForward +
          (slide.lateralAtSideways - slide.lateralAtForward) * slipRatio) *
          (1 - slide.slipGripFalloff * slipRatio),
      );
      const longitudinalFactor =
        slide.longitudinalAtForward +
        (slide.longitudinalAtSideways - slide.longitudinalAtForward) *
          slipRatio;
      // Pre-held handbrake is already engaged on touchdown; no velocity realignment.
      const driftEngine =
        throttle * throttleAcceleration(vf) * longitudinalFactor -
        (Math.abs(throttle) < 0.01 ? vf * slide.coastDrag : 0);
      const contactScale =
        this.contacts < 3
          ? 1 + (slide.partialContactScale - 1) * this.handbrake
          : 1;
      engine += (driftEngine - engine) * this.handbrake;
      this.acceleration.addScaledVector(
        this.surfaceForward,
        engine *
          contactScale *
          support *
          (Math.abs(throttle) > 0.01 ? 1 : wallGrip),
      );
      this.acceleration.addScaledVector(
        this.surfaceRight,
        -lateral *
          c.grip *
          (1 + (lateralFactor - 1) * this.handbrake) *
          contactScale *
          support *
          wallGrip *
          (this.impactTime > 0 ? 0.18 : 1),
      );
      // Contact-normal feedback aligns physical angular motion on every surface, including ramps.
      const curveResponse = Math.min(1, this.surfaceTurn.length() / 2);
      const alignment =
        c.align *
        (1 + (c.curveAlignmentScale - 1) * curveResponse) *
        Number(this.stableContact);
      const damping =
        c.alignDamping *
        (1 + (c.curveDampingScale - 1) * curveResponse) *
        Number(this.stableContact);
      const supportNormal = this.normal.clone();
      if (this.surfaceTurn.lengthSq() > 0.01)
        supportNormal.applyAxisAngle(
          this.surfaceTurn.clone().normalize(),
          Math.min(0.25, this.surfaceTurn.length() / c.normalResponse),
        );
      this.angular.copy(this.up).cross(supportNormal).multiplyScalar(alignment);
      this.tmp
        .copy(this.w)
        .addScaledVector(this.normal, -this.w.dot(this.normal));
      this.angular.addScaledVector(
        this.tmp,
        -damping * (this.impactTime > 0 ? 0.3 : 1),
      );
      const normalTarget = -input.steer * curvature(vf) * vf;
      const surfaceSpeed = Math.hypot(vf, lateral);
      const driftTarget =
        ((-input.steer * Math.tan(slideAngle)) / (2 * dimensions.axle)) *
        surfaceSpeed *
        this.driftSign;
      const target =
        normalTarget + (driftTarget - normalTarget) * this.handbrake;
      this.angular.addScaledVector(
        this.normal,
        (target - this.w.dot(this.normal)) *
          (c.steeringResponse +
            (slide.yawResponse - c.steeringResponse) * this.handbrake) *
          (this.impactTime > 0 ? 0.3 : 1),
      );
      // The curve's changing normal is a geometric angular target, not tire
      // traction. Preserve it when a wheel unloads instead of freezing the frame.
      this.angular.addScaledVector(this.surfaceTurn, damping);
    } else {
      this.acceleration.addScaledVector(
        this.forward,
        throttle * (throttle >= 0 ? c.airThrottle : c.airReverse),
      );
    }
    if (this.boosting) {
      this.acceleration.addScaledVector(
        this.forward,
        this.grounded ? c.boostGround : c.boostAir,
      );
      this.boost = Math.max(0, this.boost - c.boostUse * dt);
    }
    const action = this.jump.step(
      this.recovering ? { ...input, jump: false } : input,
      this.grounded,
      dt,
    );
    if (this.recovering) this.jump.wasDown = input.jump;
    this.lastJump = action !== null;
    if (action === "first") {
      this.normalJumpSequence++;
      this.normalJumpAge = 0;
      this.normalJumpNormal.copy(this.normal);
      this.normalJumpOrigin
        .copy(b.translation())
        .addScaledVector(this.up, -P.car.contactHeight)
        .addScaledVector(this.normal, 0.06);
    }
    if (action === "first" || action === "double") {
      this.v.addScaledVector(this.up, P.jump.impulse);
      this.grounded = false;
    }
    if (action === "dodge") {
      const ratio = Math.abs(this.forwardSpeed) / c.maxSpeed;
      const forward2 = this.forward.clone().setY(0);
      if (forward2.lengthSq() < 0.001) forward2.set(0, 0, -1);
      forward2.normalize();
      const right2 = new Vector3(-forward2.z, 0, forward2.x);
      const forwardAmount = -this.jump.direction.z;
      const backward =
        Math.abs(this.forwardSpeed) < 1
          ? forwardAmount < 0
          : forwardAmount * this.forwardSpeed < 0;
      this.v.addScaledVector(
        forward2,
        forwardAmount *
          P.jump.dodgeImpulse *
          (backward ? ((1 + 1.5 * ratio) * 16) / 15 : 1),
      );
      this.v.addScaledVector(
        right2,
        this.jump.direction.x * P.jump.dodgeImpulse * (1 + 0.9 * ratio),
      );
    }
    if (roofContacts && !this.recovering && input.steer) {
      // Weaker sliding steering, only about the actual support normal. No
      // alignment torque, adhesion, or pitch/roll damping is applied here.
      const target = input.steer * c.roofYawSpeed;
      this.angular.addScaledVector(
        roofNormal,
        (target - this.w.dot(roofNormal)) * c.roofYawResponse,
      );
    }
    if (this.aerialControl > 0) {
      const flipping = this.jump.flipLeft > 0;
      const cancel = input.pitch * this.jump.direction.z > 0;
      const pitchScale = Math.max(
        0,
        Math.min(
          1,
          (this.jump.flipAge - P.jump.flipTime - P.jump.pitchLockExtra) /
            P.jump.controlReturn,
        ),
      );
      // A cancel removes pitch flip torque; it never applies reverse pitch torque.
      if (!flipping || cancel) {
        this.angular
          .addScaledVector(
            this.right,
            -input.pitch * c.airPitch * pitchScale * this.aerialControl,
          )
          .addScaledVector(this.up, -input.yaw * c.airYaw * this.aerialControl)
          .addScaledVector(
            this.forward,
            input.roll * c.airRoll * this.aerialControl,
          )
          .addScaledVector(this.w, -c.airDamping * this.aerialControl);
      }
    }
    if (
      this.jump.used &&
      !this.jump.second &&
      this.jump.age < P.jump.holdTime &&
      (input.jump || this.jump.age < P.jump.stickyTime)
    ) {
      this.acceleration.addScaledVector(this.up, P.jump.holdAcceleration);
      this.jump.held = Math.min(P.jump.holdTime, this.jump.held + dt);
    }
    if (this.jump.used && this.jump.age < P.jump.stickyTime)
      this.acceleration.addScaledVector(this.up, -P.jump.sticky);
    if (this.jump.flipLeft > 0) {
      const cancel = input.pitch * this.jump.direction.z > 0;
      const cancelAmount = cancel ? Math.min(1, Math.abs(input.pitch)) : 0;
      this.flipPitchAcceleration =
        this.jump.direction.z * P.jump.flipPitchTorque * (1 - cancelAmount);
      this.angular.addScaledVector(this.right, this.flipPitchAcceleration);
      this.angular.addScaledVector(
        this.forward,
        this.jump.direction.x * P.jump.flipRollTorque,
      );
      if (cancel) {
        this.flipCancelAcceleration =
          -this.w.dot(this.right) * P.jump.cancelDamping * cancelAmount;
        this.angular.addScaledVector(this.right, this.flipCancelAcceleration);
      }
      if (
        this.jump.flipAge >= P.jump.verticalDampStart &&
        (this.v.y < 0 || this.jump.flipAge < P.jump.verticalDampEnd)
      )
        this.v.y *= Math.pow(1 - P.jump.verticalDamp120, dt * 120);
    }
    if (this.recovery > 0) {
      this.angular.addScaledVector(
        this.forward,
        50 * Math.sign(this.recoverySide),
      );
      this.recovery = Math.max(0, this.recovery - dt);
    }
    this.v.addScaledVector(this.acceleration, dt).clampLength(0, c.maxSpeed);
    b.setLinvel(this.v, true);
    this.w.addScaledVector(this.angular, dt).clampLength(0, this.angularLimit);
    b.setAngvel(this.w, true);
    this.lateralSlip = Math.abs(this.v.dot(this.right));
    this.skidIntensity =
      input.slide && (this.wheelContact[2] || this.wheelContact[3])
        ? Math.min(
            1,
            Math.max(
              0,
              (this.lateralSlip - P.skid.minSlip) /
                (P.skid.fullSlip - P.skid.minSlip),
            ),
          )
        : 0;
  }
  updateSupersonic(dt: number) {
    const speed = new Vector3().copy(this.body.linvel()).length();
    if (this.demolitionState !== "active") {
      this.supersonic = false;
      this.sonicGrace = 0;
    } else if (speed >= P.supersonic.start) {
      this.supersonic = true;
      this.sonicGrace = P.supersonic.grace;
    } else if (
      this.supersonic &&
      speed >= P.supersonic.maintain &&
      this.sonicGrace > dt
    )
      this.sonicGrace -= dt;
    else {
      this.supersonic = false;
      this.sonicGrace = 0;
    }
  }
  /** Unilateral static-surface constraint. Never removes tangential velocity or
   * attracts a separated body; Rapier still owns chassis and dynamic impacts. */
  constrainSurface(afterStep = false) {
    if (!this.body.isEnabled() || this.demolitionState !== "active") return;
    const b = this.body,
      q = new Quaternion().copy(b.rotation()),
      up = new Vector3(0, 1, 0).applyQuaternion(q),
      position = new Vector3().copy(b.translation()),
      velocity = new Vector3().copy(b.linvel()),
      correction = new Vector3();
    const initialVelocity = velocity.clone();
    const constrainPoint = (
      point: Vector3,
      normal: Vector3,
      minimum: number,
    ) => {
      b.setLinvel(velocity, true);
      const deficit =
        minimum - new Vector3().copy(b.velocityAtPoint(point)).dot(normal);
      if (deficit <= 0) return;
      const torque = point.clone().sub(b.worldCom()).cross(normal),
        m = b.effectiveWorldInvInertia();
      const response = new Vector3(
        m.m11 * torque.x + m.m12 * torque.y + m.m13 * torque.z,
        m.m12 * torque.x + m.m22 * torque.y + m.m23 * torque.z,
        m.m13 * torque.x + m.m23 * torque.y + m.m33 * torque.z,
      );
      b.applyImpulseAtPoint(
        normal
          .clone()
          .multiplyScalar(deficit / (b.invMass() + torque.dot(response))),
        point,
        true,
      );
      velocity.copy(b.linvel());
    };
    if (!afterStep) this.normalCorrectionAcceleration.set(0, 0, 0);
    if (!afterStep) {
      // Use real static contacts, including curves: being inverted in midair
      // alone must not change tire grip or add artificial drag.
      let roofContact = false;
      this.world.contactPairsWith(this.collider, (other) => {
        if (other.parent() !== null) return;
        this.world.contactPair(this.collider, other, (manifold, flipped) => {
          const normal = new Vector3()
            .copy(manifold.normal())
            .multiplyScalar(flipped ? 1 : -1);
          if (normal.dot(up) > -0.5) return;
          for (let i = 0; i < manifold.numContacts(); i++)
            if (manifold.contactDist(i) <= P.car.contactSkin * 2)
              roofContact = true;
        });
      });
      this.collider.setFriction(
        roofContact
          ? P.car.roofFriction +
              (P.car.roofSteeringFriction - P.car.roofFriction) * this.roofSteer
          : P.car.chassisFriction,
      );
    }
    if (!afterStep) {
      // Sweep each chassis corner over this step against static geometry only.
      // Rapier's hard CCD can stay inactive below its size/speed threshold;
      // these short speculative contacts prevent that sub-threshold penetration
      // without changing car-car/ball collision timing or restitution.
      const d = bodies[this.bodyId],
        angular = new Vector3().copy(b.angvel());
      const constraints: {
        point: Vector3;
        normal: Vector3;
        minimum: number;
      }[] = [];
      for (const x of [-d.halfWidth, d.halfWidth])
        for (const y of [d.hitboxY - d.halfHeight, d.hitboxY + d.halfHeight])
          for (const z of [-d.halfLength, d.halfLength]) {
            const offset = new Vector3(x, y, z).applyQuaternion(q),
              point = offset.clone().add(position);
            const rotationVelocity = new Vector3().crossVectors(
              angular,
              offset,
            );
            const travel = velocity.clone().add(rotationVelocity);
            travel.y -= P.gravity * P.dt;
            const speed = travel.length();
            if (speed < 0.01) continue;
            const hit = this.world.castRayAndGetNormal(
              new RAPIER.Ray(point, travel.multiplyScalar(1 / speed)),
              speed * P.dt + P.car.contactSkin,
              false,
              undefined,
              undefined,
              this.collider,
              b,
              (col) => col.parent() === null,
            );
            if (!hit) continue;
            const normal = new Vector3().copy(hit.normal),
              approach = -travel.dot(normal);
            if (approach <= 0) continue;
            const gap = Math.max(
              0,
              hit.timeOfImpact * approach - P.car.contactSkin,
            );
            const pointMinimum = -gap / P.dt + P.gravity * normal.y * P.dt;
            if (normal.dot(up) < -0.5 && !this.recovering) {
              constraints.push({ point, normal, minimum: pointMinimum });
            } else {
              // Keep the existing wheel-side and player recovery path intact.
              const minimum = Math.min(
                0,
                pointMinimum - rotationVelocity.dot(normal),
              );
              if (velocity.dot(normal) < minimum)
                velocity.addScaledVector(
                  normal,
                  minimum - velocity.dot(normal),
                );
            }
          }
      // Solve the complete support set, alternating order to avoid privileging
      // the front edge. The impulse includes rotational effective mass and acts
      // at the real chassis point, rather than blocking COM translation alone.
      for (let pass = 0; pass < 4; pass++) {
        const ordered = pass % 2 ? [...constraints].reverse() : constraints;
        for (const contact of ordered)
          constrainPoint(contact.point, contact.normal, contact.minimum);
      }
    }
    for (let i = 0; i < 4; i++) {
      if (this.jump.used && this.jump.age < 0.18) break;
      const origin = wheelMount(this.bodyId, i)
        .applyQuaternion(q)
        .add(position);
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray(origin, up.clone().negate()),
        P.car.contactReach,
        true,
        undefined,
        undefined,
        this.collider,
        b,
        (col) => col.parent() === null,
      );
      if (!hit) continue;
      const normal = new Vector3().copy(hit.normal),
        alignment = normal.dot(up);
      if (alignment < 0.25) continue;
      const rigidHeight = wheelClearance(
        this.world,
        position,
        q,
        this.bodyId,
        i,
        this.collider,
        b,
        i < 2 ? this.steerAngle : 0,
      );
      const ordinaryGap = (hit.timeOfImpact - P.car.contactHeight) * alignment;
      const gap =
        rigidHeight > wheelMountY
          ? Math.min(ordinaryGap, -(rigidHeight - wheelMountY) * alignment)
          : ordinaryGap;
      if (afterStep) {
        // Split positional correction: clearance error is not converted to bounce velocity.
        const depth = -gap - correction.dot(normal);
        if (depth > 0)
          correction.addScaledVector(
            normal,
            Math.min(depth, P.car.maxContactCorrection),
          );
        // A tilted body may move downward while its loaded wheel stays still:
        // that is rotation about the contact, not penetration. Clamping COM
        // descent here cancels gravity before the point constraint can produce
        // its physical settling torque on the following step.
        if (
          (this.stableContact || alignment > 0.9999) &&
          gap < P.car.contactSkin &&
          velocity.dot(normal) < 0
        )
          velocity.addScaledVector(normal, -velocity.dot(normal));
      } else {
        // Permit approach until the clearance plane; account for the next gravity step.
        const minimum = -Math.max(0, gap) / P.dt + P.gravity * normal.y * P.dt;
        if (normal.y > 0.9999 && up.y > 0.9999) {
          if (velocity.dot(normal) < minimum)
            velocity.addScaledVector(normal, minimum - velocity.dot(normal));
          continue;
        }
        const point = wheelSupportPoint(
          origin,
          q,
          normal,
          i < 2 ? this.steerAngle : 0,
        );
        b.setLinvel(velocity, true);
        const pointVelocity = new Vector3().copy(b.velocityAtPoint(point));
        const deficit = minimum - pointVelocity.dot(normal);
        if (deficit > 0) {
          const arm = point.clone().sub(b.worldCom());
          const torque = arm.clone().cross(normal),
            m = b.effectiveWorldInvInertia();
          const response = new Vector3(
            m.m11 * torque.x + m.m12 * torque.y + m.m13 * torque.z,
            m.m12 * torque.x + m.m22 * torque.y + m.m23 * torque.z,
            m.m13 * torque.x + m.m23 * torque.y + m.m33 * torque.z,
          );
          const inverseMass = b.invMass() + torque.dot(response);
          b.applyImpulseAtPoint(
            normal.multiplyScalar(deficit / inverseMass),
            point,
            true,
          );
          velocity.copy(b.linvel());
        }
      }
    }
    if (afterStep) {
      // Static chassis manifolds cover roof/side impacts too. Correct residual
      // penetration with a bounded split impulse: position only, and remove
      // inward velocity. No bounce energy or tangential damping is introduced.
      this.world.contactPairsWith(this.collider, (other) => {
        if (other.parent() !== null) return;
        this.world.contactPair(this.collider, other, (manifold, flipped) => {
          const normal = new Vector3()
            .copy(manifold.normal())
            .multiplyScalar(flipped ? 1 : -1);
          let depth = 0;
          for (let i = 0; i < manifold.numContacts(); i++)
            depth = Math.max(depth, -manifold.contactDist(i));
          const remaining = depth - correction.dot(normal);
          if (remaining > 0)
            correction.addScaledVector(
              normal,
              Math.min(remaining, P.car.maxContactCorrection),
            );
          // Rapier resolves velocity at all manifold contacts. A COM-only clamp
          // here would cancel descent/rotation about a loaded roof edge.
          if (
            (normal.dot(up) >= -0.5 || this.recovering) &&
            depth > 0 &&
            velocity.dot(normal) < 0
          )
            velocity.addScaledVector(normal, -velocity.dot(normal));
        });
      });
      // Rays from the chassis centre to its actual corners detect penetration
      // on every face, even when discrete manifold generation is one tick late.
      // Unlike wheel-up rays this covers roof/side impacts and remains active
      // during a jump. All corrections follow the actual surface normal.
      const d = bodies[this.bodyId];
      const center = new Vector3(0, d.hitboxY, 0)
        .applyQuaternion(q)
        .add(position);
      for (const x of [-d.halfWidth, d.halfWidth])
        for (const y of [d.hitboxY - d.halfHeight, d.hitboxY + d.halfHeight])
          for (const z of [-d.halfLength, d.halfLength]) {
            const point = new Vector3(x, y, z).applyQuaternion(q).add(position);
            const direction = point.clone().sub(center),
              length = direction.length();
            direction.normalize();
            const hit = this.world.castRayAndGetNormal(
              new RAPIER.Ray(center, direction),
              length + P.car.contactSkin,
              false,
              undefined,
              undefined,
              this.collider,
              b,
              (col) => col.parent() === null,
            );
            if (!hit) continue;
            const normal = new Vector3().copy(hit.normal),
              alignment = -normal.dot(direction);
            if (alignment < 0.01) continue;
            const depth =
              (length - hit.timeOfImpact) * alignment +
              P.car.contactSkin -
              correction.dot(normal);
            if (depth > 0) correction.addScaledVector(normal, depth);
            if (normal.dot(up) < -0.5 && !this.recovering) {
              if (depth > 0) constrainPoint(point, normal, 0);
            } else if (velocity.dot(normal) < 0)
              velocity.addScaledVector(normal, -velocity.dot(normal));
          }
    }
    if (afterStep && correction.lengthSq() > 0) {
      correction.clampLength(0, P.car.maxContactCorrection);
      b.setTranslation(position.add(correction), true);
    }
    if (afterStep) this.contactCorrection.copy(correction);
    this.normalCorrectionAcceleration.add(
      velocity
        .clone()
        .sub(initialVelocity)
        .multiplyScalar(1 / P.dt),
    );
    b.setLinvel(velocity, true);
  }
}
