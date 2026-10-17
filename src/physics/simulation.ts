import { createDropshotArena, insideDropshot } from "../arena/dropshot";
import { Dropshot } from "../game/dropshot";
import { DROPSHOT_CONFIG as D, dropshotSpawn } from "../../shared/dropshot";
import {
  HOOPS_CAR_GROUP,
  HOOPS_BALL_GROUP,
  DROPSHOT_CAR_GROUP,
  DROPSHOT_BALL_GROUP,
} from "./collision-groups";
import { createHoopsArena } from "../arena/hoops";
import { HOOPS_CONFIG as HOOPS, hoopsSpawn } from "../../shared/hoops";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { P } from "../config/physics";
import {
  DEFAULT_MUTATORS,
  matchMutators,
  type MatchMutators,
} from "../../shared/mutators";
import { resolveMutators, type MatchPhysics } from "../config/mutators";
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
import {
  Heatseeker,
  isBackboard,
  heatseekerServeSpawn,
} from "../game/heatseeker";
import type { SoccerMode } from "../../shared/soccer";
import { HEATSEEKER as H } from "../config/heatseeker";
import type { StatTouch } from "../game/match-stats";
import type { BallSample } from "../game/ball-prediction";
import { BallGroundContact } from "./ball-ground";
// Initialize the same Rapier module used by the simulation, including in Node.
export const initializeSimulation = () => RAPIER.init();
export interface Hit {
  kind?: "rim";
  position: Vector3;
  normal: Vector3;
  relative: Vector3;
  impulse: Vector3;
  strength: number;
  age: number;
}
import { Rumble } from "../game/rumble";
export class Simulation {
  mutators: MatchMutators = DEFAULT_MUTATORS;
  physics: MatchPhysics = P;
  configureMutators(config: MatchMutators = DEFAULT_MUTATORS) {
    this.mutators = matchMutators(config);
    this.physics = resolveMutators(this.mutators);
    this.world.gravity = { x: 0, y: -this.physics.gravity, z: 0 };
    this.cars.forEach((c) => {
      c.physics = this.physics;
      c.mutators = this.mutators;
      c.jump.configureAirJumps(this.mutators.airJumps);
      c.applyBoostRule();
    });
    this.ballCollider.setRadius(this.physics.ball.radius);
    this.ballCollider.setMass(this.physics.ball.mass);
    this.ballCollider.setRestitution(this.physics.ball.restitution);
    this.ball.recomputeMassPropertiesFromColliders();
    this.ballGround.reset();
    this.ballContacts.forEach((c) => c.reset());
  }
  readonly statTouches: StatTouch[] = [];
  private statContacts = new Set<string>();
  private ballSample(): BallSample {
    return {
      position: { ...this.ball.translation() },
      velocity: { ...this.ball.linvel() },
      heat: this.heatseeker ? { ...this.heatseeker.state } : null,
      physics: this.physics,
      mode: this.gameMode,
      dropshot: this.dropshot ? { tiles: this.dropshot.tiles } : undefined,
    };
  }
  gameMode: SoccerMode = "soccar";
  dropshot: Dropshot | null = null;
  heatseeker: Heatseeker | null = null;
  rumble: Rumble | null = null;
  private heatContacts = new Set<string>();
  private backboardContact: number | null = null;
  setGameMode(mode: SoccerMode) {
    if (
      mode !== this.gameMode &&
      [mode, this.gameMode].some((m) => m === "hoops" || m === "dropshot")
    )
      this.switchArena(mode);
    this.rumble?.dispose();
    this.gameMode = mode;
    this.ballCollider.setCollisionGroups(
      mode === "hoops"
        ? HOOPS_BALL_GROUP
        : mode === "dropshot"
          ? DROPSHOT_BALL_GROUP
          : 0xffffffff,
    );
    this.cars.forEach((c) =>
      c.collider.setCollisionGroups(
        mode === "hoops"
          ? HOOPS_CAR_GROUP
          : mode === "dropshot"
            ? DROPSHOT_CAR_GROUP
            : 0xffffffff,
      ),
    );
    this.cars.forEach((c) => {
      c.infiniteBoost = mode === "heatseeker";
      c.applyBoostRule();
    });
    this.rumble = mode === "rumble" ? new Rumble(this) : null;
    this.heatseeker =
      mode === "heatseeker" ? new Heatseeker(0, this.physics) : null;
    this.heatContacts.clear();
    this.backboardContact = null;
  }
  world: RAPIER.World;
  cars: Car[];
  ball: RAPIER.RigidBody;
  ballCollider: RAPIER.Collider;
  ballPose: Pose;
  readonly ballGround: BallGroundContact;
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
  private flatArena = false;
  private arenaColliders: RAPIER.Collider[] = [];
  private hoopLaunchPending = false;
  private hoopRims = new Set<number>();
  private switchArena(mode: SoccerMode) {
    this.dropshot = null;
    this.hoopRims.clear();
    for (const c of this.arenaColliders) this.world.removeCollider(c, true);
    if (mode === "dropshot") {
      const a = createDropshotArena(this.world);
      this.arenaCollider = a.shell;
      this.arenaColliders = a.colliders;
      this.dropshot = new Dropshot(a);
    } else if (mode === "hoops") {
      const a = createHoopsArena(this.world);
      this.arenaCollider = a.shell;
      this.arenaColliders = a.colliders;
      this.hoopRims = new Set(a.rims.map((c) => c.handle));
    } else {
      const c = createArena(this.world, this.flatArena);
      this.arenaCollider = this.flatArena ? undefined : c;
      this.arenaColliders = [c];
    }
    this.ballGround?.setArena(this.arenaColliders[0]);
  }
  launchKickoff() {
    if (
      (this.gameMode === "hoops" || this.gameMode === "dropshot") &&
      this.hoopLaunchPending
    ) {
      this.ball.setLinvel(
        {
          x: 0,
          y:
            this.gameMode === "dropshot"
              ? D.kickoffVerticalVelocity
              : HOOPS.kickoffVerticalVelocity,
          z: 0,
        },
        true,
      );
      this.hoopLaunchPending = false;
    }
  }
  containmentRecoveries = 0;
  constructor(
    flat = false,
    players: PlayerEntity[] = [
      { id: "player", name: "Guest", team: 0, controller: "local" },
      { id: "bot", name: "Rival", team: 1, controller: "bot" },
    ],
  ) {
    this.players = players;
    this.flatArena = flat;
    if (
      players.length < 1 ||
      players.length > 6 ||
      new Set(players.map((p) => p.id)).size !== players.length ||
      players.some((p) => !p.id || ![0, 1].includes(p.team))
    )
      throw Error("A simulation needs 1–6 unique player IDs and valid teams");
    this.world = new RAPIER.World({ x: 0, y: -P.gravity, z: 0 });
    this.world.timestep = P.dt;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 4;
    const arenaSurface = createArena(this.world, flat);
    this.arenaCollider = flat ? undefined : arenaSurface;
    this.arenaColliders = [arenaSurface];
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
        .setTranslation(0, this.physics.ball.radius + 0.02, 0)
        .setCcdEnabled(true)
        .setLinearDamping(P.ball.drag)
        .setAngularDamping(P.ball.angularDrag),
    );
    this.ballCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(this.physics.ball.radius)
        .setMass(this.physics.ball.mass)
        .setFriction(P.ball.friction)
        .setRestitution(P.ball.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.ball,
    );
    this.ballPose = new Pose(this.ball);
    this.ballGround = new BallGroundContact(
      this.world,
      this.ballCollider,
      arenaSurface,
    );
    this.reset();
    this.world.step();
    this.cars.forEach((c) => c.pose.snap());
    this.ballPose.snap();
  }
  reset(formation?: KickoffFormation) {
    this.dropshot?.reset();
    this.rumble?.reset();
    this.ballGround.reset();
    this.statContacts.clear();
    this.statTouches.length = 0;
    for (const c of this.cars)
      if (c.demolitionState !== "active") {
        c.body.setEnabled(true);
        c.collider.setCollisionGroups(
          this.gameMode === "hoops"
            ? HOOPS_CAR_GROUP
            : this.gameMode === "dropshot"
              ? DROPSHOT_CAR_GROUP
              : 0xffffffff,
        );
      }
    this.demolitions = [];
    this.lastTouchId = null;
    this.lastTouchTime = -Infinity;
    this.touchEvents.length = 0;
    this.ballCollider.setCollisionGroups(
      this.gameMode === "hoops"
        ? HOOPS_BALL_GROUP
        : this.gameMode === "dropshot"
          ? DROPSHOT_BALL_GROUP
          : 0xffffffff,
    );
    this.ball.setEnabled(true);
    for (const c of this.cars) {
      const team = this.cars.filter((p) => p.team === c.team),
        slot = team.indexOf(c);
      const spawn =
        this.gameMode === "dropshot"
          ? dropshotSpawn(c.team, slot, team.length)
          : this.gameMode === "hoops"
            ? hoopsSpawn(c.team, slot, team.length)
            : formation
              ? kickoffSpawn(formation.slots[slot], c.team, P.arena)
              : null;
      c.reset(
        spawn?.x ??
          (team.length === 1 ? 0 : (slot - (team.length - 1) / 2) * 12),
        spawn?.z ?? (c.team === 0 ? 26 : -26),
        spawn?.yaw ?? (c.team === 0 ? 0 : Math.PI),
      );
      if (this.gameMode === "dropshot") {
        c.boost = 100;
        c.applyBoostRule();
      }
    }
    this.ball.setTranslation(
      {
        x: 0,
        y:
          this.gameMode === "hoops"
            ? Math.max(HOOPS.kickoffBallHeight, this.physics.ball.radius + 0.02)
            : this.physics.ball.radius + 0.02,
        z: 0,
      },
      true,
    );
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ballPose.snap();
    this.hoopLaunchPending =
      this.gameMode === "hoops" || this.gameMode === "dropshot";
    this.cars.forEach((c) => c.applyBoostRule());
    this.hits = [];
    this.ballContacts.forEach((contact) => contact.reset());
    this.heatContacts.clear();
    this.backboardContact = null;
    if (this.heatseeker) {
      const receiver = Math.random() < 0.5 ? 0 : 1;
      this.heatseeker.reset(receiver);
      this.cars.forEach((c) => {
        const team = this.cars.filter((p) => p.team === c.team),
          slot = team.indexOf(c);
        c.reset(
          team.length === 1 ? 0 : (slot - (team.length - 1) / 2) * 10,
          (c.team === 0 ? 1 : -1) * H.kickoffCarDistance,
          c.team === 0 ? 0 : Math.PI,
        );
      });
      this.cars.forEach((c) => c.applyBoostRule());
      this.ball.setTranslation(
        heatseekerServeSpawn(receiver, this.physics.ball.radius),
        true,
      );
      this.ballPose.snap();
    }
  }
  /** Entity lifecycle only: reuse the world, arena, ball and vehicle forces. */
  configurePlayers(players: PlayerEntity[]) {
    this.rumble?.dispose();
    this.rumble = null;
    if (
      !players.length ||
      players.length > 6 ||
      new Set(players.map((p) => p.id)).size !== players.length ||
      players.some((p) => !p.id || ![0, 1].includes(p.team))
    )
      throw Error("Invalid player roster");
    while (this.cars.length > players.length) {
      const car = this.cars.pop()!;
      this.world.removeRigidBody(car.body);
    }
    while (this.cars.length < players.length) {
      const car = new Car(this.world);
      car.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.cars.push(car);
    }
    this.players.splice(0, this.players.length, ...players);
    this.cars.forEach((car, i) => {
      car.id = players[i].id;
      car.team = players[i].team;
      car.displayName = players[i].name;
      car.body.setEnabled(true);
      car.collider.setCollisionGroups(
        this.gameMode === "hoops"
          ? HOOPS_CAR_GROUP
          : this.gameMode === "dropshot"
            ? DROPSHOT_CAR_GROUP
            : 0xffffffff,
      );
    });
    this.velocities = this.cars.map(() => new Vector3());
    this.relative = this.cars.map(() => new Vector3());
    this.ballContacts = this.cars.map(() => new CarBallContact());
    this.configureMutators(this.mutators);
    this.reset();
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
    this.statTouches.length = 0;
    this.clock += P.dt;
    this.dropshot?.tick(P.dt, this.clock);
    this.touchEvents.length = 0;
    this.demolitions = this.demolitions.filter((e) => (e.age += P.dt) < 1);
    this.cars.forEach((c) => {
      if (c.demolitionState === "active") return;
      c.respawnTimer = Math.max(0, c.respawnTimer - P.dt);
      if (c.respawnTimer > 1e-8) return;
      c.demolitionState = "respawning";
      const locations =
          this.gameMode === "dropshot"
            ? [0, 1].map((slot) => {
                const p = this.dropshot!.respawnPoint(c.team, slot);
                return new Vector3(p.x, 0.31, p.z);
              })
            : this.gameMode === "hoops"
              ? [0, 1].map((slot) => {
                  const p = hoopsSpawn(c.team, slot, 2);
                  return new Vector3(p.x, 0.31, p.z);
                })
              : respawnLocations(c.team),
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
        c.boost = this.gameMode === "dropshot" ? 100 : P.demolition.boost;
        c.collider.setCollisionGroups(
          this.gameMode === "hoops"
            ? HOOPS_CAR_GROUP
            : this.gameMode === "dropshot"
              ? DROPSHOT_CAR_GROUP
              : 0xffffffff,
        );
        c.body.setEnabled(true);
        break;
      }
    });
    this.hits = this.hits.filter((h) => (h.age += P.dt) < 0.6);
    this.cars.forEach((c, i) => {
      c.pose.before();
      if (!passive && c.body.isEnabled()) {
        c.grapplePulling =
          this.rumble?.players.get(c.id)?.phase === "active" &&
          this.rumble.players.get(c.id)?.item === "GRAPPLING_HOOK";
        c.tick(
          (Array.isArray(inputs) ? inputs[i] : inputs.get(c.id)) ??
            neutralInput(),
        );
      }
      if (!passive)
        this.dropshot?.regenBoost(
          c,
          (Array.isArray(inputs) ? inputs[i] : inputs.get(c.id))?.boost ??
            false,
          P.dt,
        );
      c.constrainSurface();
      c.updateSupersonic(P.dt);
      this.velocities[i].copy(c.body.linvel());
      this.relative[i].copy(c.body.linvel()).sub(this.ball.linvel());
    });
    this.ballPose.before();
    this.rumble?.beforeStep(inputs);
    this.heatseeker?.steer(this.ball, P.dt);
    // Sample the actual pre-solver velocity, including this tick's homing force.
    this.cars.forEach((c, i) => this.ballContacts[i].sample(c, this.ball));
    const statBefore = this.ballSample();
    this.world.step(this.events);
    this.ballGround.update();
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
            kind: this.hoopRims.has(a === this.ballCollider.handle ? b : a)
              ? "rim"
              : undefined,
            age: 0,
          });
      }
    });
    const heatContacts = new Set<string>();
    const statContacts = new Set<string>();
    this.cars.forEach((car, i) => {
      const response = this.ballContacts[i];
      let touched = false;
      if (car.body.isEnabled() && this.ball.isEnabled())
        response.sampleResetSupport(car, this.ball);
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
            let solverImpulse = 0;
            for (let k = 0; k < manifold.numContacts(); k++)
              solverImpulse += Math.abs(manifold.contactImpulse(k));
            this.rumble?.contact(
              car,
              point,
              normal,
              Math.max(0, solverImpulse + response.impulse.dot(normal)),
              !this.statContacts.has(car.id),
            );
            if (!this.statContacts.has(car.id))
              this.dropshot?.touch(
                car.id,
                car.team as 0 | 1,
                Math.max(
                  solverImpulse / this.physics.ball.mass,
                  response.closing,
                ),
              );
            statContacts.add(car.id);
            if (this.heatseeker) {
              heatContacts.add(car.id);
              if (!this.heatContacts.has(car.id))
                this.heatseeker.touch(car.id, car.team as 0 | 1, this.clock);
            }
            if (
              !this.statContacts.has(car.id) &&
              !this.statTouches.some((t) => t.playerId === car.id)
            ) {
              let normalImpulse = 0;
              for (let k = 0; k < manifold.numContacts(); k++)
                normalImpulse += manifold.contactImpulse(k);
              this.statTouches.push({
                playerId: car.id,
                before: statBefore,
                after: this.ballSample(),
                impulseSpeed:
                  Math.max(0, normalImpulse + response.impulse.dot(normal)) /
                  this.physics.ball.mass,
              });
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
      if (!touched) response.separate(car, this.ball);
    });
    if (this.dropshot && this.ball.isEnabled()) {
      this.dropshot.afterStep(
        this.ball,
        this.ballCollider,
        this.world,
        statBefore.position,
        statBefore.velocity,
        this.physics.ball.radius,
        this.clock,
      );
      this.ballGround.grounded = this.dropshot.grounded;
    }
    this.rumble?.afterStep();
    this.heatContacts = heatContacts;
    this.statContacts = statContacts;
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
    cap(this.ball, this.physics.ball.maxSpeed, P.ball.maxAngular);
    this.cars.forEach((c) => {
      c.constrainSurface(true);
      cap(c.body, this.physics.car.maxSpeed, c.angularLimit);
      if (
        this.arenaCollider &&
        c.body.isEnabled() &&
        (this.dropshot
          ? !insideDropshot(c.body.translation())
          : !insideArena(this.arenaCollider, c.body.translation()))
      ) {
        const boost = c.boost;
        this.rumble?.end(c.id);
        const team = this.cars.filter((p) => p.team === c.team),
          spawn =
            this.gameMode === "dropshot"
              ? dropshotSpawn(c.team, team.indexOf(c), team.length)
              : this.gameMode === "hoops"
                ? hoopsSpawn(c.team, team.indexOf(c), team.length)
                : null;
        c.reset(
          spawn?.x ?? (this.cars.indexOf(c) - 1.5) * 4,
          spawn?.z ?? (c.team === 0 ? 26 : -26),
          spawn?.yaw ?? (c.team === 0 ? 0 : Math.PI),
        );
        c.boost = boost;
        this.containmentRecoveries++;
      }
      if (
        this.dropshot &&
        c.body.isEnabled() &&
        c.body.translation().y < D.carFallDepth
      )
        this.demolish(c, c);
      c.pose.after();
    });
    if (
      this.arenaCollider &&
      this.ball.isEnabled() &&
      (this.dropshot
        ? !insideDropshot(this.ball.translation())
        : !insideArena(this.arenaCollider, this.ball.translation()))
    ) {
      this.rumble?.recoverBall();
      this.ball.setTranslation(
        { x: 0, y: this.physics.ball.radius + 0.1, z: 0 },
        true,
      );
      this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.lastTouchId = null;
      this.ballPose.snap();
      this.containmentRecoveries++;
    }
    for (const touch of this.statTouches) touch.after = this.ballSample();
    this.ballPose.after();
  }
  demolish(attacker: Car, victim: Car) {
    this.rumble?.end(victim.id);
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
  }
  powerTouch(id: string, action: () => void, impulseSpeed: number) {
    const before = this.ballSample();
    action();
    this.recordTouch(id);
    this.statTouches.push({
      playerId: id,
      before,
      after: this.ballSample(),
      impulseSpeed,
    });
  }
  private bump(first: number, second: number) {
    const a = this.cars[first],
      b = this.cars[second];
    if (
      a.team !== b.team &&
      (this.rumble?.powerHitter(a.id) || this.rumble?.powerHitter(b.id))
    ) {
      const normalDemo = (attacker: Car, victim: Car, i: number, j: number) => {
        if (
          !canDemolish(attacker, victim, this.velocities[i], this.velocities[j])
        )
          return false;
        let bumper = false;
        this.world.contactPair(
          attacker.collider,
          victim.collider,
          (m, flipped) => {
            for (let k = 0; k < m.numContacts(); k++) {
              const point = flipped
                ? m.localContactPoint2(k)
                : m.localContactPoint1(k);
              if (
                point &&
                point.z < -bodies[attacker.bodyId].halfLength * 0.8 &&
                m.contactDist(k) < 0.03
              )
                bumper = true;
            }
          },
        );
        return bumper;
      };
      const firstDemo =
        !!this.rumble?.powerHitter(a.id) || normalDemo(a, b, first, second);
      const secondDemo =
        !!this.rumble?.powerHitter(b.id) || normalDemo(b, a, second, first);
      // Decide both outcomes before changing either body: the powered player
      // still takes a legitimate ordinary supersonic demo (mutual contact).
      if (firstDemo) this.demolish(a, b);
      if (secondDemo) this.demolish(b, a);
      if (firstDemo || secondDemo) return;
    }
    for (const [i, j] of [
      [first, second],
      [second, first],
    ]) {
      const attacker = this.cars[i],
        victim = this.cars[j];
      if (
        !(
          this.rumble?.powerHitter(attacker.id) &&
          attacker.team !== victim.team &&
          attacker.body.isEnabled() &&
          victim.body.isEnabled()
        ) &&
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
      if (!bumperContact && !this.rumble?.powerHitter(attacker.id)) continue;
      this.demolish(attacker, victim);
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
    this.rumble?.dispose();
    this.events.free();
    this.world.free();
  }
}
