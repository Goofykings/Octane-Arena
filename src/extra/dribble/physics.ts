import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Triangle, Vector3 } from "three";
import { Car } from "../../car/car";
import { P } from "../../config/physics";
import { Pose } from "../../physics/pose";
import { CarBallContact } from "../../physics/car-ball";
import type { PlayerInput } from "../../../shared/player";
import { bodies, type BodyId } from "../../../shared/catalog";
import type { DribbleCourse } from "./levels";
import { ribbonGeometry } from "./geometry";

const group = (membership: number, filter: number) =>
  ((membership << 16) | filter) >>> 0;
export const DRIBBLE_GROUPS = {
  road: group(1, 2),
  car: group(2, 1 | 4 | 8 | 16),
  ball: group(4, 2 | 8 | 16),
  obstacle: group(16, 2 | 4),
  // Car support comes from the coplanar road; avoid duplicate car contacts.
  safe: group(8, 4),
};
export class DribblePhysics {
  readonly world = new RAPIER.World({ x: 0, y: -P.gravity, z: 0 });
  readonly car = new Car(this.world);
  readonly ball: RAPIER.RigidBody;
  readonly ballCollider: RAPIER.Collider;
  readonly ballPose: Pose;
  readonly contact = new CarBallContact();
  readonly obstacles = new Set<number>();
  readonly cameraObstacles = (col: RAPIER.Collider) =>
    this.obstacles.has(col.handle);
  private colliders: RAPIER.Collider[] = [];
  readonly spinners: { body: RAPIER.RigidBody; obstacleIndex: number }[] = [];
  obstacleTime = 0;
  private surfaces: { triangle: Triangle; normal: Vector3 }[] = [];
  private previousBall = new Vector3();
  private crossedFinish = false;
  roofContactAge = Infinity;
  constructor(
    public course: DribbleCourse,
    bodyId: BodyId = "ion",
  ) {
    this.world.timestep = P.dt;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 4;
    this.car.id = "dribble-local";
    this.car.setBody(bodyId);
    this.ball = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setCcdEnabled(true)
        .setLinearDamping(P.ball.drag)
        .setAngularDamping(P.ball.angularDrag),
    );
    this.ballCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(P.ball.radius)
        .setMass(P.ball.mass)
        .setFriction(P.ball.friction)
        .setRestitution(P.ball.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(DRIBBLE_GROUPS.ball),
      this.ball,
    );
    this.ballPose = new Pose(this.ball);
    this.load(course);
  }
  load(course: DribbleCourse) {
    for (const spinner of this.spinners)
      this.world.removeRigidBody(spinner.body);
    this.spinners.length = 0;
    for (const collider of this.colliders)
      this.world.removeCollider(collider, true);
    this.colliders = [];
    this.surfaces = [];
    this.obstacles.clear();
    this.course = course;
    course.obstacles.forEach((obstacle, obstacleIndex) => {
      const { piece, center, heading, width } = obstacle;
      const rotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        -heading,
      );
      if (piece.kind === "wall") {
        const collider = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            width / 2,
            piece.height / 2,
            piece.depth / 2,
          )
            .setTranslation(center.x, center.y + piece.height / 2, center.z)
            .setRotation(rotation)
            .setCollisionGroups(DRIBBLE_GROUPS.obstacle)
            .setFriction(0.35)
            .setRestitution(0.05),
        );
        this.colliders.push(collider);
        this.obstacles.add(collider.handle);
      } else {
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(center.x, center.y + piece.radius, center.z)
            .setRotation(rotation)
            .setCcdEnabled(true),
        );
        // Two orthogonal boxes form a single rigid plus, not four independent hinges.
        for (const [x, y] of [
          [piece.radius, piece.armWidth / 2],
          [piece.armWidth / 2, piece.radius],
        ]) {
          const collider = this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(x, y, piece.depth / 2)
              .setCollisionGroups(DRIBBLE_GROUPS.obstacle)
              .setFriction(0.25)
              .setRestitution(0.05),
            body,
          );
          this.obstacles.add(collider.handle);
        }
        this.spinners.push({ body, obstacleIndex });
      }
    });
    for (const [nodes, groups] of [
      [course.nodes, DRIBBLE_GROUPS.road],
    ] as const) {
      const geometry = ribbonGeometry(nodes);
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          new Float32Array(geometry.attributes.position.array),
          new Uint32Array(geometry.index!.array),
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        )
          .setCollisionGroups(groups)
          .setFriction(0.6)
          .setRestitution(0.05),
      );
      geometry.dispose();
      this.colliders.push(collider);
      this.obstacles.add(collider.handle);
    }
    const start = course.start;
    this.colliders.push(
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(start.width / 2, 0.325, start.length / 2)
          .setTranslation(
            start.center.x,
            start.center.y - 0.325,
            start.center.z,
          )
          .setCollisionGroups(DRIBBLE_GROUPS.safe)
          .setFriction(0.6)
          .setRestitution(0.05),
      ),
    );
    // Exactly the ribbon's two top triangles per connected section.
    const edges = (node: DribbleCourse["nodes"][number]) => {
      const right = new Vector3(
        Math.cos(node.heading),
        0,
        Math.sin(node.heading),
      );
      return [
        node.center.clone().addScaledVector(right, -node.width / 2),
        node.center.clone().addScaledVector(right, node.width / 2),
      ];
    };
    for (let i = 1; i < course.nodes.length; i++) {
      if (!course.nodes[i].connected) continue;
      const [a, b] = edges(course.nodes[i - 1]),
        [c, d] = edges(course.nodes[i]);
      for (const triangle of [new Triangle(a, b, c), new Triangle(b, d, c)])
        this.surfaces.push({
          triangle,
          normal: triangle.getNormal(new Vector3()),
        });
    }
    this.reset();
  }
  reset() {
    this.obstacleTime = 0;
    for (const { body, obstacleIndex } of this.spinners) {
      const rotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        -this.course.obstacles[obstacleIndex].heading,
      );
      body.setRotation(rotation, true);
      body.setNextKinematicRotation(rotation);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const p = this.course.spawn;
    this.car.reset(p.x, p.z, 0, p.y);
    this.car.boost = 100;
    this.car.collider.setCollisionGroups(DRIBBLE_GROUPS.car);
    const start = this.course.start;
    this.ball.setTranslation(
      {
        x: start.center.x,
        y: start.center.y + P.ball.radius + 0.015,
        z: start.center.z - 1.5,
      },
      true,
    );
    this.previousBall.copy(this.ball.translation());
    this.crossedFinish = false;
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.contact.reset();
    this.roofContactAge = Infinity;
    this.car.pose.snap();
    this.ballPose.snap();
  }
  step(input: PlayerInput) {
    this.obstacleTime += P.dt;
    for (const { body, obstacleIndex } of this.spinners) {
      const { piece, heading } = this.course.obstacles[obstacleIndex];
      if (piece.kind !== "spinner") continue;
      body.setNextKinematicRotation(
        new Quaternion()
          .setFromAxisAngle(new Vector3(0, 1, 0), -heading)
          .multiply(
            new Quaternion().setFromAxisAngle(
              new Vector3(0, 0, 1),
              this.obstacleTime * piece.angularSpeed,
            ),
          ),
      );
    }
    this.previousBall.copy(this.ball.translation());
    this.crossedFinish = false;
    this.car.pose.before();
    this.ballPose.before();
    this.car.boost = 100;
    this.car.tick(input);
    this.car.constrainSurface();
    this.car.updateSupersonic(P.dt);
    this.contact.sample(this.car, this.ball);
    this.world.step();
    let touched = false,
      roof = false;
    this.world.contactPair(
      this.car.collider,
      this.ballCollider,
      (manifold, flipped) => {
        if (manifold.numSolverContacts() === 0) return;
        touched = true;
        const normal = new Vector3()
          .copy(manifold.normal())
          .multiplyScalar(flipped ? -1 : 1);
        const point = new Vector3().copy(manifold.solverContactPoint(0));
        this.contact.resolve(this.car, this.ball, point, normal);
        const d = bodies[this.car.bodyId];
        if (
          normal.dot(this.car.up) > 0.65 &&
          this.contact.local.y > d.hitboxY + d.halfHeight - 0.1
        )
          roof = true;
      },
    );
    if (!touched) this.contact.separate();
    this.roofContactAge = roof ? 0 : this.roofContactAge + P.dt;
    this.car.constrainSurface(true);
    const cap = (body: RAPIER.RigidBody, speed: number, angular: number) => {
      const v = new Vector3().copy(body.linvel()),
        w = new Vector3().copy(body.angvel());
      if (v.length() > speed) body.setLinvel(v.clampLength(0, speed), true);
      if (w.length() > angular) body.setAngvel(w.clampLength(0, angular), true);
    };
    cap(this.car.body, P.car.maxSpeed, this.car.angularLimit);
    cap(this.ball, P.ball.maxSpeed, P.ball.maxAngular);
    this.car.boost = 100;
    this.car.pose.after();
    this.ballPose.after();
    this.crossedFinish = this.detectFinishCrossing();
  }
  failed() {
    const car = this.car.body.translation(),
      ball = this.ball.translation();
    if (![car.x, car.y, car.z, ball.x, ball.y, ball.z].every(Number.isFinite))
      return "fall";
    if (car.y < this.course.failHeight) return "car-fell";
    if (ball.y + P.ball.radius < this.course.failHeight) return "ball-dropped";
    const position = new Vector3().copy(ball),
      start = this.course.start;
    if (
      Math.abs(ball.x - start.center.x) <= start.width / 2 &&
      Math.abs(ball.z - start.center.z) <= start.length / 2
    )
      return null;
    for (const { triangle, normal } of this.surfaces) {
      const distance = position.clone().sub(triangle.a).dot(normal);
      if (distance >= -P.ball.radius) continue;
      const projection = position.clone().addScaledVector(normal, -distance);
      if (triangle.containsPoint(projection)) return "ball-dropped";
    }
    return null;
  }
  private detectFinishCrossing() {
    const f = this.course.finish;
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      f.heading,
    );
    const local = (p: Vector3) =>
      p.clone().sub(f.center).applyQuaternion(rotation);
    const before = local(this.previousBall),
      after = local(new Vector3().copy(this.ball.translation()));
    // Forward is local -Z; touching or moving backwards does not count.
    if (before.z < 0 || after.z >= 0 || before.z === after.z) return false;
    const crossing = before.lerp(after, before.z / (before.z - after.z));
    return (
      Math.abs(crossing.x) + P.ball.radius <= f.width / 2 &&
      crossing.y >= P.ball.radius &&
      crossing.y + P.ball.radius <= f.height
    );
  }
  finished() {
    return this.crossedFinish;
  }
  dispose() {
    this.world.free();
  }
}
