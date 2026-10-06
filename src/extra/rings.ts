import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { Car } from "../car/car";
import { P } from "../config/physics";
import type { PlayerInput } from "../../shared/player";
import {
  createRingsCourse,
  ringGeometry,
  ringScale,
  type RingsCourse,
  type CoursePlatform,
} from "./course";
import { ExtraRecords } from "./storage";
import { bodies } from "../../shared/catalog";

/** Open-world configuration: no soccer shell, ball, pads, match or containment.
 * The vehicle tick, rigid contact solver and speed limits are the normal ones. */
export class RingsPhysics {
  readonly world = new RAPIER.World({ x: 0, y: -P.gravity, z: 0 });
  readonly car: Car;
  readonly startCollider: RAPIER.Collider;
  readonly finishCollider: RAPIER.Collider;
  readonly ringColliders: RAPIER.Collider[];
  // Thin, open ring tubes are physical car obstacles, not enclosing camera
  // half-spaces. Only the solid decks constrain the shared camera rig.
  readonly cameraObstacles = (collider: RAPIER.Collider) =>
    collider.handle === this.startCollider.handle ||
    collider.handle === this.finishCollider.handle;
  constructor(readonly course: RingsCourse = createRingsCourse()) {
    this.world.timestep = P.dt;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 4;
    const platform = (p: CoursePlatform) =>
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.width / 2, 1.5, p.length / 2)
          .setTranslation(p.center.x, p.center.y - 1.5, p.center.z)
          .setFriction(0.6)
          .setRestitution(0.05),
      );
    this.startCollider = platform(course.start);
    this.finishCollider = platform(course.finish);
    const geometry = ringGeometry();
    const original = geometry.getAttribute("position").array;
    const indices = new Uint32Array(geometry.index!.array);
    this.ringColliders = course.rings.map((ring) => {
      const vertices = new Float32Array(original.length);
      const scale = ringScale(ring);
      for (let i = 0; i < original.length; i++)
        vertices[i] = original[i] * scale;
      return this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          vertices,
          indices,
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        )
          .setTranslation(ring.center.x, ring.center.y, ring.center.z)
          .setRotation(ring.rotation)
          .setFriction(0.15)
          .setRestitution(0.15),
      );
    });
    geometry.dispose();
    this.car = new Car(this.world);
    this.car.id = "rings-local";
    this.reset();
    this.world.step();
    this.car.pose.snap();
  }
  reset() {
    const p = this.course.spawn;
    this.car.reset(p.x, p.z, this.course.spawnYaw, p.y);
    this.car.boost = 100;
    this.car.pose.snap();
  }
  step(input: PlayerInput) {
    const c = this.car;
    c.pose.before();
    c.boost = 100;
    c.tick(input);
    c.constrainSurface();
    c.updateSupersonic(P.dt);
    this.world.step();
    c.constrainSurface(true);
    const v = new Vector3().copy(c.body.linvel()),
      w = new Vector3().copy(c.body.angvel());
    if (v.length() > P.car.maxSpeed)
      c.body.setLinvel(v.clampLength(0, P.car.maxSpeed), true);
    if (w.length() > c.angularLimit)
      c.body.setAngvel(w.clampLength(0, c.angularLimit), true);
    c.boost = 100;
    c.pose.after();
  }
  landedOnFinish() {
    const p = this.car.body.translation(),
      f = this.course.finish;
    if (
      Math.abs(p.x - f.center.x) > f.width / 2 ||
      Math.abs(p.z - f.center.z) > f.length / 2
    )
      return false;
    let contact = false;
    this.world.contactPair(
      this.car.collider,
      this.finishCollider,
      (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++)
          if (manifold.contactDist(i) <= P.car.contactSkin * 2) contact = true;
      },
    );
    return (
      contact ||
      this.car.wheelHits.some(
        (hit, i) =>
          this.car.wheelContact[i] &&
          Math.abs(hit.y - f.center.y) < 0.08 &&
          this.car.wheelNormals[i].y > 0.8,
      )
    );
  }
  dispose() {
    this.world.free();
  }
}

export type RingsPhase = "ready" | "running" | "paused" | "complete";
export class RingsRun {
  phase: RingsPhase = "ready";
  passed = 0;
  resetSequence = 0;
  reason: "restart" | "fall" = "restart";
  private startedAt = 0;
  private pausedAt = 0;
  private pauseDuration = 0;
  private finalTime = 0;
  private resumePhase: "ready" | "running" = "ready";
  constructor(
    readonly physics: RingsPhysics,
    readonly records: ExtraRecords,
  ) {}
  elapsed(now: number) {
    if (
      this.phase === "ready" ||
      (this.phase === "paused" && this.resumePhase === "ready")
    )
      return 0;
    if (this.phase === "complete") return this.finalTime;
    return Math.max(
      0,
      ((this.phase === "paused" ? this.pausedAt : now) -
        this.startedAt -
        this.pauseDuration) /
        1000,
    );
  }
  start(now: number) {
    if (this.phase === "ready") {
      this.startedAt = now;
      this.pauseDuration = 0;
      this.phase = "running";
    }
  }
  pause(now: number) {
    if (this.phase === "paused") {
      this.pauseDuration += now - this.pausedAt;
      this.phase = this.resumePhase;
    } else if (this.phase === "ready" || this.phase === "running") {
      this.resumePhase = this.phase;
      this.pausedAt = now;
      this.phase = "paused";
    }
  }
  reset(reason: RingsRun["reason"] = "restart") {
    this.records.progress(this.passed);
    this.physics.reset();
    this.phase = "ready";
    this.passed = 0;
    this.startedAt = this.pausedAt = this.pauseDuration = this.finalTime = 0;
    this.reason = reason;
    this.resetSequence++;
  }
  step(input: PlayerInput, now: number) {
    if (this.phase === "paused" || this.phase === "complete") return;
    if (Math.abs(input.throttle) > 0.05 || input.jump || input.boost)
      this.start(now);
    const previous = new Vector3().copy(this.physics.car.body.translation());
    this.physics.step(input);
    this.observe(
      previous,
      new Vector3().copy(this.physics.car.body.translation()),
      now,
    );
  }
  /** Swept forward crossings award ordered checkpoints. Bypassing a ring
   * leaves progress unchanged; only falling below the course ends the attempt. */
  observe(previous: Vector3, current: Vector3, now: number) {
    if (this.phase === "paused" || this.phase === "complete") return;
    if (
      current.y < this.physics.course.failHeight ||
      ![current.x, current.y, current.z].every(Number.isFinite)
    ) {
      this.reset("fall");
      return;
    }
    if (Math.hypot(current.x - previous.x, current.z - previous.z) > 0.002)
      this.start(now);
    let lastCrossing = -1;
    while (this.passed < this.physics.course.rings.length) {
      const ring = this.physics.course.rings[this.passed],
        inverse = ring.rotation.clone().invert();
      const a = previous.clone().sub(ring.center).applyQuaternion(inverse);
      const b = current.clone().sub(ring.center).applyQuaternion(inverse);
      if (a.z <= 0 && b.z > 0) {
        const t = -a.z / (b.z - a.z),
          crossing = a.clone().lerp(b, t);
        // A modest center clearance accepts normal tilted car silhouettes while
        // the actual rigid-body torus handles physical edge impacts independently.
        if (
          t >= lastCrossing &&
          Math.hypot(crossing.x, crossing.y) <=
            ring.opening -
              Math.min(
                0.3,
                Math.hypot(
                  bodies[this.physics.car.bodyId].halfWidth,
                  bodies[this.physics.car.bodyId].halfHeight,
                ) * 0.45,
              )
        ) {
          this.start(now);
          this.passed++;
          this.records.progress(this.passed);
          lastCrossing = t;
          continue;
        }
      }
      break;
    }
    if (
      this.passed === this.physics.course.rings.length &&
      this.physics.landedOnFinish()
    ) {
      this.finalTime = this.elapsed(now);
      this.phase = "complete";
      this.records.complete(this.finalTime);
    }
  }
}
export function ringsTime(seconds: number) {
  const ms = Math.floor(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
