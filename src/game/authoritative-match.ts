import { DEFAULT_MUTATORS, type MatchMutators } from "../../shared/mutators";
import { z } from "zod";
import { Simulation, initializeSimulation } from "../physics/simulation";
import { Match } from "../game/match";
import { Pads } from "../game/pads";
import { Opponent } from "../ai/opponent";
import { BotTeam } from "../ai/team";
import { P } from "../config/physics";
import { neutralInput, type PlayerInput } from "../../shared/player";
import type {
  MatchSnapshot,
  NetPlayer,
  MatchParticipant,
} from "../../shared/network";
import type { ArenaId } from "../../shared/arenas";
import { displayIdentity } from "../../shared/local-profile";
import type { SoccerMode } from "../../shared/soccer";
import { MatchChat, type ChatMessage } from "../../shared/chat";

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
    directionalRoll: axis.optional(),
    jump: z.boolean(),
    usePowerup: z.boolean().optional(),
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
  readonly chat = new MatchChat();
  acceptChat(
    id: string,
    text: unknown,
    now = performance.now(),
  ): { message?: ChatMessage; error?: string } {
    if (
      this.disconnected.has(id) ||
      !this.sessionMembers.some((p) => p.id === id) ||
      this.players.some((p) => p.id === id && p.controller === "bot")
    )
      return { error: "Player is not in this match." };
    return this.chat.accept(id, text, now);
  }
  ping(id: string, value: number | null) {
    this.match.stats?.setPing(id, value);
  }
  tick = 0;
  private bots = new Map<string, Opponent>();
  private botTeam = new BotTeam("intermediate");
  private disconnected = new Set<string>();
  private inputs = new Map<
    string,
    {
      value: PlayerInput;
      sequence: number;
      received: number;
      jump: boolean;
      powerup: boolean;
    }
  >();
  constructor(
    public readonly players: NetPlayer[],
    readonly arenaId: ArenaId = "city",
    readonly id: string = crypto.randomUUID(),
    readonly gameMode: SoccerMode = "soccar",
    public readonly sessionMembers: MatchParticipant[] = players,
    mutators: MatchMutators = DEFAULT_MUTATORS,
  ) {
    this.arenaId =
      gameMode === "dropshot"
        ? "dropshot"
        : gameMode === "hoops"
          ? "hoops"
          : ["hoops", "dropshot"].includes(arenaId)
            ? "city"
            : arenaId;
    // Copy session metadata independently; watcher cleanup cannot mutate the car roster.
    this.sessionMembers = sessionMembers.map(
      ({ id, name, team, localPlayerId, avatarId, avatarColor }) => ({
        id,
        name,
        team,
        localPlayerId,
        avatarId,
        avatarColor,
      }),
    );
    this.simulation = new Simulation(false, players);
    this.simulation.configureMutators(mutators);
    this.simulation.cars.forEach((car, i) => {
      car.setBody(players[i].preset.body);
      car.displayName = displayIdentity(players[i]);
    });
    for (const p of players)
      if (p.controller === "bot") this.bots.set(p.id, new Opponent());
    this.match.explosionFor = (id) =>
      players.find((p) => p.id === id)?.preset.explosion ?? "pulse";
    this.match.gameMode = gameMode;
    this.match.start(this.simulation, "network");
    this.pads.configure(gameMode);
    this.botTeam.prepare(this.simulation, this.pads);
    this.match.recorder.prepare(this.simulation);
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
      powerup:
        !!previous?.powerup ||
        (!!parsed.data.usePowerup && !previous?.value.usePowerup),
    });
    return true;
  }
  sessionActive(id: string) {
    return (
      this.sessionMembers.some((m) => m.id === id) && !this.disconnected.has(id)
    );
  }
  removeSessionMember(id: string) {
    // Preserve authenticated display metadata for earlier chat messages.
    // Delivery and new messages stop immediately, independently of this history.
    this.disconnect(id);
  }
  disconnect(id: string) {
    const reset = this.match.resetSequence;
    this.inputs.delete(id);
    this.disconnected.add(id);
    this.simulation.rumble?.suspend(id);
    this.ping(id, null);
    this.match.replayDisconnected(id, this.simulation);
    if (this.match.resetSequence !== reset) this.pads.reset();
  }
  addSpectator(member: MatchParticipant) {
    if (
      this.gameMode !== "dropshot" ||
      member.team !== "spectator" ||
      this.sessionMembers.some((m) => m.id === member.id) ||
      this.sessionMembers.length >= 8
    )
      return false;
    this.sessionMembers.push({ ...member });
    this.simulation.dropshot?.forceFull();
    return true;
  }
  connected(id: string) {
    this.simulation.dropshot?.forceFull();
    this.inputs.delete(id);
    this.disconnected.delete(id);
    this.simulation.rumble?.suspend(id, false);
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
    const botInputs = this.bots.size
      ? this.botTeam.inputs(s, this.pads)
      : new Map<string, PlayerInput>();
    for (const p of this.players) {
      const car = s.cars.find((c) => c.id === p.id)!,
        bot = this.bots.get(p.id),
        incoming = this.inputs.get(p.id);
      const input = bot
        ? (botInputs.get(p.id) ?? neutralInput())
        : incoming && now - incoming.received < 300
          ? {
              ...incoming.value,
              jump: incoming.value.jump || incoming.jump,
              usePowerup: incoming.powerup,
            }
          : neutralInput();
      if (incoming) {
        incoming.jump = false;
        incoming.powerup = false;
      }
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
      mutators: s.mutators,
      heatseeker: s.heatseeker ? { ...s.heatseeker.state } : null,
      rumble: s.rumble?.snapshot() ?? null,
      dropshot: s.dropshot?.snapshot(s.clock) ?? null,
      stats: m.stats?.snapshot(),
      statEvents: m.stats?.events.map((e) => ({ ...e })),
      chat: this.chat.messages.slice(-8),
      lastGoal: m.lastGoal,
      replay: m.replayState,
      tick: this.tick,
      time: this.tick * P.dt,
      reset: m.resetSequence,
      kickoffFormationId: m.kickoffFormationId,
      players: this.players,
      sessionMembers: this.sessionMembers,
      cars: s.cars.map((c, i) => ({
        id: c.id,
        position: { ...c.body.translation() },
        rotation: { ...c.body.rotation() },
        velocity: { ...c.body.linvel() },
        angularVelocity: { ...c.body.angvel() },
        teleportSequence: c.teleportSequence,
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
        flipReset: {
          sequence: c.flipResetSequence,
          age: Number.isFinite(c.flipResetAge) ? c.flipResetAge : 1000,
          origin: { ...c.flipResetOrigin },
          normal: { ...c.flipResetNormal },
        },
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
