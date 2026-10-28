import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { Simulation } from "../physics/simulation";
import { refreshStaticQueries } from "../physics/queries";
import { FixedLoop } from "../physics/loop";
import { P } from "../config/physics";
import { NETWORK as N } from "../../shared/network-tuning";
import { DropshotView } from "../../shared/dropshot";
import type {
  MatchSnapshot,
  CarSnapshot,
  NetPlayer,
} from "../../shared/network";
import type { PlayerInput } from "../../shared/player";

/** A speculative collision world only. No AI, scoring, damage, demolition,
 * power-up activation or final ball authority runs on a client. */
export class LocalCarPrediction {
  readonly simulation: Simulation;
  readonly car;
  private loop = new FixedLoop();
  private pending: { sequence: number; input: PlayerInput }[] = [];
  private offset = new Vector3();
  private ballOffset = new Vector3();
  private rotationOffset = new Quaternion();
  private reset = -1;
  private teleport = -1;
  private enabled = true;
  private tick = -1;
  private now = 0;
  private latest: MatchSnapshot;
  private dropshotView = new DropshotView();
  private dropshotRevision = "";
  private position = new Vector3();
  private rotation = new Quaternion();
  private axis = new Vector3();
  private deltaRotation = new Quaternion();
  private contactNormal = new Vector3();
  private contactPoint = new Vector3();
  private identity = new Quaternion();
  private contactAge = Infinity;
  private contactSequence = -1;
  correctionDistance = 0;
  correctionRotation = 0;
  ballCorrectionDistance = 0;
  hardCorrections = 0;
  interactionBlend = 0;
  private rendered = { position: new Vector3(), quaternion: new Quaternion() };
  readonly ballFrame = {
    position: new Vector3(),
    rotation: new Quaternion(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    angularVelocity: new Vector3(),
    enabled: false,
  };
  constructor(player: NetPlayer, initial: MatchSnapshot) {
    this.latest = initial;
    const roster = initial.players.map((p) => ({
      ...p,
      controller: p.id === player.id ? ("local" as const) : ("remote" as const),
    }));
    this.simulation = new Simulation(false, roster);
    this.simulation.configureMutators(initial.mutators);
    this.simulation.setGameMode(initial.gameMode ?? "soccar");
    this.car = this.simulation.cars.find((c) => c.id === player.id)!;
    this.simulation.cars.forEach((c) => {
      c.setBody(initial.players.find((p) => p.id === c.id)!.preset.body);
      if (c !== this.car)
        c.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    });
    this.simulation.ball.setEnabled(initial.ball.enabled);
    refreshStaticQueries(this.simulation);
  }
  private seed(state: CarSnapshot) {
    const c = this.car;
    c.body.setEnabled(state.enabled);
    c.demolitionState = state.enabled ? "active" : "demolished";
    c.body.setTranslation(state.position, true);
    c.body.setRotation(state.rotation, true);
    c.body.setLinvel(state.velocity, true);
    c.body.setAngvel(state.angularVelocity ?? { x: 0, y: 0, z: 0 }, true);
    c.boost = state.boost;
    c.normal.copy(state.normal);
    c.grounded = state.grounded;
    c.jump.flipLeft = state.flipLeft;
    c.teleportSequence = state.teleportSequence ?? 0;
    if (state.prediction) c.restorePrediction(state.prediction);
    else {
      c.clearSurfaceHistory();
      c.jump.wasDown = false;
    }
    c.pose.snap();
  }
  private seedWorld(snapshot: MatchSnapshot) {
    const s = this.simulation;
    s.ball.setEnabled(snapshot.ball.enabled);
    s.ball.setTranslation(snapshot.ball.position, true);
    s.ball.setRotation(snapshot.ball.rotation, true);
    s.ball.setLinvel(snapshot.ball.velocity ?? { x: 0, y: 0, z: 0 }, true);
    s.ball.setAngvel(
      snapshot.ball.angularVelocity ?? { x: 0, y: 0, z: 0 },
      true,
    );
    s.ballPose.snap();
    if (snapshot.heatseeker && s.heatseeker)
      Object.assign(s.heatseeker.state, snapshot.heatseeker);
    for (const remote of s.cars) {
      if (remote === this.car) continue;
      const state = snapshot.cars.find((c) => c.id === remote.id)!;
      remote.body.setEnabled(state.enabled);
      remote.body.setTranslation(state.position, true);
      remote.body.setRotation(state.rotation, true);
      remote.pose.snap();
    }
    if (snapshot.dropshot && s.dropshot) {
      this.dropshotView.apply(snapshot.dropshot);
      const key = this.dropshotView.epoch + ":" + this.dropshotView.revision;
      if (key !== this.dropshotRevision) {
        this.dropshotRevision = key;
        s.dropshot.states = this.dropshotView.tiles
          .split("")
          .map((v) => Number(v) as 0 | 1 | 2);
        s.dropshot.arena.tiles.forEach((collider, i) =>
          collider.setEnabled(this.dropshotView.tiles[i] !== "2"),
        );
        refreshStaticQueries(s);
      }
    }
  }
  private step(input: PlayerInput) {
    const c = this.car,
      s = this.simulation;
    if (!c.body.isEnabled()) return;
    c.pose.before();
    s.ballPose.before();
    this.contactAge += P.dt;
    // Meaningful remote colliders at every 120-Hz tick. setNextKinematic*
    // supplies swept motion and velocity, rather than packet-sized teleports.
    for (const remote of s.cars) {
      if (remote === c || !remote.body.isEnabled()) continue;
      remote.pose.before();
      const state = this.latest.cars.find((p) => p.id === remote.id)!;
      const lead = Math.max(
        0,
        Math.min(N.extrapolationSeconds, this.now + P.dt - this.latest.time),
      );
      this.position
        .copy(state.position)
        .addScaledVector(state.velocity as Vector3, lead);
      this.rotation.copy(state.rotation);
      if (state.angularVelocity) {
        const speed = this.axis.copy(state.angularVelocity).length();
        if (speed > 1e-6)
          this.rotation.premultiply(
            this.deltaRotation.setFromAxisAngle(
              this.axis.divideScalar(speed),
              speed * lead,
            ),
          );
      }
      remote.body.setNextKinematicTranslation(this.position);
      remote.body.setNextKinematicRotation(this.rotation);
      remote.forward.set(0, 0, -1).applyQuaternion(this.rotation);
      remote.up.set(0, 1, 0).applyQuaternion(this.rotation);
      remote.right.set(1, 0, 0).applyQuaternion(this.rotation);
    }
    c.tick(input);
    c.constrainSurface();
    c.updateSupersonic(P.dt);
    s.dropshot?.regenBoost(c, input.boost, P.dt);
    s.heatseeker?.steer(s.ball, P.dt);
    s.cars.forEach((car, i) => s.ballContacts[i].sample(car, s.ball));
    s.world.step();
    // Use the existing normal car/ball contact response; never write match
    // touches, damage, scores or power-up state from speculative contacts.
    if (s.ball.isEnabled())
      s.cars.forEach((car, i) => {
        let touching = false;
        if (car.body.isEnabled())
          s.world.contactPair(
            car.collider,
            s.ballCollider,
            (manifold, flipped) => {
              if (touching || manifold.numSolverContacts() === 0) return;
              touching = true;
              const normal = this.contactNormal
                .copy(manifold.normal())
                .multiplyScalar(flipped ? -1 : 1);
              const point = this.contactPoint.copy(
                manifold.solverContactPoint(0),
              );
              s.ballContacts[i].resolve(car, s.ball, point, normal);
              if (car === c) {
                this.contactAge = 0;
                this.ballOffset.set(0, 0, 0);
              }
            },
          );
        if (!touching) s.ballContacts[i].separate();
      });
    c.constrainSurface(true);
    const cap = (body: typeof s.ball, speed: number, angular: number) => {
      this.position.copy(body.linvel());
      this.axis.copy(body.angvel());
      if (this.position.length() > speed)
        body.setLinvel(this.position.clampLength(0, speed), true);
      if (this.axis.length() > angular)
        body.setAngvel(this.axis.clampLength(0, angular), true);
    };
    cap(c.body, s.physics.car.maxSpeed, c.angularLimit);
    cap(s.ball, s.physics.ball.maxSpeed, s.physics.ball.maxAngular);
    s.cars.forEach((car) => car.pose.after());
    s.ballPose.after();
    this.now += P.dt;
  }
  update(
    snapshot: MatchSnapshot,
    input: PlayerInput,
    sequence: number,
    dt: number,
    age: number,
    record?: (input: PlayerInput) => number,
  ): CarSnapshot | null {
    const state = snapshot.cars.find((c) => c.id === this.car.id);
    if (!state) return null;
    const playable = snapshot.phase === "playing" || snapshot.phase === "goal";
    const discrete =
      this.reset !== snapshot.reset ||
      this.teleport !== (state.teleportSequence ?? 0) ||
      this.enabled !== state.enabled;
    if (snapshot.tick !== this.tick) {
      const before = new Vector3()
        .copy(this.car.body.translation())
        .add(this.offset);
      const beforeQ = this.rotationOffset
        .clone()
        .multiply(new Quaternion().copy(this.car.body.rotation()));
      const beforeBall = this.ballFrame.position.clone();
      this.pending = this.pending.filter(
        (entry) => entry.sequence > (state.inputSequence ?? 0),
      );
      if (discrete || !playable) {
        this.pending = [];
        this.loop.accumulator = 0;
        this.contactAge = Infinity;
      }
      this.latest = snapshot;
      this.now = snapshot.time;
      this.seedWorld(snapshot);
      this.seed(state);
      if (playable && !discrete)
        for (const entry of this.pending) this.step(entry.input);
      const error = before.distanceTo(this.car.body.translation());
      this.correctionDistance = error;
      this.correctionRotation = beforeQ.angleTo(
        this.rotation.copy(this.car.body.rotation()),
      );
      if (discrete || error > N.hardCorrection) {
        this.offset.set(0, 0, 0);
        this.rotationOffset.identity();
        if (this.tick >= 0) this.hardCorrections++;
      } else {
        this.offset.copy(before).sub(this.car.body.translation());
        this.rotationOffset
          .copy(beforeQ)
          .multiply(new Quaternion().copy(this.car.body.rotation()).invert());
      }
      const confirmed = snapshot.contacts?.at(-1)?.sequence ?? -1;
      this.ballCorrectionDistance = beforeBall.distanceTo(
        this.simulation.ball.translation(),
      );
      if (
        discrete ||
        confirmed > this.contactSequence ||
        this.ballCorrectionDistance > N.hardCorrection
      )
        this.ballOffset.set(0, 0, 0);
      else
        this.ballOffset
          .copy(beforeBall)
          .sub(this.simulation.ball.translation());
      this.contactSequence = confirmed;
      this.reset = snapshot.reset;
      this.teleport = state.teleportSequence ?? 0;
      this.enabled = state.enabled;
      this.tick = snapshot.tick;
    }
    if (playable && state.enabled && age < N.stalePredictionSeconds) {
      this.loop.advance(dt, () => {
        if (this.pending.length >= Math.ceil(N.stalePredictionSeconds / P.dt))
          return;
        const sampled = { ...input, usePowerup: false };
        const command = record ? record(input) : sequence;
        this.step(sampled);
        this.pending.push({ sequence: command, input: sampled });
        if (this.pending.length > N.predictionHistory) this.pending.shift();
      });
    } else if (snapshot.phase === "countdown") this.car.steerAtKickoff(input);
    const retain = Math.exp(
      -Math.max(0, dt) *
        (this.correctionDistance > 1
          ? N.collisionCorrectionRate
          : N.correctionRate),
    );
    this.offset.multiplyScalar(retain);
    this.rotationOffset.slerp(this.identity, 1 - retain);
    this.ballOffset.multiplyScalar(
      Math.exp(-Math.max(0, dt) * N.collisionCorrectionRate),
    );
    const alpha = this.loop.accumulator / P.dt;
    this.car.pose.render(this.rendered, alpha);
    this.rendered.position.add(this.offset);
    this.rendered.quaternion.premultiply(this.rotationOffset).normalize();
    this.simulation.ballPose.render(this.ballFrame, alpha);
    this.ballFrame.position.add(this.ballOffset);
    if (this.contactAge < 0.1) this.ballFrame.position.add(this.offset);
    this.ballFrame.rotation.copy(this.ballFrame.quaternion);
    this.ballFrame.velocity.copy(this.simulation.ball.linvel());
    this.ballFrame.angularVelocity.copy(this.simulation.ball.angvel());
    this.ballFrame.enabled = snapshot.ball.enabled;
    const distance = this.rendered.position.distanceTo(this.ballFrame.position);
    // Power-up forces and spike attachments remain on the host. Do not blend a
    // free speculative ball over an authoritative active power-up trajectory.
    const activePower = snapshot.rumble?.players.some(
      (p) => p.phase === "active" || !!p.attachment,
    );
    const target =
      !activePower &&
      playable &&
      state.enabled &&
      snapshot.ball.enabled &&
      age < N.stalePredictionSeconds &&
      distance < N.ballPredictionRange
        ? 1
        : 0;
    this.interactionBlend +=
      (target - this.interactionBlend) *
      (1 - Math.exp(-N.ballPredictionBlendRate * Math.max(0, dt)));
    if (activePower) this.interactionBlend = 0;
    if (this.contactAge < 0.1 && target) this.interactionBlend = 1;
    const c = this.car;
    return {
      ...state,
      position: this.rendered.position,
      rotation: this.rendered.quaternion,
      velocity: c.body.linvel(),
      angularVelocity: c.body.angvel(),
      boost: c.boost,
      boosting: c.boosting,
      supersonic: c.supersonic,
      grounded: c.grounded,
      speed: c.forwardSpeed,
      steer: c.steerAngle,
      skid: c.skidIntensity,
      normal: c.normal,
      wheels: [...c.wheelContact],
      wheelHits: c.wheelHits.map((p) => p.clone().add(this.offset)),
      flipLeft: c.jump.flipLeft,
      wheelAngle: undefined,
      wheelSteer: c.steerAngle,
      flipReset: state.flipReset,
      normalJump: state.normalJump,
    };
  }
  proxyPose(id: string) {
    const c = this.simulation.cars.find((c) => c.id === id);
    return c && c !== this.car
      ? { position: c.body.translation(), rotation: c.body.rotation() }
      : null;
  }
  get pendingCount() {
    return this.pending.length;
  }
  dispose() {
    this.simulation.dispose();
    this.pending = [];
  }
}
