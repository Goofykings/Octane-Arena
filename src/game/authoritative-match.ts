import { z } from "zod";
import { Simulation, initializeSimulation } from "../physics/simulation";
import { Match } from "../game/match";
import { Pads } from "../game/pads";
import { Opponent } from "../ai/opponent";
import { P } from "../config/physics";
import { neutralInput, type PlayerInput } from "../../shared/player";
import type { MatchSnapshot, NetPlayer } from "../../shared/network";
import type { ArenaId } from "../../shared/arenas";
import { displayIdentity } from "../../shared/local-profile";
import type { SoccerMode } from "../../shared/soccer";

let initialized: Promise<void> | undefined;
export const initializeMatchPhysics = () =>
  (initialized ??= initializeSimulation());
const axis = z.number().finite().min(-1).max(1);
export const networkInputSchema = z
  .object({
    throttle: axis,
    steer: axis,
    pitch: axis,
    yaw: axis,
    roll: axis,
    jump: z.boolean(),
    boost: z.boolean(),
    slide: z.boolean(),
    dodgeX: axis.optional(),
    dodgeY: axis.optional(),
  })
  .strict();

export class NetworkMatch {
  readonly simulation: Simulation;
  readonly match = new Match();
  readonly pads = new Pads();
  tick = 0;
  private bots = new Map<string, Opponent>();
  private disconnected = new Set<string>();
  private inputs = new Map<
    string,
    { value: PlayerInput; sequence: number; received: number; jump: boolean }
  >();
  constructor(
    public readonly players: NetPlayer[],
    readonly arenaId: ArenaId = "city",
    readonly id: string = crypto.randomUUID(),
    readonly gameMode: SoccerMode = "soccar",
  ) {
    this.simulation = new Simulation(false, players);
    this.simulation.cars.forEach((car, i) => {
      car.setBody(players[i].preset.body);
      car.displayName = displayIdentity(players[i]);
    });
    for (const p of players)
      if (p.controller === "bot") this.bots.set(p.id, new Opponent());
    this.match.gameMode = gameMode;
    this.match.start(this.simulation, "network");
  }
  accept(
    id: string,
    sequence: number,
    input: unknown,
    now = performance.now(),
  ) {
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 0 ||
      !this.players.some((p) => p.id === id && p.controller !== "bot")
    )
      return false;
    const previous = this.inputs.get(id),
      parsed = networkInputSchema.safeParse(input);
    if (!parsed.success || (previous && sequence <= previous.sequence))
      return false;
    this.inputs.set(id, {
      value: parsed.data,
      sequence,
      received: now,
      jump: !!previous?.jump || (parsed.data.jump && !previous?.value.jump),
    });
    return true;
  }
  disconnect(id: string) {
    const reset = this.match.resetSequence;
    this.inputs.delete(id);
    this.disconnected.add(id);
    this.match.replayDisconnected(id, this.simulation);
    if (this.match.resetSequence !== reset) this.pads.reset();
  }
  connected(id: string) {
    this.inputs.delete(id);
    this.disconnected.delete(id);
    if (
      this.match.replay &&
      this.players.some((p) => p.id === id && p.controller !== "bot")
    )
      this.match.replay.eligible.add(id);
  }
  skipReplay(id: string, replayId: string) {
    const reset = this.match.resetSequence;
    const accepted =
      !this.disconnected.has(id) &&
      this.match.skipReplay(id, replayId, this.simulation);
    if (this.match.resetSequence !== reset) this.pads.reset();
    return accepted;
  }
  step(now = performance.now()) {
    const s = this.simulation,
      m = this.match,
      reset = m.resetSequence;
    if (m.phase === "replay") {
      m.tick(s, this.pads);
      if (m.resetSequence !== reset) this.pads.reset();
      this.tick++;
      return;
    }
    const inputs = new Map<string, PlayerInput>();
    for (const p of this.players) {
      const car = s.cars.find((c) => c.id === p.id)!,
        bot = this.bots.get(p.id),
        incoming = this.inputs.get(p.id);
      const input = bot
        ? bot.sample(car, s.ball.translation(), s.clock)
        : incoming && now - incoming.received < 300
          ? { ...incoming.value, jump: incoming.value.jump || incoming.jump }
          : neutralInput();
      if (incoming) incoming.jump = false;
      inputs.set(p.id, input);
      if (m.phase === "countdown") car.steerAtKickoff(input);
    }
    if (m.phase === "playing" || m.phase === "goal") s.step(inputs);
    if (m.phase === "playing" || m.phase === "goal") this.pads.tick(s.cars);
    m.tick(s, this.pads);
    if (m.replay)
      for (const id of this.disconnected) m.replayDisconnected(id, s);
    if (m.resetSequence !== reset) this.pads.reset();
    this.tick++;
  }
  snapshot(): MatchSnapshot {
    const s = this.simulation,
      m = this.match;
    return {
      type: "snapshot",
      matchId: this.id,
      arenaId: this.arenaId,
      gameMode: this.gameMode,
      heatseeker: s.heatseeker ? { ...s.heatseeker.state } : null,
      lastGoal: m.lastGoal,
      replay: m.replayState,
      tick: this.tick,
      time: this.tick * P.dt,
      reset: m.resetSequence,
      kickoffFormationId: m.kickoffFormationId,
      players: this.players,
      cars: s.cars.map((c, i) => ({
        id: c.id,
        position: { ...c.body.translation() },
        rotation: { ...c.body.rotation() },
        velocity: { ...c.body.linvel() },
        angularVelocity: { ...c.body.angvel() },
        wheelAngle: m.recorder.wheels(i).angle,
        wheelSteer: m.recorder.wheels(i).steer,
        boost: c.boost,
        boosting: c.boosting,
        grounded: c.grounded,
        supersonic: c.supersonic,
        speed: c.forwardSpeed,
        steer: c.steerAngle,
        skid: c.skidIntensity,
        normal: { x: c.normal.x, y: c.normal.y, z: c.normal.z },
        wheels: [...c.wheelContact],
        wheelHits: c.wheelHits.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        flipLeft: c.jump.flipLeft,
        normalJump: {
          sequence: c.normalJumpSequence,
          age: Number.isFinite(c.normalJumpAge) ? c.normalJumpAge : 1000,
          origin: { ...c.normalJumpOrigin },
          normal: { ...c.normalJumpNormal },
        },
        enabled: c.body.isEnabled(),
      })),
      ball: {
        position: { ...s.ball.translation() },
        rotation: { ...s.ball.rotation() },
        enabled: s.ball.isEnabled(),
        velocity: { ...s.ball.linvel() },
        angularVelocity: { ...s.ball.angvel() },
      },
      pads: this.pads.items.map((p) => p.cooldown),
      touchTeam: s.cars.find((c) => c.id === s.lastTouchId)?.team ?? null,
      phase: m.phase as MatchSnapshot["phase"],
      score: [...m.score],
      remaining: m.remaining,
      countdown: m.countdown,
      goTime: m.goTime,
      overtime: m.overtime,
      message:
        m.phase === "finished"
          ? m.score[0] > m.score[1]
            ? "BLUE WINS"
            : m.score[1] > m.score[0]
              ? "ORANGE WINS"
              : "DRAW"
          : m.message,
      goalFocus: m.goalFocus,
    };
  }
  dispose() {
    this.simulation.dispose();
  }
}
