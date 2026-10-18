import {
  captureValues,
  restoreValues,
  type CarPredictionState,
} from "../../shared/prediction";
import { refineContactNormal } from "./contact-frame";
import { LandingContact } from "./landing";
import {
  HOOPS_NET_GROUP,
  DROPSHOT_TILE_GROUP,
} from "../physics/collision-groups";
import RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Quaternion, Vector3 } from "three";
import { RUMBLE_CONFIG } from "../config/rumble";
import { P, curvature, throttleAcceleration } from "../config/physics";
import type { PlayerInput } from "../../shared/player";
import type { MatchPhysics } from "../config/mutators";
import {
  DEFAULT_MUTATORS,
  MUTATOR_TUNING as M,
  type MatchMutators,
} from "../../shared/mutators";
import { JumpState } from "./dodge";
import { Pose } from "../physics/pose";
import { chassisShape, chassisPoints } from "./chassis";
import { bodies, type BodyId } from "../game/inventory";
import {
  wheelMount,
  wheelClearance,
  wheelMountY,
  wheelSupportPoint,
} from "./wheels";
const predictionKeys = [
  "sonicGrace",
  "lateralSlip",
  "skidIntensity",
  "roofSteer",
  "impactTime",
  "boost",
  "supersonic",
  "boosting",
  "lastJump",
  "grounded",
  "jumpSupported",
  "contacts",
  "stableContact",
  "supportContacts",
  "partialDrivingAge",
  "wheelSupport",
  "supportKind",
  "chassisContacts",
  "edgeContacts",
  "forwardSpeed",
  "steerAngle",
  "handbrake",
  "driftSign",
  "recovery",
  "recoverySide",
  "recoveryHeld",
  "recoveryCooldown",
  "contactGap",
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
  "surfaceForward",
  "surfaceRight",
  "surfaceTurn",
  "recoveryAxis",
  "recoveryNormal",
  "normalJumpOrigin",
  "normalJumpNormal",
  "flipResetOrigin",
  "flipResetNormal",
] as const;

export class Car {
  physics: MatchPhysics = P;
  mutators: MatchMutators = DEFAULT_MUTATORS;
  infiniteBoost = false;
  applyBoostRule(dt = 0) {
    const mode = this.mutators.boostAmount;
    if (this.infiniteBoost) this.boost = 100;
    else if (mode === "NO BOOST") this.boost = 0;
    else if (mode === "UNLIMITED") this.boost = 100;
    else if (mode === "RECHARGE SLOW" || mode === "RECHARGE FAST")
      this.boost = Math.min(100, this.boost + M.recharge[mode] * dt);
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
  private landingNormal = new Vector3();
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
  teleportSequence = 0;
  grapplePulling = false;
  grounded = false;
  jumpSupported = false;
  contacts = 0;
  stableContact = false;
  supportContacts = 0;
  private partialDrivingAge = 0;
  wheelSupport = 0; // Tire force fraction; narrow/tilted contact cannot carry full grip.
  supportKind: "wheel" | "partial" | "edge" | "chassis" | "air" = "air";
  chassisContacts = 0;
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
  steerAngle = 0;
  handbrake = 0;
  private driftSign = 1;
  private recovery = 0;
  private recoverySide = 1;
  private recoveryHeld = false;
  private recoveryAxis = new Vector3();
  private recoveryNormal = new Vector3(0, 1, 0);
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
        : this.physics.car.maxAngular;
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
  private acceleration = new Vector3();
  private angular = new Vector3();
  private normalReady = false;
  private surfaceTurn = new Vector3();
  constructor(public world: RAPIER.World) {
    const c = this.physics.car;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true),
    );
    this.collider = world.createCollider(
      chassisShape(this.bodyId)
        .setTranslation(0, c.hitboxY, 0)
        .setMassProperties(
          c.mass,
          { x: 0, y: c.comY, z: 0 },
          { x: 25, y: 35, z: 20 },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(this.physics.car.chassisFriction)
        .setContactSkin(this.physics.car.contactSkin)
        .setRestitution(0.05),
      this.body,
    );
    this.pose = new Pose(this.body);
    this.reset(0, 25, 0);
  }
  clearSurfaceHistory() {
    this.landing.reset();
    this.contacts = 0;
    this.grounded = this.stableContact = this.normalReady = false;
    this.jumpSupported = false;
    this.wheelSupport = this.supportContacts = this.partialDrivingAge = 0;
    this.contactGap = 1;
    this.contactState = "air";
    this.supportKind = "air";
    this.wheelContact.fill(false);
    this.surfaceTurn.set(0, 0, 0);
  }
  reset(x: number, z: number, yaw: number, y = 0.36) {
    this.demolitionState = "active";
    this.respawnTimer = 0;
    this.supersonic = false;
    this.sonicGrace = 0;
    this.roofSteer = 0;
    this.landing.reset();
    this.lateralSlip = this.skidIntensity = 0;
    this.handbrake = 0;
    this.recovery = 0;
    this.recoveryHeld = false;
    this.recoveryCooldown = 0;
    this.contactGap = 1;
    this.contactState = "air";
    this.aerialControl = 1;
    this.contacts = 0;
    this.grounded = false;
    this.jumpSupported = false;
    this.stableContact = false;
    this.wheelSupport = this.supportContacts = this.partialDrivingAge = 0;
    this.supportKind = "air";
    this.chassisContacts = this.edgeContacts = 0;
    this.edgeDriveForce.set(0, 0, 0);
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
    this.flipResetSequence = 0;
    this.flipResetAge = Infinity;
    this.jump.wasDown = false;
    this.boost = 100;
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
    this.jump.restorePrediction(state.jump);
    this.jump.direction.copy(state.direction);
    this.landing.restorePrediction(state.landing);
  }
  setBody(id: BodyId) {
    this.bodyId = id;
    const d = bodies[id];
    this.collider.setShape(chassisShape(id).shape);
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
      c = this.physics.car,
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
    const contactNormal = new Vector3(),
      normalWeights = [0, 0, 0, 0];
    this.contacts = this.supportContacts = 0;
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
        (col) =>
          col.parent() === null &&
          col.collisionGroups() !== HOOPS_NET_GROUP &&
          col.collisionGroups() !== DROPSHOT_TILE_GROUP,
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
        normalWeights[i] = weight;
        contactNormal.addScaledVector(this.wheelNormals[i], weight);
        if (
          hit.timeOfImpact <
            c.contactReach +
              (this.stableContact ? c.maxContactCorrection : 0) &&
          !(this.jump.used && this.jump.age < 0.18)
        ) {
          this.contacts++;
          if (hit.timeOfImpact < c.supportReach) this.supportContacts++;
          this.wheelContact[i] = true;
          this.wheelNormals[i].copy(hit.normal);
        }
      }
    }
    this.partialDrivingAge =
      this.supportContacts >= 3 ? 0 : this.partialDrivingAge + dt;
    if (this.contacts >= 1) {
      contactNormal.normalize();
      let midpoint: Vector3 | null = null;
      if (
        this.wheelNormals.some(
          (n) => n.lengthSq() > 0 && n.dot(contactNormal) < 0.98,
        )
      ) {
        const hit = this.world.castRayAndGetNormal(
          new RAPIER.Ray(b.translation(), this.up.clone().negate()),
          c.rayLength,
          true,
          undefined,
          undefined,
          this.collider,
          b,
          (col) =>
            col.parent() === null &&
            col.collisionGroups() !== HOOPS_NET_GROUP &&
            col.collisionGroups() !== DROPSHOT_TILE_GROUP,
        );
        if (hit) midpoint = new Vector3().copy(hit.normal);
      }
      const smoothPatch = refineContactNormal(
        contactNormal,
        this.wheelNormals,
        normalWeights,
        midpoint,
      );
      // Fit the wheel footprint, rather than selecting a single triangle's normal.
      const active = this.wheelHits.filter(
        (_, i) =>
          this.wheelNormals[i].lengthSq() > 0 &&
          (smoothPatch || this.wheelNormals[i].dot(contactNormal) > 0.98),
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
        smoothPatch &&
        !flatFloor &&
        active.length === 4 &&
        plane.lengthSq() > 1e-8 &&
        plane.normalize().dot(contactNormal) > 0.7
      )
        contactNormal.lerp(plane, 0.65).normalize();
      if (!flatFloor && this.contacts >= 3) this.partialDrivingAge = 0;
      const previousNormal = this.normal.clone();
      if (
        flatFloor ||
        !smoothPatch ||
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
      const coherent = this.wheelNormals.every(
        (n, i) => !this.wheelContact[i] || n.dot(contactNormal) > 0.7,
      );
      const curvedContinuation =
        this.stableContact &&
        this.contacts >= 1 &&
        active.length >= 3 &&
        this.partialDrivingAge <= c.curveContactGrace &&
        this.surfaceTurn.length() > 0.2 &&
        Math.abs(this.forwardSpeed) > c.wallDriveSpeed * 0.5;
      this.stableContact =
        coherent &&
        this.normalReady &&
        this.up.dot(this.normal) > (this.stableContact ? 0.94 : 0.98) &&
        ((this.contacts >= 3 && (this.supportContacts >= 3 || !flatFloor)) ||
          curvedContinuation) &&
        !(this.normal.y < c.overheadPartialNormal && this.contacts < 3);
    } else if (!this.contacts) {
      this.stableContact = false;
      this.normalReady = false;
      this.surfaceTurn.set(0, 0, 0);
      this.normal.copy(this.up);
    }
    const treadContact = this.contacts > 0 && this.up.dot(this.normal) > 0.55;
    // Grounding owns jump reset and driving control, not mere proximity rays.
    this.grounded = this.stableContact;
    // A real aligned tread pair can support a surface jump/landing reset even
    // while driving support is incomplete. It must not own aerial controls,
    // adhesion or alignment, nor grant jump support to nose/shoulder/ceiling edges.
    this.jumpSupported =
      this.stableContact ||
      (this.supportContacts >= 2 &&
        this.up.dot(this.normal) > c.partialSurfaceAlignment &&
        this.normal.y >= c.overheadPartialNormal);
    // Held throttle requests recovery immediately when real roof support appears.
    // Jump retains its press edge; upright braking and cooldown remain unchanged.
    const recoveryInput =
      Math.abs(input.throttle) > c.recoveryInputThreshold ||
      (input.jump && !this.recoveryHeld);
    this.recoveryHeld = input.jump;
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
        (col) =>
          col.parent() === null &&
          col.collisionGroups() !== HOOPS_NET_GROUP &&
          col.collisionGroups() !== DROPSHOT_TILE_GROUP,
      );
      if (support && this.up.dot(this.tmp.copy(support.normal)) < -0.65) {
        // Player-requested roof recovery needs a full half-turn. Previously
        // the driving alignment controller finished it on partial touchdown;
        // that controller must now wait for real stable support instead.
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
    this.contactGap = this.contacts ? 0 : this.contactGap + dt;
    const leavingByJump = this.jump.used && this.jump.age < 0.18;
    this.contactState =
      this.stableContact && this.contacts >= 3
        ? "surface"
        : this.contacts ||
            (!leavingByJump && this.contactGap < c.contactRelease)
          ? "transition"
          : "air";
    // Chassis support is independent of driving support. Preserve manifold
    // rotation around roof ramps without passive aerial damping, while still
    // accepting deliberate rotation input. Average near-touching roof manifolds.
    const roofNormal = new Vector3();
    let roofContacts = 0;
    this.chassisContacts = 0;
    const noseContacts: { point: Vector3; normal: Vector3 }[] = [];
    this.world.contactPairsWith(this.collider, (other) => {
      if (other.parent() !== null) return;
      this.world.contactPair(this.collider, other, (manifold, flipped) => {
        const normal = new Vector3()
          .copy(manifold.normal())
          .multiplyScalar(flipped ? 1 : -1);
        if (
          Math.abs(this.forward.dot(normal)) > 0.9 &&
          Math.abs(this.up.dot(normal)) < 0.45 &&
          normal.y > 0.65
        )
          for (let i = 0; i < manifold.numSolverContacts(); i++)
            noseContacts.push({
              point: new Vector3().copy(manifold.solverContactPoint(i)),
              normal: normal.clone(),
            });
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) > c.contactSkin * 2) continue;
          this.chassisContacts++;

          if (normal.dot(this.up) <= -0.5) {
            roofNormal.add(normal);
            roofContacts++;
          }
        }
      });
    });
    if (roofContacts) roofNormal.normalize();
    const edges = this.wheelEdges(
      this.q,
      new Vector3().copy(b.translation()),
    ).filter((edge) => edge.gap <= c.contactSkin * 2);
    this.edgeContacts = edges.length;
    this.edgeDriveForce.set(0, 0, 0);
    this.supportKind = this.stableContact
      ? "wheel"
      : treadContact
        ? "partial"
        : this.chassisContacts
          ? "chassis"
          : edges.length
            ? "edge"
            : "air";
    this.roofSteer =
      roofContacts && !this.recovering ? Math.abs(input.steer) : 0;
    // Only genuine driving support owns the orientation controller. A nose,
    // shoulder or roof edge must leave player aerial torque available. Preserve
    // the short lost-ray debounce solely after settled driving contact.
    const partialContact =
      this.contacts > 0 || this.chassisContacts > 0 || edges.length > 0;
    this.aerialControl =
      this.recovering || this.stableContact
        ? 0
        : partialContact || leavingByJump
          ? 1
          : this.contactState === "transition" && this.aerialControl === 0
            ? 0
            : Math.min(1, this.aerialControl + dt / c.airControlBlend);
    this.applyBoostRule(dt);
    this.boosting = input.boost && this.boost > 0;
    const throttle = this.boosting ? 1 : input.throttle;
    if (treadContact) {
      const alignment = Math.max(
        0,
        Math.min(
          1,
          (this.up.dot(this.normal) - 0.55) /
            (c.partialSurfaceAlignment - 0.55),
        ),
      );
      // Partial support can scrub/drive at a loaded tire, but cannot act as a
      // full friction patch. Scale continuously with count/alignment, and shed
      // overhead grip so gravity can release a narrow two-wheel support.
      this.wheelSupport = this.stableContact
        ? 1
        : Math.min(0.5, this.contacts / 4) *
          alignment *
          alignment *
          (c.overheadPartialSupport +
            (1 - c.overheadPartialSupport) * Math.max(0, this.normal.y) ** 2);
      const support =
        this.wheelSupport *
        (this.grapplePulling ? RUMBLE_CONFIG.grapple.tireLoad : 1);
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
        -(c.adhesion + this.physics.gravity * (1 - floor) * drive) *
          overhead *
          support *
          Number(this.stableContact),
      );
      this.adhesionAcceleration
        .copy(this.normal)
        .multiplyScalar(
          -(c.adhesion + this.physics.gravity * (1 - floor) * drive) *
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
      // More authority at speed for settled tracking, without grabbing a sideways
      // landing. The separate handbrake force below keeps its original curve.
      const highSpeedGrip =
        Number(this.stableContact) *
        MathUtils.smoothstep(
          Math.abs(vf),
          c.highSpeedGripStart,
          c.highSpeedGripEnd,
        ) *
        (1 - MathUtils.smoothstep(slipRatio, 0.12, 0.35));
      const lateralLimit =
        c.lateralMaxAcceleration * (1 + c.highSpeedForceGain * highSpeedGrip);
      const ordinaryLateral = MathUtils.clamp(
        -lateral * c.grip * (1 + c.highSpeedGripGain * highSpeedGrip),
        -lateralLimit,
        lateralLimit,
      );
      const slidingLateral = -lateral * c.grip * lateralFactor;
      this.acceleration.addScaledVector(
        this.surfaceRight,
        (ordinaryLateral +
          (slidingLateral - ordinaryLateral) * this.handbrake) *
          contactScale *
          support *
          wallGrip *
          (this.impactTime > 0 ? 0.18 : 1),
      );
      // Contact-normal feedback aligns physical angular motion on every surface, including ramps.
      const curveResponse = Math.min(1, this.surfaceTurn.length() / 2);
      const alignmentTorque =
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
      this.angular
        .copy(this.up)
        .cross(supportNormal)
        .multiplyScalar(alignmentTorque);
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
          this.wheelSupport *
          (c.steeringResponse +
            (slide.yawResponse - c.steeringResponse) * this.handbrake) *
          (this.impactTime > 0 ? 0.3 : 1),
      );
      // The curve's changing normal is a geometric angular target, not tire
      // traction. Preserve it when a wheel unloads instead of freezing the frame.
      this.angular.addScaledVector(this.surfaceTurn, damping);
    } else {
      this.wheelSupport = 0;
      this.acceleration.addScaledVector(
        this.forward,
        throttle * (throttle >= 0 ? c.airThrottle : c.airReverse),
      );
    }
    // A driven, nearly side-on tire can scrub across its rounded shoulder.
    // Apply a load-limited friction force at the supported wheel, not a generic
    // upright torque or a timed recovery flip. Its real lever arm creates roll.
    // Exclude moving cornering/powerslides, walls, nose contact and airborne cars.
    if (
      edges.length &&
      (Math.abs(input.throttle) > c.edgeInputThreshold ||
        Math.abs(input.steer) > c.edgeInputThreshold) &&
      this.v.length() < c.edgeRecoverySpeed &&
      !this.recovering &&
      !leavingByJump
    ) {
      const beforeV = new Vector3().copy(b.linvel()),
        beforeW = new Vector3().copy(b.angvel());
      for (const edge of edges) {
        const inward = this.up
          .clone()
          .addScaledVector(edge.normal, -this.up.dot(edge.normal))
          .normalize();
        const travel = this.forward
          .clone()
          .addScaledVector(edge.normal, -this.forward.dot(edge.normal))
          .normalize();
        const force = inward
          .multiplyScalar(
            Math.abs(input.throttle) + input.steer * c.edgeSteerGrip,
          )
          .addScaledVector(travel, input.throttle * 0.25)
          .addScaledVector(
            this.right
              .clone()
              .addScaledVector(edge.normal, -this.right.dot(edge.normal)),
            input.steer * c.edgeSteerGrip,
          )
          .clampLength(0, 1)
          .multiplyScalar(
            (b.mass() * this.physics.gravity * c.edgeDriveGrip) / edges.length,
          );
        b.applyImpulseAtPoint(
          force.clone().multiplyScalar(dt),
          edge.point,
          true,
        );
        this.edgeDriveForce.add(force);
      }
      this.v.add(new Vector3().copy(b.linvel()).sub(beforeV));
      this.w.add(new Vector3().copy(b.angvel()).sub(beforeW));
    }
    // A nose/corner scrape is not tire support. Deliberate input produces a
    // bounded tangential force at the actual manifold, whose lever arm tips it.
    // Delicate input retains skillful balancing; no pose target is involved.
    if (
      noseContacts.length &&
      this.contacts < 2 &&
      !this.recovering &&
      this.v.length() < c.edgeRecoverySpeed
    ) {
      const drive = (value: number) =>
        Math.sign(value) *
        Math.max(
          0,
          (Math.abs(value) - c.edgeInputThreshold) / (1 - c.edgeInputThreshold),
        );
      const amount = drive(input.throttle),
        steer = drive(input.steer);
      const beforeV = new Vector3().copy(b.linvel()),
        beforeW = new Vector3().copy(b.angvel());
      for (const contact of noseContacts) {
        const force = this.up
          .clone()
          .multiplyScalar(amount)
          .addScaledVector(this.right, steer)
          .addScaledVector(
            contact.normal,
            -(
              this.up.dot(contact.normal) * amount +
              this.right.dot(contact.normal) * steer
            ),
          )
          .clampLength(0, 1)
          .multiplyScalar(
            (b.mass() * this.physics.gravity * c.noseInputGrip) /
              noseContacts.length,
          );
        b.applyImpulseAtPoint(force.multiplyScalar(dt), contact.point, true);
      }
      this.v.add(new Vector3().copy(b.linvel()).sub(beforeV));
      this.w.add(new Vector3().copy(b.angvel()).sub(beforeW));
    }
    if (this.boosting) {
      this.acceleration.addScaledVector(
        this.forward,
        this.grounded ? c.boostGround : c.boostAir,
      );
      if (!this.infiniteBoost && this.mutators.boostAmount !== "UNLIMITED")
        this.boost = Math.max(0, this.boost - c.boostUse * dt);
    }
    this.flipResetAge += dt;
    const action = this.jump.step(
      this.recovering ? { ...input, jump: false } : input,
      this.jumpSupported,
      dt,
    );
    if (this.recovering) this.jump.wasDown = input.jump;
    this.lastJump = action !== null;
    if (action === "double") {
      this.normalJumpSequence++;
      this.normalJumpAge = 0;
      this.normalJumpNormal.copy(this.up);
      this.normalJumpOrigin
        .copy(b.translation())
        .addScaledVector(this.up, -this.physics.car.contactHeight)
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
    if (roofContacts && !this.recovering && input.steer && !input.yaw) {
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
      // A cancel removes pitch flip torque; it never applies reverse pitch torque.
      if (!flipping || cancel) {
        this.angular
          .addScaledVector(
            this.right,
            -input.pitch * c.airPitch * pitchScale * this.aerialControl,
          )
          .addScaledVector(
            this.up,
            -(this.jump.stallChordHeld ? 0 : input.yaw) *
              c.airYaw *
              this.aerialControl,
          )
          .addScaledVector(
            this.forward,
            (this.jump.stallChordHeld
              ? input.roll - (input.directionalRoll ?? 0)
              : input.roll) *
              c.airRoll *
              this.aerialControl,
          );
        // Passive air damping must not pin a body rotating about a loaded edge.
        // Damp commanded axes only during contact; roof ramp torque remains physical.
        if (!partialContact)
          this.angular.addScaledVector(
            this.w,
            -c.airDamping * this.aerialControl,
          );
        else {
          for (const [axis, amount] of [
            [this.right, input.pitch * pitchScale],
            [this.up, this.jump.stallChordHeld ? 0 : input.yaw],
            [
              this.forward,
              this.jump.stallChordHeld
                ? input.roll - (input.directionalRoll ?? 0)
                : input.roll,
            ],
          ] as const)
            if (amount)
              this.angular.addScaledVector(
                axis,
                -this.w.dot(axis) * c.airDamping * this.aerialControl,
              );
        }
      }
    }
    if (
      this.jump.used &&
      !this.jump.second &&
      !this.jump.resetAvailable &&
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
  /** Gravity-side probes find rounded wheel shoulders missed by wheel-up rays.
   * They provide unilateral support, never suspension or magnetic attraction. */
  private wheelEdges(q: Quaternion, position: Vector3) {
    const up = new Vector3(0, 1, 0).applyQuaternion(q),
      forward = new Vector3(0, 0, -1).applyQuaternion(q);
    const edges: { point: Vector3; normal: Vector3; gap: number }[] = [];
    if (Math.abs(up.y) > 0.6) return edges;
    for (let i = 0; i < 4; i++) {
      const origin = wheelMount(this.bodyId, i)
        .applyQuaternion(q)
        .add(position);
      const center = origin.clone().addScaledVector(up, wheelMountY);
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray(center.clone().add(new Vector3(0, 0.4, 0)), {
          x: 0,
          y: -1,
          z: 0,
        }),
        0.65,
        true,
        undefined,
        undefined,
        this.collider,
        this.body,
        (col) =>
          col.parent() === null &&
          col.collisionGroups() !== HOOPS_NET_GROUP &&
          col.collisionGroups() !== DROPSHOT_TILE_GROUP,
      );
      if (!hit) continue;
      const normal = new Vector3().copy(hit.normal);
      if (
        normal.y < 0.65 ||
        Math.abs(normal.dot(up)) > 0.55 ||
        Math.abs(normal.dot(forward)) > 0.4
      )
        continue;
      const point = wheelSupportPoint(
        origin,
        q,
        normal,
        i < 2 ? this.steerAngle : 0,
      );
      const plane = center
        .clone()
        .add(new Vector3(0, 0.4 - hit.timeOfImpact, 0));
      const gap =
        point.clone().sub(plane).dot(normal) - this.physics.car.contactSkin;
      if (gap <= 0.05) edges.push({ point, normal, gap });
    }
    return edges;
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
    let floorCount = 0,
      floorLow = Infinity,
      floorHigh = -Infinity;
    for (let i = 0; i < 4; i++) {
      if (!this.wheelContact[i] || this.wheelNormals[i].y < 0.9999) continue;
      floorCount++;
      floorLow = Math.min(floorLow, this.wheelHits[i].y);
      floorHigh = Math.max(floorHigh, this.wheelHits[i].y);
    }
    const flatFloorFootprint =
      floorCount >= 3 &&
      floorHigh - floorLow < this.physics.car.contactSkin * 2;
    // A diagonal footprint on cylindrical curvature is not a coplanar four-point
    // support set. Iterating all four there over-constrains legitimate roll/slip.
    const chord = new Vector3()
      .subVectors(this.wheelHits[1], this.wheelHits[0])
      .cross(new Vector3().subVectors(this.wheelHits[2], this.wheelHits[0]));
    const curvedWheelSet =
      this.stableContact &&
      this.wheelNormals.every((n) => n.lengthSq() > 0) &&
      chord.lengthSq() > 1e-8 &&
      Math.abs(
        new Vector3()
          .subVectors(this.wheelHits[3], this.wheelHits[0])
          .dot(chord.normalize()),
      ) < 0.012;
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
            if (manifold.contactDist(i) <= this.physics.car.contactSkin * 2)
              roofContact = true;
        });
      });
      this.collider.setFriction(
        roofContact
          ? this.physics.car.roofFriction +
              (this.physics.car.roofSteeringFriction -
                this.physics.car.roofFriction) *
                this.roofSteer
          : this.physics.car.chassisFriction,
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
      for (const local of chassisPoints(this.bodyId)) {
        const offset = local.applyQuaternion(q),
          point = offset.clone().add(position);
        const rotationVelocity = new Vector3().crossVectors(angular, offset);
        const travel = velocity.clone().add(rotationVelocity);
        travel.y -= this.physics.gravity * P.dt;
        const speed = travel.length();
        if (speed < 0.01) continue;
        const hit = this.world.castRayAndGetNormal(
          new RAPIER.Ray(point, travel.multiplyScalar(1 / speed)),
          speed * P.dt + this.physics.car.contactSkin,
          false,
          undefined,
          undefined,
          this.collider,
          b,
          (col) =>
            col.parent() === null &&
            col.collisionGroups() !== HOOPS_NET_GROUP &&
            col.collisionGroups() !== DROPSHOT_TILE_GROUP,
        );
        if (!hit) continue;
        const normal = new Vector3().copy(hit.normal),
          approach = -travel.dot(normal);
        if (approach <= 0) continue;
        const gap = Math.max(
          0,
          hit.timeOfImpact * approach - this.physics.car.contactSkin,
        );
        const pointMinimum =
          -gap / P.dt + this.physics.gravity * normal.y * P.dt;
        if (
          (!this.stableContact || normal.dot(up) < -0.5) &&
          !this.recovering
        ) {
          constraints.push({ point, normal, minimum: pointMinimum });
        } else {
          // Keep the existing wheel-side and player recovery path intact.
          const minimum = Math.min(
            0,
            pointMinimum - rotationVelocity.dot(normal),
          );
          if (velocity.dot(normal) < minimum)
            velocity.addScaledVector(normal, minimum - velocity.dot(normal));
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
    for (const edge of this.wheelEdges(q, position)) {
      if (this.jump.used && this.jump.age < 0.18) break;
      if (afterStep) {
        const depth = -edge.gap - correction.dot(edge.normal);
        if (depth > 0)
          correction.addScaledVector(
            edge.normal,
            Math.min(depth, this.physics.car.maxContactCorrection),
          );
        if (edge.gap < this.physics.car.contactSkin)
          constrainPoint(edge.point, edge.normal, 0);
      } else {
        constrainPoint(
          edge.point,
          edge.normal,
          -Math.max(0, edge.gap) / P.dt +
            this.physics.gravity * edge.normal.y * P.dt,
        );
      }
    }
    let alignedFloorContacts = 0,
      landingContacts = 0,
      nearWheelContacts = 0;
    this.landingNormal.set(0, 0, 0);
    const wheelConstraints: {
      point: Vector3;
      normal: Vector3;
      minimum: number;
    }[] = [];
    for (let i = 0; i < 4; i++) {
      if (this.jump.used && this.jump.age < 0.18) break;
      const origin = wheelMount(this.bodyId, i)
        .applyQuaternion(q)
        .add(position);
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray(origin, up.clone().negate()),
        this.physics.car.contactReach,
        true,
        undefined,
        undefined,
        this.collider,
        b,
        (col) =>
          col.parent() === null &&
          col.collisionGroups() !== HOOPS_NET_GROUP &&
          col.collisionGroups() !== DROPSHOT_TILE_GROUP,
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
      const ordinaryGap =
        (hit.timeOfImpact - this.physics.car.contactHeight) * alignment;
      const gap =
        rigidHeight > wheelMountY
          ? Math.min(ordinaryGap, -(rigidHeight - wheelMountY) * alignment)
          : ordinaryGap;
      if (afterStep) {
        if (gap <= this.physics.car.contactSkin * 2) nearWheelContacts++;
        if (
          normal.y > 0.995 &&
          alignment > 0.985 &&
          gap <= this.physics.car.contactSkin * 2
        ) {
          landingContacts++;
          this.landingNormal.add(normal);
        }
        if (
          normal.y > 0.9999 &&
          alignment > 0.9999 &&
          gap < this.physics.car.contactSkin
        )
          alignedFloorContacts++;
        // Split positional correction: clearance error is not converted to bounce velocity.
        const depth = -gap - correction.dot(normal);
        if (depth > 0)
          correction.addScaledVector(
            normal,
            Math.min(depth, this.physics.car.maxContactCorrection),
          );
        // A tilted body may move downward while its loaded wheel stays still:
        // that is rotation about the contact, not penetration. Clamping COM
        // descent here cancels gravity before the point constraint can produce
        // its physical settling torque on the following step.
        if (
          ((flatFloorFootprint && alignment > 0.9999) ||
            (this.stableContact && !curvedWheelSet)) &&
          gap < this.physics.car.contactSkin &&
          velocity.dot(normal) < 0
        )
          velocity.addScaledVector(normal, -velocity.dot(normal));
        else if (
          curvedWheelSet &&
          !flatFloorFootprint &&
          gap < this.physics.car.contactSkin
        ) {
          const point = wheelSupportPoint(
            origin,
            q,
            normal,
            i < 2 ? this.steerAngle : 0,
          );
          wheelConstraints.push({ point, normal, minimum: 0 });
        }
      } else {
        // Permit approach until the clearance plane; account for the next gravity step.
        const minimum =
          -Math.max(0, gap) / P.dt + this.physics.gravity * normal.y * P.dt;
        if (
          (this.stableContact || flatFloorFootprint) &&
          normal.y > 0.9999 &&
          up.y > 0.9999
        ) {
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
        wheelConstraints.push({ point, normal, minimum });
      }
    }
    // Solve all loaded wheel points as one support set. A single ordered pass
    // converted touchdown momentum into a leftover pitch/roll impulse at the last
    // wheel; alternating iterations distribute support without an upright torque.
    const supportPasses =
      wheelConstraints.length >= 3 &&
      up.y > 0.98 &&
      wheelConstraints.every((c) => c.normal.y > 0.995)
        ? 6
        : curvedWheelSet &&
            wheelConstraints.length >= 3 &&
            wheelConstraints.every((c) => c.normal.dot(this.normal) > 0.9)
          ? 3
          : 1;
    for (let pass = 0; pass < supportPasses; pass++)
      for (let j = 0; j < wheelConstraints.length; j++) {
        const contact =
          wheelConstraints[pass % 2 ? wheelConstraints.length - 1 - j : j];
        constrainPoint(contact.point, contact.normal, contact.minimum);
      }
    if (afterStep) {
      const valid =
        landingContacts >= 3 &&
        up.y > 0.985 &&
        !this.recovering &&
        !(this.jump.used && this.jump.age < 0.18) &&
        this.jump.flipLeft === 0 &&
        this.impactTime === 0;
      const rate = this.landing.step(
        nearWheelContacts === 0 && this.chassisContacts === 0,
        valid,
        P.dt,
        this.physics.car.landingDamping,
        this.physics.car.landingDampingTime,
      );
      if (rate > 0) {
        this.landingNormal.normalize();
        const angular = b.angvel(),
          normal = this.landingNormal;
        const yaw =
          angular.x * normal.x + angular.y * normal.y + angular.z * normal.z;
        const retain = Math.exp(-rate * P.dt);
        b.setAngvel(
          {
            x: angular.x * retain + normal.x * yaw * (1 - retain),
            y: angular.y * retain + normal.y * yaw * (1 - retain),
            z: angular.z * retain + normal.z * yaw * (1 - retain),
          },
          true,
        );
      }
    }
    // Full, geometrically verified floor support also works when this helper
    // is called directly before tick(). Never use this clamp for a wheel pair.
    if (afterStep && alignedFloorContacts >= 3 && velocity.y < 0)
      velocity.y = 0;
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
              Math.min(remaining, this.physics.car.maxContactCorrection),
            );
          // Rapier resolves velocity at all manifold contacts. A COM-only clamp
          // here would cancel descent/rotation about a loaded roof edge.
          if (
            (this.stableContact || this.recovering) &&
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
      for (const local of chassisPoints(this.bodyId)) {
        const point = local.applyQuaternion(q).add(position);
        const direction = point.clone().sub(center),
          length = direction.length();
        direction.normalize();
        const hit = this.world.castRayAndGetNormal(
          new RAPIER.Ray(center, direction),
          length + this.physics.car.contactSkin,
          false,
          undefined,
          undefined,
          this.collider,
          b,
          (col) =>
            col.parent() === null &&
            col.collisionGroups() !== HOOPS_NET_GROUP &&
            col.collisionGroups() !== DROPSHOT_TILE_GROUP,
        );
        if (!hit) continue;
        const normal = new Vector3().copy(hit.normal),
          alignment = -normal.dot(direction);
        if (alignment < 0.01) continue;
        const depth =
          (length - hit.timeOfImpact) * alignment +
          this.physics.car.contactSkin -
          correction.dot(normal);
        if (depth > 0) correction.addScaledVector(normal, depth);
        if (
          (!this.stableContact || normal.dot(up) < -0.5) &&
          !this.recovering
        ) {
          if (depth > 0) constrainPoint(point, normal, 0);
        } else if (velocity.dot(normal) < 0)
          velocity.addScaledVector(normal, -velocity.dot(normal));
      }
    }
    if (afterStep && correction.lengthSq() > 0) {
      correction.clampLength(0, this.physics.car.maxContactCorrection);
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
