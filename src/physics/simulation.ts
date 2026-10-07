import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { P } from "../config/physics";
import { Car } from "../car/car";
import { createArena, insideArena } from "../arena/physics";
import { Pose } from "./pose";
import type { Controls } from "../input/types";
import {
  neutralInput,
  type PlayerEntity,
  type PlayerInput,
} from "../../shared/player";
import { canDemolish, respawnLocations } from "../game/demolition";
import { bodies } from "../game/inventory";
import { kickoffSpawn, type KickoffFormation } from "../../shared/kickoff";
import { CarBallContact } from "./car-ball";
import { Heatseeker, isBackboard } from "../game/heatseeker";
import type { SoccerMode } from "../../shared/soccer";
import { HEATSEEKER as H } from "../config/heatseeker";
// Initialize the same Rapier module used by the simulation, including in Node.
export const initializeSimulation = () => RAPIER.init();
export interface Hit {
  position: Vector3;
  normal: Vector3;
  relative: Vector3;
  impulse: Vector3;
  strength: number;
  age: number;
}
export class Simulation {
  gameMode: SoccerMode = "soccar";
  heatseeker: Heatseeker | null = null;
  private heatContacts = new Set<string>();
  private backboardContact: number | null = null;
  setGameMode(mode: SoccerMode) {
    this.gameMode = mode;
    this.heatseeker = mode === "heatseeker" ? new Heatseeker() : null;
    this.heatContacts.clear();
    this.backboardContact = null;
  }
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
  lastTouchTime = -Infinity;
  touchSequence = 0;
  readonly touchEvents: { playerId: string; time: number }[] = [];
  readonly players: PlayerEntity[];
  private velocities: Vector3[] = [];
  ballContacts: CarBallContact[];
  private relative: Vector3[] = [];
  arenaCollider?: RAPIER.Collider;
  containmentRecoveries = 0;
  constructor(
    flat = false,
    players: PlayerEntity[] = [
      { id: "player", name: "Guest", team: 0, controller: "local" },
      { id: "bot", name: "Rival", team: 1, controller: "bot" },
    ],
  ) {
    this.players = players;
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
    this.world.maxCcdSubsteps = 4;
    this.arenaCollider = createArena(this.world, flat);
    this.cars = players.map(() => new Car(this.world));
    this.velocities = players.map(() => new Vector3());
    this.relative = players.map(() => new Vector3());
    this.ballContacts = players.map(() => new CarBallContact());
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
  reset(formation?: KickoffFormation) {
    for (const c of this.cars)
      if (c.demolitionState !== "active") {
        c.body.setEnabled(true);
        c.collider.setCollisionGroups(0xffffffff);
      }
    this.demolitions = [];
    this.lastTouchId = null;
    this.lastTouchTime = -Infinity;
    this.touchEvents.length = 0;
    this.ballCollider.setCollisionGroups(0xffffffff);
    this.ball.setEnabled(true);
    for (const c of this.cars) {
      const team = this.cars.filter((p) => p.team === c.team),
        slot = team.indexOf(c);
      const spawn = formation
        ? kickoffSpawn(formation.slots[slot], c.team, P.arena)
        : null;
      c.reset(
        spawn?.x ??
          (team.length === 1 ? 0 : (slot - (team.length - 1) / 2) * 12),
        spawn?.z ?? (c.team === 0 ? 26 : -26),
        spawn?.yaw ?? (c.team === 0 ? 0 : Math.PI),
      );
    }
    this.ball.setTranslation({ x: 0, y: P.ball.radius + 0.02, z: 0 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ballPose.snap();
    this.hits = [];
    this.ballContacts.forEach((contact) => contact.reset());
    this.heatContacts.clear();
    this.backboardContact = null;
    if (this.heatseeker) {
      const receiver = Math.random() < 0.5 ? 0 : 1;
      this.heatseeker.reset(receiver);
      const direction = receiver === 0 ? 1 : -1;
      this.cars.forEach((c) => {
        const team = this.cars.filter((p) => p.team === c.team),
          slot = team.indexOf(c);
        c.reset(
          team.length === 1 ? 0 : (slot - 0.5) * 10,
          (c.team === 0 ? 1 : -1) * H.kickoffCarDistance,
          c.team === 0 ? 0 : Math.PI,
        );
      });
      this.ball.setTranslation(
        { x: 0, y: P.ball.radius + 0.02, z: direction * H.kickoffBallDistance },
        true,
      );
      this.ballPose.snap();
    }
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
    this.touchEvents.length = 0;
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
      this.ballContacts[i].sample(c, this.ball);
    });
    this.ballPose.before();
    this.heatseeker?.steer(this.ball, P.dt);
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
        this.recordTouch(this.cars[carIndex].id);
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
    const heatContacts = new Set<string>();
    this.cars.forEach((car, i) => {
      const response = this.ballContacts[i];
      let touched = false;
      if (car.body.isEnabled() && this.ball.isEnabled())
        this.world.contactPair(
          car.collider,
          this.ballCollider,
          (manifold, flipped) => {
            if (manifold.numSolverContacts() === 0) return;
            const normal = new Vector3()
              .copy(manifold.normal())
              .multiplyScalar(flipped ? -1 : 1);
            const point = new Vector3().copy(manifold.solverContactPoint(0));
            if (touched) return;
            touched = true;
            this.recordTouch(car.id);
            response.resolve(car, this.ball, point, normal);
            if (this.heatseeker) {
              heatContacts.add(car.id);
              if (!this.heatContacts.has(car.id))
                this.heatseeker.touch(car.id, car.team as 0 | 1, this.clock);
            }
            if (response.impulse.lengthSq() > 0)
              this.hits.push({
                position: point,
                normal,
                relative: response.relative.clone(),
                impulse: response.impulse.clone(),
                strength: response.closing,
                age: 0,
              });
          },
        );
      if (!touched) response.separate();
    });
    this.heatContacts = heatContacts;
    if (this.heatseeker && this.arenaCollider && this.ball.isEnabled()) {
      let board: 0 | 1 | null = null;
      this.world.contactPair(
        this.ballCollider,
        this.arenaCollider,
        (manifold) => {
          for (let i = 0; i < manifold.numSolverContacts(); i++) {
            const point = manifold.solverContactPoint(i),
              normal = manifold.normal();
            for (const team of [0, 1] as const)
              if (isBackboard(point, normal, team)) board = team;
          }
        },
      );
      if (board !== null && board !== this.backboardContact)
        this.heatseeker.backboard(board);
      this.backboardContact = board;
    }
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
      if (
        this.arenaCollider &&
        c.body.isEnabled() &&
        !insideArena(this.arenaCollider, c.body.translation())
      ) {
        const boost = c.boost;
        c.reset(
          (this.cars.indexOf(c) - 1.5) * 4,
          c.team === 0 ? 26 : -26,
          c.team === 0 ? 0 : Math.PI,
        );
        c.boost = boost;
        this.containmentRecoveries++;
      }
      c.pose.after();
    });
    if (
      this.arenaCollider &&
      this.ball.isEnabled() &&
      !insideArena(this.arenaCollider, this.ball.translation())
    ) {
      this.ball.setTranslation({ x: 0, y: P.ball.radius + 0.1, z: 0 }, true);
      this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.lastTouchId = null;
      this.ballPose.snap();
      this.containmentRecoveries++;
    }
    this.ballPose.after();
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
  private recordTouch(id: string) {
    if (!this.touchEvents.some((event) => event.playerId === id))
      this.touchEvents.push({ playerId: id, time: this.clock });
    if (this.lastTouchId !== id || this.lastTouchTime !== this.clock)
      this.touchSequence++;
    this.lastTouchId = id;
    this.lastTouchTime = this.clock;
  }
  dispose() {
    this.events.free();
    this.world.free();
  }
}
