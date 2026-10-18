import { Quaternion, Vector3 } from "three";
import { Simulation } from "../physics/simulation";
import { refreshStaticQueries } from "../physics/queries";
import { FixedLoop } from "../physics/loop";
import { P } from "../config/physics";
import { NETWORK as N } from "../../shared/network-tuning";
import type {
  MatchSnapshot,
  CarSnapshot,
  NetPlayer,
} from "../../shared/network";
import type { PlayerInput } from "../../shared/player";
/** Only this player's car and static arena surfaces are simulated here. There is
 * no client ball, bot AI, score, tile damage, demolition or powerup authority. */
export class LocalCarPrediction {
  readonly simulation: Simulation;
  readonly car;
  private loop = new FixedLoop();
  private pending: { sequence: number; input: PlayerInput }[] = [];
  private offset = new Vector3();
  private rotationOffset = new Quaternion();
  private reset = -1;
  private teleport = -1;
  private enabled = true;
  private tick = -1;
  correctionDistance = 0;
  hardCorrections = 0;
  private rendered = { position: new Vector3(), quaternion: new Quaternion() };
  constructor(player: NetPlayer, initial: MatchSnapshot) {
    this.simulation = new Simulation(false, [
      { ...player, controller: "local" },
    ]);
    this.simulation.configureMutators(initial.mutators);
    this.simulation.setGameMode(initial.gameMode ?? "soccar");
    this.simulation.ball.setEnabled(false);
    this.car = this.simulation.cars[0];
    this.car.setBody(player.preset.body);
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
  private step(input: PlayerInput) {
    const c = this.car,
      s = this.simulation;
    if (!c.body.isEnabled()) return;
    c.pose.before();
    c.tick(input);
    c.constrainSurface();
    c.updateSupersonic(P.dt);
    s.dropshot?.regenBoost(c, input.boost, P.dt);
    s.world.step();
    c.constrainSurface(true);
    const v = new Vector3().copy(c.body.linvel()),
      w = new Vector3().copy(c.body.angvel());
    if (v.length() > s.physics.car.maxSpeed)
      c.body.setLinvel(v.clampLength(0, s.physics.car.maxSpeed), true);
    if (w.length() > c.angularLimit)
      c.body.setAngvel(w.clampLength(0, c.angularLimit), true);
    c.pose.after();
  }
  update(
    snapshot: MatchSnapshot,
    input: PlayerInput,
    sequence: number,
    dt: number,
    age: number,
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
          .add(this.offset),
        beforeQ = this.rotationOffset
          .clone()
          .multiply(new Quaternion().copy(this.car.body.rotation()));
      this.pending = this.pending.filter(
        (entry) => entry.sequence > (state.inputSequence ?? 0),
      );
      if (discrete || !playable) {
        this.pending = [];
        this.loop.accumulator = 0;
      }
      this.seed(state);
      if (playable && !discrete)
        for (const entry of this.pending) this.step(entry.input);
      const error = before.distanceTo(this.car.body.translation());
      this.correctionDistance = error;
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
      this.reset = snapshot.reset;
      this.teleport = state.teleportSequence ?? 0;
      this.enabled = state.enabled;
      this.tick = snapshot.tick;
    }
    if (playable && state.enabled && age < N.stalePredictionSeconds) {
      this.loop.advance(dt, () => {
        // A live receive stream can still have stalled input acknowledgements.
        // Bound prediction lead as well as packet age; never replay a second
        // of unacknowledged driving on top of fresh authority forever.
        if (this.pending.length >= Math.ceil(N.stalePredictionSeconds / P.dt))
          return;
        this.step(input);
        this.pending.push({ sequence, input: { ...input, usePowerup: false } });
        if (this.pending.length > N.predictionHistory) this.pending.shift();
      });
    } else if (snapshot.phase === "countdown") {
      this.car.steerAtKickoff(input);
    }
    const retain = Math.exp(
      -Math.max(0, dt) * (this.correctionDistance > 1 ? 24 : 12),
    );
    this.offset.multiplyScalar(retain);
    this.rotationOffset.slerp(new Quaternion(), 1 - retain);
    this.car.pose.render(this.rendered, this.loop.accumulator / P.dt);
    this.rendered.position.add(this.offset);
    this.rendered.quaternion.premultiply(this.rotationOffset).normalize();
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
  get pendingCount() {
    return this.pending.length;
  }
  dispose() {
    this.simulation.dispose();
    this.pending = [];
  }
}
