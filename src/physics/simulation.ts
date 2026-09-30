import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion } from "three";
import { P } from "../config/physics";
import { Car } from "../car/car";
import { createArena } from "../arena/physics";
import { Pose } from "./pose";
import type { Controls } from "../input/types";
import {
  neutralInput,
  type PlayerEntity,
  type PlayerInput,
} from "../../shared/player";
import { canDemolish, respawnLocations } from "../game/demolition";
import { bodies } from "../game/inventory";
export interface Hit {
  position: Vector3;
  normal: Vector3;
  relative: Vector3;
  impulse: Vector3;
  strength: number;
  age: number;
}
export class Simulation {
  world: RAPIER.World;
  cars: Car[];
  ball: RAPIER.RigidBody;
  ballCollider: RAPIER.Collider;
  ballPose: Pose;
  events = new RAPIER.EventQueue(true);
  hits: Hit[] = [];
  clock = 0;
  demolitions: {
    attackerId: string;
    victimId: string;
    position: Vector3;
    age: number;
  }[] = [];
  lastTouchId: string | null = null;
  private velocities: Vector3[] = [];
  private cooldown: number[] = [];
  private relative: Vector3[] = [];
  constructor(
    flat = false,
    players: PlayerEntity[] = [
      { id: "player", name: "Guest", team: 0, controller: "local" },
      { id: "bot", name: "Rival", team: 1, controller: "bot" },
    ],
  ) {
    if (
      players.length < 1 ||
      players.length > 4 ||
      new Set(players.map((p) => p.id)).size !== players.length ||
      players.some((p) => !p.id || ![0, 1].includes(p.team))
    )
      throw Error("A simulation needs 1–4 unique player IDs and valid teams");
    this.world = new RAPIER.World({ x: 0, y: -P.gravity, z: 0 });
    this.world.timestep = P.dt;
    this.world.numSolverIterations = 8;
    createArena(this.world, flat);
    this.cars = players.map(() => new Car(this.world));
    this.velocities = players.map(() => new Vector3());
    this.relative = players.map(() => new Vector3());
    this.cooldown = players.map(() => 0);
    this.cars.forEach((c, i) => {
      c.id = players[i].id;
      c.team = players[i].team;
      c.displayName = players[i].name;
    });
    this.cars.forEach((c) =>
      c.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
    this.ball = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, P.ball.radius + 0.02, 0)
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
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.ball,
    );
    this.ballPose = new Pose(this.ball);
    this.reset();
    this.world.step();
    this.cars.forEach((c) => c.pose.snap());
    this.ballPose.snap();
  }
  reset() {
    for (const c of this.cars)
      if (c.demolitionState !== "active") {
        c.body.setEnabled(true);
        c.collider.setCollisionGroups(0xffffffff);
      }
    this.demolitions = [];
    this.lastTouchId = null;
    this.ballCollider.setCollisionGroups(0xffffffff);
    this.ball.setEnabled(true);
    for (const c of this.cars) {
      const team = this.cars.filter((p) => p.team === c.team),
        slot = team.indexOf(c);
      c.reset(
        team.length === 1 ? 0 : (slot - (team.length - 1) / 2) * 12,
        c.team === 0 ? 26 : -26,
        c.team === 0 ? 0 : Math.PI,
      );
    }
    this.ball.setTranslation({ x: 0, y: P.ball.radius + 0.02, z: 0 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ballPose.snap();
    this.hits = [];
    this.cooldown = this.cars.map(() => 0);
  }
  /** Physical blast; the match keeps steering, aerial control and boost live. */
  explode(origin: { x: number; y: number; z: number }) {
    this.ballCollider.setCollisionGroups(0);
    this.ball.setEnabled(false);
    for (const c of this.cars) {
      if (c.demolitionState !== "active") continue;
      const direction = new Vector3().subVectors(c.body.translation(), origin);
      const distance = direction.length();
      direction.y = Math.max(3, distance * 0.28);
      const speed =
        P.match.explosionFar +
        (P.match.explosionNear - P.match.explosionFar) *
          Math.exp(-distance / 40);
      c.body.applyImpulse(
        direction.normalize().multiplyScalar(P.car.mass * speed),
        true,
      );
      c.body.applyTorqueImpulse(
        { x: 35, y: 0, z: c.body.translation().x >= 0 ? 45 : -45 },
        true,
      );
      c.boosting = false;
    }
  }
  step(inputs: Controls[] | ReadonlyMap<string, PlayerInput>, passive = false) {
    this.clock += P.dt;
    this.demolitions = this.demolitions.filter((e) => (e.age += P.dt) < 1);
    this.cars.forEach((c) => {
      if (c.demolitionState === "active") return;
      c.respawnTimer = Math.max(0, c.respawnTimer - P.dt);
      if (c.respawnTimer > 1e-8) return;
      c.demolitionState = "respawning";
      const locations = respawnLocations(c.team),
        start = Math.floor(Math.random() * locations.length);
      for (let i = 0; i < locations.length; i++) {
        const p = locations[(start + i) % locations.length];
        if (
          this.cars.some(
            (other) =>
              other !== c &&
              other.body.isEnabled() &&
              p.distanceTo(other.body.translation()) < 4,
          ) ||
          p.distanceTo(this.ball.translation()) < 2.5
        )
          continue;
        c.reset(p.x, p.z, c.team === 0 ? 0 : Math.PI);
        c.boost = P.demolition.boost;
        c.collider.setCollisionGroups(0xffffffff);
        c.body.setEnabled(true);
        break;
      }
    });
    this.hits = this.hits.filter((h) => (h.age += P.dt) < 0.6);
    this.cars.forEach((c, i) => {
      c.pose.before();
      if (!passive && c.body.isEnabled())
        c.tick(
          (Array.isArray(inputs) ? inputs[i] : inputs.get(c.id)) ??
            neutralInput(),
        );
      c.constrainSurface();
      c.updateSupersonic(P.dt);
      this.velocities[i].copy(c.body.linvel());
      this.relative[i].copy(c.body.linvel()).sub(this.ball.linvel());
      this.cooldown[i] = Math.max(0, this.cooldown[i] - P.dt);
    });
    this.ballPose.before();
    this.world.step(this.events);
    this.events.drainCollisionEvents((a, b, started) => {
      if (
        started &&
        this.cars.some((c) => c.collider.handle === a) &&
        this.cars.some((c) => c.collider.handle === b)
      ) {
        this.bump(
          this.cars.findIndex((c) => c.collider.handle === a),
          this.cars.findIndex((c) => c.collider.handle === b),
        );
        return;
      }
      if (
        !started ||
        (a !== this.ballCollider.handle && b !== this.ballCollider.handle)
      )
        return;
      const carIndex = this.cars.findIndex(
        (c) => c.collider.handle === (a === this.ballCollider.handle ? b : a),
      );
      if (carIndex >= 0) {
        this.lastTouchId = this.cars[carIndex].id;
        this.strike(carIndex);
      } else {
        const speed = new Vector3()
          .subVectors(
            this.ball.linvel(),
            this.ballPose.current
              .clone()
              .sub(this.ballPose.previous)
              .multiplyScalar(1 / P.dt),
          )
          .length();
        if (speed > 1)
          this.hits.push({
            position: new Vector3().copy(this.ball.translation()),
            normal: new Vector3(0, 1, 0),
            relative: new Vector3(),
            impulse: new Vector3(),
            strength: Math.min(speed, 20),
            age: 0,
          });
      }
    });
    const cap = (body: RAPIER.RigidBody, speed: number, angular: number) => {
      const v = new Vector3().copy(body.linvel()),
        w = new Vector3().copy(body.angvel());
      if (v.length() > speed) body.setLinvel(v.clampLength(0, speed), true);
      if (w.length() > angular) body.setAngvel(w.clampLength(0, angular), true);
    };
    cap(this.ball, P.ball.maxSpeed, P.ball.maxAngular);
    this.cars.forEach((c) => {
      c.constrainSurface(true);
      cap(c.body, P.car.maxSpeed, c.angularLimit);
      c.pose.after();
    });
    this.ballPose.after();
  }
  private strike(i: number) {
    if (this.cooldown[i] > 0) return;
    this.cooldown[i] = P.hit.cooldown;
    const c = this.cars[i],
      n = new Vector3()
        .subVectors(this.ball.translation(), c.body.translation())
        .normalize(),
      closing = Math.max(0, this.relative[i].dot(n));
    if (closing < P.hit.minClosing) return;
    const local = n
      .clone()
      .applyQuaternion(new Quaternion().copy(c.body.rotation()).invert());
    const front = Math.max(0, -local.z),
      roof = Math.max(0, local.y),
      underside = Math.max(0, -local.y);
    const gain =
      P.hit.sideGain +
      (P.hit.frontGain - P.hit.sideGain) * front * front +
      (P.hit.roofGain - P.hit.sideGain) * roof * roof +
      (P.hit.undersideGain - P.hit.sideGain) * underside * underside;
    const direction = n
      .clone()
      .lerp(c.forward, 0.22 * front)
      .normalize();
    const impulse = direction.multiplyScalar(
      Math.min(P.hit.maxExtra, closing * gain) * P.ball.mass,
    );
    const point = new Vector3()
      .copy(this.ball.translation())
      .addScaledVector(n, -P.ball.radius);
    this.ball.applyImpulseAtPoint(impulse, point, true);
    this.hits.push({
      position: point,
      normal: n,
      relative: this.relative[i].clone(),
      impulse: impulse.clone(),
      strength: closing,
      age: 0,
    });
  }
  private bump(first: number, second: number) {
    const a = this.cars[first],
      b = this.cars[second];
    for (const [i, j] of [
      [first, second],
      [second, first],
    ]) {
      const attacker = this.cars[i],
        victim = this.cars[j];
      if (
        !canDemolish(attacker, victim, this.velocities[i], this.velocities[j])
      )
        continue;
      let bumperContact = false;
      this.world.contactPair(
        attacker.collider,
        victim.collider,
        (manifold, flipped) => {
          for (let k = 0; k < manifold.numContacts(); k++) {
            const point = flipped
              ? manifold.localContactPoint2(k)
              : manifold.localContactPoint1(k);
            if (
              point &&
              point.z < -bodies[attacker.bodyId].halfLength * 0.8 &&
              manifold.contactDist(k) < 0.03
            )
              bumperContact = true;
          }
        },
      );
      if (!bumperContact) continue;
      victim.demolitionState = "demolished";
      victim.respawnTimer = P.demolition.respawn;
      victim.boosting = victim.supersonic = false;
      victim.skidIntensity = 0;
      victim.wheelContact.fill(false);
      victim.collider.setCollisionGroups(0);
      victim.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      victim.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      victim.body.setEnabled(false);
      this.demolitions.push({
        attackerId: attacker.id,
        victimId: victim.id,
        position: new Vector3().copy(victim.body.translation()),
        age: 0,
      });
      return;
    }
    const normal = new Vector3()
      .subVectors(b.body.translation(), a.body.translation())
      .normalize();
    const relative = this.relative[first].clone().sub(this.relative[second]);
    const closing = Math.max(0, relative.dot(normal));
    if (closing < P.bump.minClosing) return;
    const impulse = normal
      .clone()
      .multiplyScalar(
        Math.min(P.bump.maxExtra, closing * P.bump.gain) * P.car.mass,
      );
    a.body.applyImpulse(impulse.clone().negate(), true);
    b.body.applyImpulse(impulse, true);
    a.impactTime = b.impactTime = P.bump.recovery;
    this.hits.push({
      position: new Vector3()
        .copy(a.body.translation())
        .lerp(b.body.translation(), 0.5),
      normal,
      relative,
      impulse,
      strength: closing,
      age: 0,
    });
  }
  dispose() {
    this.events.free();
    this.world.free();
  }
}
