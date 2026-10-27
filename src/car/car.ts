import {
  captureValues,
  restoreValues,
  type CarPredictionState,
} from "../../shared/prediction";
import { LandingContact } from "./landing";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { RUMBLE_CONFIG } from "../config/rumble";
import {
  P,
  DRIVE_SPEED_CURVE,
  LATERAL_FRICTION_CURVE,
  NON_STICKY_FRICTION_CURVE,
  lookup,
  powerslideSteerAngle,
  steerAngle,
} from "../config/physics";
import type { PlayerInput } from "../../shared/player";
import type { MatchPhysics } from "../config/mutators";
import {
  DEFAULT_MUTATORS,
  MUTATOR_TUNING as M,
  type MatchMutators,
} from "../../shared/mutators";
import { JumpState } from "./dodge";
import { Pose } from "../physics/pose";
import { chassisShape } from "./chassis";
import { ChassisGuard } from "./chassis-guard";
import { bodies, type BodyId } from "../game/inventory";
import {
  WheelState,
  castWheel,
  suspensionSurface,
  vehicleGeometry,
  type VehicleGeometry,
} from "./suspension";
const predictionKeys = [
  "sonicGrace",
  "lateralSlip",
  "skidIntensity",
  "impactTime",
  "boost",
  "boostRechargeDelay",
  "boostingTime",
  "supersonic",
  "boosting",
  "lastJump",
  "grounded",
  "jumpSupported",
  "contacts",
  "stableContact",
  "supportContacts",
  "wheelSupport",
  "supportKind",
  "chassisContacts",
  "forwardSpeed",
  "steerAngle",
  "handbrake",
  "recovery",
  "recoverySide",
  "recoveryHeld",
  "recoveryCooldown",
  "contactState",
  "aerialControl",
  "normalReady",
  "normalJumpSequence",
  "normalJumpAge",
  "flipResetSequence",
  "flipResetAge",
  "grapplePulling",
] as const;
const predictionVectors = [
  "normal",
  "recoveryAxis",
  "recoveryNormal",
  "normalJumpOrigin",
  "normalJumpNormal",
  "flipResetOrigin",
  "flipResetNormal",
] as const;
type ContactState = "AIRBORNE" | "PARTIAL_CONTACT" | "GROUNDED";

/** RL-style vehicle: four raycast spring/damper wheels, per-wheel tire impulses,
 * sticky force, RL jump/dodge and per-axis air control. The rigid chassis is a
 * normal Rapier body; every vehicle force is an impulse applied before the step. */
export class Car {
  physics: MatchPhysics = P;
  mutators: MatchMutators = DEFAULT_MUTATORS;
  infiniteBoost = false;
  boostRechargeDelay = 0;
  applyBoostRule(dt = 0, held = false) {
    const waiting = this.boostRechargeDelay;
    this.boostRechargeDelay = held
      ? M.rechargeDelay
      : Math.max(0, waiting - dt);
    const mode = this.mutators.boostAmount;
    if (this.infiniteBoost) this.boost = 100;
    else if (mode === "NO BOOST") this.boost = 0;
    else if (mode === "UNLIMITED") this.boost = 100;
    else if (!held && (mode === "RECHARGE SLOW" || mode === "RECHARGE FAST"))
      this.boost = Math.min(
        100,
        this.boost + M.recharge[mode] * Math.max(0, dt - waiting),
      );
  }
  id = "";
  team = 0;
  displayName = "Guest";
  demolitionState: "active" | "demolished" | "respawning" = "active";
  respawnTimer = 0;
  supersonic = false;
  private sonicGrace = 0;
  lateralSlip = 0;
  skidIntensity = 0;
  readonly landing = new LandingContact();
  impactTime = 0;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pose: Pose;
  jump = new JumpState();
  boost = 100;
  boostingTime = 0;
  forward = new Vector3();
  right = new Vector3();
  up = new Vector3();
  /** Average contact normal of the touching wheels (car up when airborne). */
  normal = new Vector3(0, 1, 0);
  teleportSequence = 0;
  grapplePulling = false;
  /** Three or four coherent wheel contacts (RL "on ground"). */
  grounded = false;
  jumpSupported = false;
  /** Wheels whose ray currently touches a static surface. */
  contacts = 0;
  stableContact = false;
  get supportState(): ContactState {
    return this.grounded
      ? "GROUNDED"
      : this.contacts > 0 || this.chassisContacts > 0
        ? "PARTIAL_CONTACT"
        : "AIRBORNE";
  }
  get surfaceType() {
    return this.normal.y > 0.55
      ? "FLOOR"
      : this.normal.y < -0.55
        ? "CEILING"
        : "WALL";
  }
  /** Coherent wheel contacts (normals agreeing with the average). */
  supportContacts = 0;
  /** Fraction of tire load available: coherent wheels / 4. */
  wheelSupport = 0;
  supportKind: "wheel" | "partial" | "edge" | "chassis" | "air" = "air";
  chassisContacts = 0;
  /** Retained for diagnostics compatibility; the shoulder-probe hack is gone. */
  edgeContacts = 0;
  edgeDriveForce = new Vector3();
  forwardSpeed = 0;
  boosting = false;
  lastJump = false;
  normalJumpSequence = 0;
  normalJumpAge = Infinity;
  normalJumpOrigin = new Vector3();
  normalJumpNormal = new Vector3(0, 1, 0);
  bodyId: BodyId = "ion";
  /** Front-wheel steering angle (radians, positive = left), for physics and visuals. */
  steerAngle = 0;
  handbrake = 0;
  /** Geometric path curvature of the steered front axle (1/m). */
  steeringCurvature = 0;
  /** Measured yaw rate about the contact normal divided by forward speed (1/m). */
  turnCurvature = 0;
  private recovery = 0;
  private recoverySide = 1;
  private recoveryHeld = false;
  private recoveryAxis = new Vector3();
  private recoveryNormal = new Vector3(0, 1, 0);
  private recoveryCooldown = 0;
  contactState: "surface" | "transition" | "air" = "air";
  aerialControl = 1;
  /** RL auto-roll applied this tick (resting on a side/nose with throttle). */
  autoRolling = false;
  get recovering() {
    return this.recovery > 0;
  }
  /** RL caps angular speed at 5.5 rad/s. A wheel-supported car following a
   * curved transition may add the surface's own turn rate on top, so a tight
   * Dropshot/Hoops curve at supersonic speed is followed rather than rammed. */
  get angularLimit() {
    // An active flip may spin faster than the ordinary cap; it returns once the torque window ends.
    const cap =
      this.jump.flipLeft > 0
        ? Math.max(this.physics.car.maxAngular, P.jump.flipMaxAngular)
        : this.physics.car.maxAngular;
    return cap + (this.contacts >= 1 ? this.surfaceTurn.length() : 0);
  }
  readonly wheels = Array.from({ length: 4 }, () => new WheelState());
  geometry: VehicleGeometry = vehicleGeometry("ion");
  wheelOrigins = Array.from({ length: 4 }, () => new Vector3());
  wheelHits = Array.from({ length: 4 }, () => new Vector3());
  wheelContact = [false, false, false, false];
  wheelNormals = Array.from({ length: 4 }, () => new Vector3());
  /** Sticky-force acceleration applied this tick (m/s²). */
  adhesionAcceleration = new Vector3();
  /** Positional correction applied this tick (m): bump stop (split mode) and chassis guard. */
  contactCorrection = new Vector3();
  /** Net suspension acceleration applied this tick (m/s²). */
  normalCorrectionAcceleration = new Vector3();
  /** World-space centre of mass at the start of the last tick. */
  readonly centerOfMass = new Vector3();
  pitchInput = 0;
  flipPitchAcceleration = 0;
  flipCancelAcceleration = 0;
  flipResetSequence = 0;
  flipResetAge = Infinity;
  readonly flipResetOrigin = new Vector3();
  readonly flipResetNormal = new Vector3(0, 1, 0);
  acquireFlipReset(point: Vector3, normal: Vector3) {
    this.jump.acquireReset();
    this.flipResetSequence++;
    this.flipResetAge = 0;
    this.flipResetOrigin.copy(point);
    this.flipResetNormal.copy(normal);
  }
  get pitchLocked() {
    return (
      !this.jump.stall &&
      Number.isFinite(this.jump.flipAge) &&
      this.jump.flipAge < P.jump.flipTime + P.jump.pitchLockExtra
    );
  }
  private q = new Quaternion();
  private v = new Vector3();
  private w = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private position = new Vector3();
  private com = new Vector3();
  private acceleration = new Vector3();
  private angular = new Vector3();
  private normalReady = false;
  private surfaceTurn = new Vector3();
  private previousNormal = new Vector3(0, 1, 0);
  private invInertia = [0, 0, 0, 0, 0, 0];
  private invMass = 1 / P.car.mass;
  private chassisNormal = new Vector3();
  private applyPoint = new Vector3();
  private axle = new Vector3();
  private wheelForward = new Vector3();
  private arm = new Vector3();
  private pointVelocity = new Vector3();
  private impulse = new Vector3();
  private suspensionStart = new Vector3();
  private positionCorrection = new Vector3();
  private guard = new ChassisGuard();
  constructor(public world: RAPIER.World) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true),
    );
    this.collider = world.createCollider(
      chassisShape(this.bodyId)
        .setTranslation(0, this.physics.car.hitboxY, 0)
        .setFriction(this.physics.car.chassisFriction)
        .setContactSkin(this.physics.car.contactSkin)
        .setRestitution(this.physics.car.chassisRestitution),
      this.body,
    );
    this.setBody(this.bodyId);
    this.pose = new Pose(this.body);
    this.reset(0, 25, 0);
  }
  clearSurfaceHistory() {
    this.landing.reset();
    this.contacts = this.supportContacts = 0;
    this.grounded = this.stableContact = this.normalReady = false;
    this.jumpSupported = false;
    this.wheelSupport = 0;
    this.contactState = "air";
    this.supportKind = "air";
    this.wheelContact.fill(false);
    this.wheels.forEach((w) => w.clear());
    this.surfaceTurn.set(0, 0, 0);
  }
  reset(x: number, z: number, yaw: number, y = 0.36) {
    this.demolitionState = "active";
    this.respawnTimer = 0;
    this.supersonic = false;
    this.sonicGrace = 0;
    this.clearSurfaceHistory();
    this.lateralSlip = this.skidIntensity = 0;
    this.handbrake = 0;
    this.recovery = 0;
    this.recoveryHeld = false;
    this.recoveryCooldown = 0;
    this.aerialControl = 1;
    this.chassisContacts = this.edgeContacts = 0;
    this.edgeDriveForce.set(0, 0, 0);
    this.wheelNormals.forEach((n) => n.set(0, 0, 0));
    this.adhesionAcceleration.set(0, 0, 0);
    this.contactCorrection.set(0, 0, 0);
    this.normalCorrectionAcceleration.set(0, 0, 0);
    this.pitchInput =
      this.flipPitchAcceleration =
      this.flipCancelAcceleration =
        0;
    this.steeringCurvature = this.turnCurvature = 0;
    this.impactTime = 0;
    this.boosting = false;
    this.boostingTime = 0;
    this.boostRechargeDelay = 0;
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
    this.flipResetSequence = 0;
    this.flipResetAge = Infinity;
    this.jump.wasDown = false;
    this.boost = 100;
    this.normal.set(0, 1, 0);
    this.previousNormal.set(0, 1, 0);
    this.pose.snap();
  }
  /** Network checkpoint only; the same forces and contact solver run on host and predictor. */
  capturePrediction(): CarPredictionState {
    return {
      values: captureValues(this, predictionKeys),
      vectors: predictionVectors.map((k) => ({ ...this[k] })),
      jump: this.jump.predictionValues(),
      direction: { ...this.jump.direction },
      landing: this.landing.predictionValues(),
    };
  }
  restorePrediction(state: CarPredictionState) {
    restoreValues(this, predictionKeys, state.values);
    if (state.vectors.length === predictionVectors.length)
      predictionVectors.forEach((k, i) => this[k].copy(state.vectors[i]));
    this.previousNormal.copy(this.normal);
    this.jump.restorePrediction(state.jump);
    this.jump.direction.copy(state.direction);
    this.landing.restorePrediction(state.landing);
  }
  setBody(id: BodyId) {
    this.bodyId = id;
    this.geometry = vehicleGeometry(id);
    const g = this.geometry,
      offset = bodies[id].hitboxY;
    this.collider.setShape(chassisShape(id).shape);
    this.collider.setTranslationWrtParent({ x: 0, y: offset, z: 0 });
    // Collider-local COM; the collider itself sits at the hitbox offset.
    this.collider.setMassProperties(
      this.physics.car.mass,
      { x: g.com.x, y: g.com.y - offset, z: g.com.z },
      g.inertia,
      { x: 0, y: 0, z: 0, w: 1 },
    );
    this.body.recomputeMassPropertiesFromColliders();
    this.invMass = 1 / this.physics.car.mass;
  }
  /** Countdown changes only the displayed steering rack, never rigid-body state. */
  steerAtKickoff(input: PlayerInput) {
    this.steerAngle = -input.steer * steerAngle(0);
  }
  /** World inverse inertia (symmetric 3×3: xx, xy, xz, yy, yz, zz). */
  private readInverseInertia() {
    const m = this.body.effectiveWorldInvInertia();
    const I = this.invInertia;
    I[0] = m.m11;
    I[1] = m.m12;
    I[2] = m.m13;
    I[3] = m.m22;
    I[4] = m.m23;
    I[5] = m.m33;
  }
  private inertiaTimes(v: Vector3, out: Vector3) {
    const I = this.invInertia;
    return out.set(
      I[0] * v.x + I[1] * v.y + I[2] * v.z,
      I[1] * v.x + I[3] * v.y + I[4] * v.z,
      I[2] * v.x + I[4] * v.y + I[5] * v.z,
    );
  }
  /** Effective mass of the chassis at an arm, along a direction. */
  private effectiveMass(arm: Vector3, direction: Vector3) {
    const r = this.tmp.crossVectors(arm, direction);
    const ir = this.inertiaTimes(r, this.tmp2);
    return 1 / (this.invMass + r.dot(ir));
  }
  /** Velocity of the chassis at a world point. */
  private velocityAt(point: Vector3, out: Vector3) {
    this.arm.subVectors(point, this.com);
    return out.crossVectors(this.w, this.arm).add(this.v);
  }
  /** Apply an impulse at a world point to the local velocity copies. */
  private impulseAt(impulse: Vector3, point: Vector3) {
    this.v.addScaledVector(impulse, this.invMass);
    this.arm.subVectors(point, this.com);
    this.w.add(
      this.inertiaTimes(this.tmp.crossVectors(this.arm, impulse), this.tmp2),
    );
  }
  tick(input: PlayerInput) {
    // A disabled body reports zero inverse mass; never integrate it.
    if (this.demolitionState !== "active" || !this.body.isEnabled()) return;
    this.normalJumpAge += P.dt;
    this.impactTime = Math.max(0, this.impactTime - P.dt);
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - P.dt);
    const dt = P.dt,
      c = this.physics.car,
      tire = P.tire,
      b = this.body,
      g = this.geometry,
      gravity = this.physics.gravity;
    this.q.copy(b.rotation());
    this.v.copy(b.linvel());
    this.w.copy(b.angvel());
    this.position.copy(b.translation());
    this.com.copy(b.worldCom());
    this.centerOfMass.copy(this.com);
    this.invMass = b.invMass() || 1 / this.physics.car.mass;
    this.readInverseInertia();
    this.forward.set(0, 0, -1).applyQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.forwardSpeed = this.v.dot(this.forward);
    const speed = Math.abs(this.forwardSpeed);
    this.acceleration.set(0, 0, 0);
    this.adhesionAcceleration.set(0, 0, 0);
    this.normalCorrectionAcceleration.set(0, 0, 0);
    this.contactCorrection.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.pitchInput = input.pitch;
    this.flipPitchAcceleration = this.flipCancelAcceleration = 0;
    this.handbrake = Math.max(
      0,
      Math.min(
        1,
        this.handbrake +
          (input.slide ? P.powerslide.rise : -P.powerslide.fall) * dt,
      ),
    );

    // ---- Wheel rays and contact classification -------------------------
    this.contacts = 0;
    this.normal.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const hit = castWheel(
        this.world,
        wheel,
        this.bodyId,
        i,
        this.position,
        this.q,
        this.up,
        g,
        this.collider,
        b,
      );
      this.wheelOrigins[i].copy(wheel.hardpoint);
      this.wheelHits[i].copy(wheel.point);
      // The ray reaches past full extension so the damper engages early, as in
      // RL; only a tire near its rest length actually touches the surface.
      wheel.loaded = hit && wheel.length <= g.restLength + c.loadedTravel;
      this.wheelContact[i] = wheel.loaded;
      if (wheel.loaded) {
        this.contacts++;
        this.normal.add(wheel.normal);
        this.wheelNormals[i].copy(wheel.normal);
      } else this.wheelNormals[i].set(0, 0, 0);
    }
    if (this.contacts) this.normal.normalize();
    else this.normal.copy(this.up);
    this.supportContacts = 0;
    for (let i = 0; i < 4; i++)
      if (
        this.wheelContact[i] &&
        this.wheels[i].normal.dot(this.normal) >= c.coherentNormal
      )
        this.supportContacts++;
    this.grounded = this.supportContacts >= c.groundedWheels;
    this.stableContact = this.jumpSupported = this.grounded;
    // The surface frame's own rotation lets a car follow a curved transition.
    this.surfaceTurn
      .copy(this.previousNormal)
      .cross(this.normal)
      .multiplyScalar(this.normalReady && this.contacts ? 1 / dt : 0)
      .clampLength(0, 12);
    this.previousNormal.copy(this.normal);
    this.normalReady = this.contacts > 0;

    // Static chassis contacts (roof, side, nose) are world contact, never support.
    this.chassisContacts = 0;
    this.chassisNormal.set(0, 0, 0);
    this.world.contactPairsWith(this.collider, (other) => {
      if (!suspensionSurface(other)) return;
      this.world.contactPair(this.collider, other, (manifold, flipped) => {
        let touching = 0;
        for (let i = 0; i < manifold.numContacts(); i++)
          if (manifold.contactDist(i) <= c.contactSkin * 2) touching++;
        if (!touching) return;
        this.chassisContacts += touching;
        const n = manifold.normal();
        const s = flipped ? 1 : -1;
        this.chassisNormal.x += n.x * s * touching;
        this.chassisNormal.y += n.y * s * touching;
        this.chassisNormal.z += n.z * s * touching;
      });
    });
    if (this.chassisContacts) this.chassisNormal.normalize();
    this.supportKind = this.grounded
      ? "wheel"
      : this.contacts
        ? "partial"
        : this.chassisContacts
          ? "chassis"
          : "air";
    const leavingByJump = this.jump.used && this.jump.age < 0.18;
    this.contactState = this.grounded
      ? "surface"
      : this.contacts || this.chassisContacts
        ? "transition"
        : "air";
    this.aerialControl = this.grounded || this.recovering ? 0 : 1;

    // ---- Boost (RL: minimum 0.1 s burst) --------------------------------
    this.applyBoostRule(dt, input.boost);
    const hasBoost = this.boost > 0;
    this.boosting =
      hasBoost &&
      (input.boost ||
        (this.boosting && this.boostingTime + 1e-9 < c.boostMinTime));
    this.boostingTime = this.boosting ? this.boostingTime + dt : 0;
    const realThrottle = this.boosting ? 1 : input.throttle;

    // ---- Throttle / brake (RL drive logic) ------------------------------
    let engineThrottle = realThrottle,
      realBrake = 0;
    if (!input.slide) {
      if (Math.abs(realThrottle) >= tire.throttleDeadzone) {
        if (
          speed > tire.stopSpeed &&
          Math.sign(realThrottle) !== Math.sign(this.forwardSpeed)
        ) {
          realBrake = 1;
          engineThrottle = 0;
        }
      } else {
        engineThrottle = 0;
        realBrake = speed < tire.stopSpeed ? 1 : tire.coastBrake;
      }
    }
    const driveScale =
      lookup(speed, DRIVE_SPEED_CURVE) *
      (this.contacts < 3 ? tire.partialEngine : 1);
    const engineAccel = engineThrottle * tire.engine * driveScale;
    const brakeAccel = realBrake * tire.brake;

    // ---- Steering: RL speed-dependent wheel angle -----------------------
    const wheelAngle =
      steerAngle(speed) +
      (powerslideSteerAngle(speed) - steerAngle(speed)) * this.handbrake;
    this.steerAngle = -input.steer * wheelAngle;
    this.steeringCurvature = Math.tan(-this.steerAngle) / g.wheelbase;

    // ---- Per-wheel tire impulses from the pre-impulse state -------------
    const tireLoad = this.grapplePulling ? RUMBLE_CONFIG.grapple.tireLoad : 1;
    const partialGrip = this.grounded
      ? 1
      : c.partialGrip[this.contacts] *
        lookup(this.normal.y, NON_STICKY_FRICTION_CURVE);
    this.wheelSupport = this.grounded ? 1 : (this.contacts / 4) * partialGrip;
    const impact = this.impactTime > 0 ? 0.3 : 1;
    const mass = 1 / this.invMass;
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      wheel.impulse.set(0, 0, 0);
      wheel.steer = i < 2 ? this.steerAngle : 0;
      if (!wheel.contact) continue;
      const n = wheel.normal;
      this.axle
        .set(Math.cos(wheel.steer), 0, -Math.sin(wheel.steer))
        .applyQuaternion(this.q);
      this.axle.addScaledVector(n, -this.axle.dot(n));
      if (this.axle.lengthSq() < 1e-8) continue;
      this.axle.normalize();
      this.wheelForward.crossVectors(n, this.axle).normalize();
      // Slip ratio from the hardpoint velocity, as RL does.
      this.velocityAt(wheel.hardpoint, this.pointVelocity);
      const lateralHard = Math.abs(this.pointVelocity.dot(this.axle));
      wheel.slip =
        lateralHard > tire.slipDeadband
          ? lateralHard /
            (Math.abs(this.pointVelocity.dot(this.wheelForward)) + lateralHard)
          : 0;
      let lateral = lookup(wheel.slip, LATERAL_FRICTION_CURVE),
        longitudinal = 1;
      if (this.handbrake > 0) {
        lateral *= (P.powerslide.lateralFactor - 1) * this.handbrake + 1;
        longitudinal =
          (P.powerslide.longitudinalAtForward +
            (P.powerslide.longitudinalAtSideways -
              P.powerslide.longitudinalAtForward) *
              wheel.slip -
            1) *
            this.handbrake +
          1;
      }
      if (realThrottle === 0) {
        // RL: an unpowered tire on a wall keeps only a tenth of its grip.
        const scale = lookup(n.y, NON_STICKY_FRICTION_CURVE);
        lateral *= scale;
        longitudinal *= scale;
      }
      wheel.lateralFriction = lateral;
      wheel.longitudinalFriction = longitudinal;
      this.velocityAt(wheel.point, this.pointVelocity);
      this.arm.subVectors(wheel.point, this.com);
      const lateralMass = this.effectiveMass(this.arm, this.axle);
      const side =
        -tire.lateral *
        this.pointVelocity.dot(this.axle) *
        lateralMass *
        lateral *
        partialGrip *
        tireLoad *
        impact;
      let drive = 0;
      if (engineAccel !== 0) drive = engineAccel * mass * dt * longitudinal;
      else if (brakeAccel > 0) {
        const limit = brakeAccel * mass * dt;
        drive =
          Math.max(
            -limit,
            Math.min(
              limit,
              -this.pointVelocity.dot(this.wheelForward) * tire.brakeStop * mass,
            ),
          ) * longitudinal;
      }
      wheel.impulse
        .copy(this.axle)
        .multiplyScalar(side)
        .addScaledVector(this.wheelForward, drive * tireLoad);
    }

    // ---- Landing stabilization: coherent 3-4 wheel touchdown only -------
    // A real wheels-down landing (nearly aligned, settling, no flip torque or
    // strong player rotation) briefly damps pitch/roll spin that tilts the car
    // AWAY from the surface. Rotation the suspension uses to level the car is
    // never resisted, and nothing pushes toward a pose: no upright torque, never
    // in the air and never for partial, nose, side or roof contact.
    const landingInput =
      Math.max(
        Math.abs(input.pitch),
        Math.abs(input.yaw),
        Math.abs(input.roll),
      ) > 0.5;
    let descending = false;
    for (const wheel of this.wheels)
      if (
        wheel.contact &&
        wheel.normal.dot(this.velocityAt(wheel.point, this.pointVelocity)) <=
          0.05
      )
        descending = true;
    const validLanding =
      this.grounded &&
      this.up.dot(this.normal) >= c.landingAlignment &&
      this.jump.flipLeft === 0 &&
      !this.recovering &&
      !leavingByJump &&
      !landingInput &&
      this.impactTime === 0 &&
      this.w.length() < c.landingMaxAngular;
    const landingGain = this.landing.step(
      this.contacts === 0 && this.chassisContacts === 0,
      validLanding,
      dt,
      c.landingDamping,
      c.landingDampingTime,
      descending,
      c.landingMinAir,
      this.chassisContacts === 0 &&
        this.up.dot(this.normal) >= c.landingFirstContact,
    );

    // ---- Suspension: spring, asymmetric damper and bump stop ------------
    const s = P.suspension;
    this.suspensionStart.copy(this.v);
    this.positionCorrection.set(0, 0, 0);
    // RL splits the bump stop by four, assuming all four wheels share it; on
    // a ramp entry only the leading pair is engaged, so split among the
    // wheels whose rays touch (identical for an ordinary 4-wheel landing).
    let rayContacts = 0;
    for (const wheel of this.wheels) if (wheel.contact) rayContacts++;
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      if (!wheel.contact) continue;
      const n = wheel.normal;
      const denominator = n.dot(this.up);
      this.velocityAt(wheel.point, this.pointVelocity);
      const projected = n.dot(this.pointVelocity);
      const inverse = 1 / Math.max(denominator, s.minContactDot);
      wheel.velocity = projected * inverse;
      wheel.springForce =
        s.stiffness * (g.restLength - wheel.length) * inverse;
      wheel.damperForce =
        (wheel.velocity < 0 ? s.compressionDamping : s.relaxationDamping) *
        wheel.velocity;
      // Per unit sprung mass → newtons. RL never pulls a wheel down.
      wheel.force = Math.max(
        0,
        (wheel.springForce - wheel.damperForce) * g.shares[i] * mass,
      );
      wheel.pushback = 0;
      if (wheel.distance < g.bumpStop) {
        // Bump stop: an inelastic stop of the wheel's approach. Its depth is
        // corrected positionally (split impulse) so the stop never converts
        // penetration into rebound velocity.
        this.arm.subVectors(wheel.point, this.com);
        const normalMass = this.effectiveMass(this.arm, n);
        const depth = g.bumpStop - wheel.distance;
        wheel.pushback =
          Math.max(
            0,
            ((s.splitPushback ? 0 : (s.pushbackErp * depth) / dt) -
              projected) *
              normalMass,
          ) / rayContacts;
        if (s.splitPushback)
          this.positionCorrection.addScaledVector(
            n,
            (s.pushbackErp * depth) / rayContacts,
          );
      }
    }
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      // RL applies the bump stop only with the suspension force: a wheel
      // rebounding fast enough to clamp its force to zero gets no pushback.
      if (!wheel.contact || wheel.force === 0) continue;
      const amount = wheel.force * dt + wheel.pushback;
      if (amount > 0)
        this.impulseAt(
          this.impulse.copy(wheel.normal).multiplyScalar(amount),
          wheel.point,
        );
    }
    this.normalCorrectionAcceleration
      .copy(this.v)
      .sub(this.suspensionStart)
      .multiplyScalar(1 / dt);
    // Friction impulses act at the contact point projected to the COM plane
    // (RL's roll-influence fix): grip yaws the car but never rolls/pitches it.
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      if (!wheel.contact || wheel.impulse.lengthSq() === 0) continue;
      this.arm.subVectors(wheel.point, this.com);
      this.applyPoint
        .copy(wheel.point)
        .addScaledVector(this.up, -this.arm.dot(this.up));
      this.impulseAt(wheel.impulse, this.applyPoint);
    }

    // ---- Sticky force (RL), weakened for one or two wheel contacts ------
    if (this.contacts) {
      const fullStick =
        realThrottle !== 0 || speed > tire.stopSpeed ? 1 : 0;
      const scale =
        P.sticky.base +
        fullStick * P.sticky.driving * (1 - Math.abs(this.normal.y));
      const support = this.grounded ? 1 : c.partialSticky[this.contacts];
      this.adhesionAcceleration
        .copy(this.normal)
        .multiplyScalar(-scale * gravity * support * tireLoad);
      this.acceleration.add(this.adhesionAcceleration);
    }

    // ---- Roof recovery (RL auto-flip equivalent) -----------------------
    const recoveryInput =
      Math.abs(input.throttle) > c.recoveryInputThreshold ||
      (input.jump && !this.recoveryHeld);
    this.recoveryHeld = input.jump;
    if (
      !this.grounded &&
      !this.contacts &&
      recoveryInput &&
      this.recoveryCooldown === 0 &&
      this.recovery === 0
    ) {
      const d = bodies[this.bodyId].halfHeight + bodies[this.bodyId].hitboxY;
      const support = this.world.castRayAndGetNormal(
        new RAPIER.Ray(this.position, this.up),
        d + 0.13,
        true,
        undefined,
        undefined,
        this.collider,
        b,
        suspensionSurface,
      );
      if (support && this.up.dot(this.tmp.copy(support.normal)) < -0.65) {
        this.recovery = c.recoveryDuration;
        this.recoveryCooldown = c.recoveryCooldown;
        this.recoverySide =
          input.roll ||
          input.steer ||
          (this.right.dot(this.tmp.copy(support.normal)) >= 0 ? 1 : -1);
        this.recoveryNormal.copy(support.normal);
        this.recoveryAxis
          .copy(this.forward)
          .multiplyScalar(Math.sign(this.recoverySide));
        if (
          this.recoveryAxis.dot(
            this.tmp.copy(this.up).cross(this.recoveryNormal),
          ) < -0.01
        )
          this.recoveryAxis.negate();
        this.v.addScaledVector(this.recoveryNormal, c.recoveryHop);
      }
    }

    // ---- RL auto-roll, only for a car resting on its side ---------------
    this.autoRolling = false;
    if (
      input.throttle !== 0 &&
      !this.grounded &&
      !this.recovering &&
      (this.contacts > 0 || this.chassisContacts > 0) &&
      this.v.length() < c.autoRollMaxSpeed &&
      this.w.length() < c.autoRollMaxAngular &&
      !leavingByJump
    ) {
      const groundUp = this.contacts ? this.normal : this.chassisNormal;
      if (groundUp.lengthSq() > 0.5) {
        const crossRight = this.tmp.crossVectors(this.forward, groundUp);
        const crossForward = this.tmp2.crossVectors(groundUp, crossRight);
        const rightFactor =
          1 - Math.max(0, Math.min(1, this.right.dot(crossRight)));
        const forwardFactor =
          1 - Math.max(0, Math.min(1, this.forward.dot(crossForward)));
        this.angular
          .addScaledVector(
            this.forward,
            (this.right.dot(groundUp) >= 0 ? 1 : -1) *
              rightFactor *
              c.autoRollTorque,
          )
          .addScaledVector(
            this.right,
            (this.forward.dot(groundUp) >= 0 ? -1 : 1) *
              forwardFactor *
              c.autoRollTorque,
          );
        this.acceleration.addScaledVector(groundUp, -c.autoRollForce);
        this.autoRolling = true;
      }
    }

    // ---- Boost and air throttle -----------------------------------------
    if (this.boosting) {
      this.acceleration.addScaledVector(
        this.forward,
        this.grounded ? c.boostGround : c.boostAir,
      );
      if (!this.infiniteBoost && this.mutators.boostAmount !== "UNLIMITED")
        this.boost = Math.max(0, this.boost - c.boostUse * dt);
    }
    if (!this.grounded && input.throttle !== 0)
      this.acceleration.addScaledVector(
        this.forward,
        input.throttle * (input.throttle >= 0 ? c.airThrottle : c.airReverse),
      );

    // ---- Jump, double jump and dodge -----------------------------------
    this.flipResetAge += dt;
    const action = this.jump.step(
      this.recovering ? { ...input, jump: false } : input,
      this.grounded,
      dt,
    );
    if (this.recovering) this.jump.wasDown = input.jump;
    this.lastJump = action !== null;
    if (action === "double") {
      this.normalJumpSequence++;
      this.normalJumpAge = 0;
      this.normalJumpNormal.copy(this.up);
      this.normalJumpOrigin
        .copy(this.position)
        .addScaledVector(this.up, -c.contactHeight)
        .addScaledVector(this.normal, 0.06);
    }
    if (action === "first" || action === "double")
      this.v.addScaledVector(this.up, P.jump.impulse);
    if (action === "dodge") {
      const ratio = speed / c.maxSpeed;
      const forward2 = this.forward.clone().setY(0);
      if (forward2.lengthSq() < 0.001) forward2.set(0, 0, -1);
      forward2.normalize();
      const right2 = new Vector3(-forward2.z, 0, forward2.x);
      const forwardAmount = -this.jump.direction.z;
      const backward =
        speed < 1
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
    // RL held jump: minimum 0.025 s (at 62% force), then while held up to 0.2 s.
    if (this.jump.holding) {
      if (
        !this.jump.second &&
        !this.jump.resetAvailable &&
        (this.jump.age < P.jump.minTime ||
          (input.jump && this.jump.age < P.jump.holdTime))
      ) {
        this.acceleration.addScaledVector(
          this.up,
          P.jump.holdAcceleration *
            (this.jump.age < P.jump.minTime ? P.jump.minTimeScale : 1),
        );
        this.jump.held = Math.min(P.jump.holdTime, this.jump.held + dt);
      } else this.jump.holding = false;
    }

    // ---- Air control (RL per-axis torque and damping) -------------------
    if (!this.grounded && !this.recovering) {
      const flipping = this.jump.flipLeft > 0;
      const cancel = flipping && input.pitch * this.jump.direction.z > 0;
      const pitchScale = this.jump.stall
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (this.jump.flipAge - P.jump.flipTime - P.jump.pitchLockExtra) /
                P.jump.controlReturn,
            ),
          );
      // A flip cancel removes the pitch flip torque; it never reverses it.
      if (!flipping || cancel) {
        const pitch = input.pitch * pitchScale,
          yaw = this.jump.stallChordHeld ? 0 : input.yaw,
          roll = this.jump.stallChordHeld
            ? input.roll - (input.directionalRoll ?? 0)
            : input.roll;
        this.angular
          .addScaledVector(this.right, -pitch * c.airPitch)
          .addScaledVector(this.up, -yaw * c.airYaw)
          .addScaledVector(this.forward, roll * c.airRoll);
        // RL damping in true air only: partial wheel contact keeps the player's
        // torque but never adds a hidden stabilizing damper.
        if (!this.contacts && !this.chassisContacts) {
          const dampPitch =
            this.w.dot(this.right) * c.airPitchDamping * (1 - Math.abs(pitch));
          const dampYaw =
            this.w.dot(this.up) * c.airYawDamping * (1 - Math.abs(yaw));
          const dampRoll = this.w.dot(this.forward) * c.airRollDamping;
          this.angular
            .addScaledVector(this.right, -dampPitch)
            .addScaledVector(this.up, -dampYaw)
            .addScaledVector(this.forward, -dampRoll);
          if (cancel) this.flipCancelAcceleration = -dampPitch;
        }
      }
    }
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
    }
    if (this.jump.verticalDampingActive) {
      if (
        this.jump.flipAge >= P.jump.verticalDampStart &&
        (this.v.y < 0 || this.jump.flipAge < P.jump.verticalDampEnd)
      )
        this.v.y *= Math.pow(1 - P.jump.verticalDamp120, dt * 120);
    }
    if (this.recovery > 0) {
      const angle = Math.acos(
        Math.max(-1, Math.min(1, this.up.dot(this.recoveryNormal))),
      );
      const passed =
        this.recoveryAxis.dot(
          this.tmp.copy(this.up).cross(this.recoveryNormal),
        ) < -0.01;
      const target =
        angle < c.recoveryStopAngle || passed
          ? 0
          : Math.min(
              c.recoveryMaxSpeed,
              Math.sqrt(2 * c.recoveryBraking * angle),
            );
      const rate = this.w.dot(this.recoveryAxis);
      const acceleration = Math.max(
        -c.recoveryAcceleration,
        Math.min(c.recoveryAcceleration, (target - rate) * c.recoveryResponse),
      );
      this.angular.addScaledVector(this.recoveryAxis, acceleration);
      this.recovery = Math.max(0, this.recovery - dt);
      if (
        (angle < c.recoveryStopAngle || passed) &&
        Math.abs(rate) < c.recoveryStopSpeed
      )
        this.recovery = 0;
    }

    if (landingGain > 0) {
      // Surface-tangent spin relative to the surface's own turning.
      this.tmp.copy(this.w).sub(this.surfaceTurn);
      this.tmp.addScaledVector(this.normal, -this.tmp.dot(this.normal));
      // The leveling component (about up × normal, toward alignment) is kept.
      this.tmp2.crossVectors(this.up, this.normal);
      const tilt = this.tmp2.length();
      if (tilt > 1e-4) {
        this.tmp2.multiplyScalar(1 / tilt);
        const leveling = this.tmp.dot(this.tmp2);
        if (leveling > 0) this.tmp.addScaledVector(this.tmp2, -leveling);
      }
      this.w.addScaledVector(this.tmp, Math.exp(-landingGain * dt) - 1);
    }

    // ---- Integrate control accelerations and apply caps -----------------
    if (this.positionCorrection.lengthSq() > 0) {
      this.contactCorrection.copy(this.positionCorrection);
      b.setTranslation(this.position.add(this.positionCorrection), true);
    }
    this.v.addScaledVector(this.acceleration, dt).clampLength(0, c.maxSpeed);
    b.setLinvel(this.v, true);
    this.w.addScaledVector(this.angular, dt).clampLength(0, this.angularLimit);
    b.setAngvel(this.w, true);
    this.turnCurvature =
      speed > 1 && this.contacts ? this.w.dot(this.normal) / this.forwardSpeed : 0;
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
  /** Step hook around world.step(). The wheels own support (no velocity
   * clamps); this only adds per-vertex chassis CCD and bounded positional
   * correction against static geometry, which Rapier's discrete contacts miss
   * for fast or tumbling hull corners. */
  constrainSurface(afterStep = false) {
    if (!this.body.isEnabled() || this.demolitionState !== "active") return;
    if (!afterStep)
      this.guard.before(
        this.world,
        this.bodyId,
        this.collider,
        this.body,
        this.physics.gravity,
      );
    else {
      this.guard.after(this.world, this.bodyId, this.collider, this.body);
      this.contactCorrection.add(this.guard.correction);
    }
  }
}
