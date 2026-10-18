import {
  HOOPS_CAR_GROUP,
  DROPSHOT_CAR_GROUP,
} from "../physics/collision-groups";
import { hoopsCrossing, HOOPS_CONFIG as H } from "../../shared/hoops";
import { goalExplosionId } from "../../shared/catalog";
import {
  DEFAULT_MUTATORS,
  MUTATOR_TUNING as M,
  type MatchMutators,
} from "../../shared/mutators";
import { P } from "../config/physics";
import type { Simulation } from "../physics/simulation";
import { modes, type Mode } from "./modes";
import { scoringTeam } from "./goals";
import { KickoffBag, freeplayKickoffs } from "../../shared/kickoff";
import { ReplayRecorder } from "../replay/recorder";
import {
  ReplayClock,
  playableReplay,
  type ReplayClip,
  type ReplayState,
} from "../../shared/replay";
import type { Pads } from "./pads";
import type { SoccerMode } from "../../shared/soccer";
import { MatchStats } from "./match-stats";
import {
  advanceKickoffCountdown,
  KICKOFF_GO_TIME,
} from "../../shared/kickoff-countdown";
import { newLocalPlayerId } from "../../shared/local-profile";
import { matchMvp } from "../../shared/match-stats";
import {
  meaningfulInput,
  type MatchCompletion,
} from "../../shared/progression";
import type { PlayerInput } from "../../shared/player";
export type Phase =
  | "home"
  | "countdown"
  | "playing"
  | "goal"
  | "replay"
  | "paused"
  | "finished";
export class Match {
  completion: MatchCompletion | null = null;
  private progressionId = "";
  private activeTicks = 0;
  private progressionAbsent = new Set<string>();
  setParticipantConnected(id: string, connected: boolean) {
    if (connected) this.progressionAbsent.delete(id);
    else this.progressionAbsent.add(id);
  }
  private participation = new Map<
    string,
    { ticks: number; activityTicks: number }
  >();
  recordInput(id: string, input: PlayerInput) {
    if (
      this.phase !== "playing" ||
      this.rules.training ||
      this.progressionAbsent.has(id) ||
      !meaningfulInput(input)
    )
      return;
    const activity = this.participation.get(id);
    if (activity) activity.activityTicks++;
  }
  /** Cosmetics are resolved by stable scorer ID, outside the physics simulation. */
  explosionFor: (playerId: string) => string = () => "pulse";
  mutators: MatchMutators = DEFAULT_MUTATORS;
  get timed() {
    return this.rules.clock && this.mutators.matchLength !== "UNLIMITED";
  }
  stats: MatchStats | null = null;
  gameMode: SoccerMode = "soccar";
  readonly recorder = new ReplayRecorder();
  replay: {
    clip: ReplayClip;
    clock: ReplayClock;
    eligible: Set<string>;
    votes: Set<string>;
  } | null = null;
  private goalSequence = 0;
  private previousBall = { x: 0, y: 0, z: 0 };
  private pendingEligible: Set<string> | null = null;
  get replayActive() {
    return (
      this.phase === "replay" ||
      (this.phase === "paused" && this.resumePhase === "replay")
    );
  }
  get replayState(): ReplayState | null {
    const r = this.replay;
    return r
      ? {
          id: r.clip.goal.id,
          time: r.clock.time,
          speed: r.clock.speed,
          eligible: [...r.eligible],
          votes: [...r.votes],
        }
      : null;
  }
  kickoffFormationId: string | null = null;
  private kickoffBag = new KickoffBag();
  private practiceKickoff = 0;
  mode: Mode = "bot";
  get rules() {
    return modes[this.mode];
  }
  resetSequence = 0;
  phase: Phase = "home";
  score = [0, 0];
  remaining = 300;
  freeze = 0;
  countdown = 3;
  goTime = 0;
  message = "";
  overtime = false;
  lastGoal: {
    scorerId: string;
    team: number;
    ownGoal: boolean;
    explosion?: string;
  } | null = null;
  goalFocus: { x: number; y: number; z: number } | null = null;
  private resumePhase: Phase = "playing";
  private simulation: Simulation | null = null;
  get active() {
    return ["countdown", "playing", "goal", "replay"].includes(this.phase);
  }
  start(s: Simulation, mode: Mode = this.mode, id = newLocalPlayerId()) {
    this.progressionId = id;
    this.activeTicks = 0;
    this.progressionAbsent.clear();
    this.completion = null;
    this.participation = new Map(
      s.players
        .filter((p) => p.controller !== "bot")
        .map((p) => [p.id, { ticks: 0, activityTicks: 0 }]),
    );
    this.simulation = s;
    this.mode = mode;
    if (mode === "freeplay") s.configureMutators();
    this.mutators = s.mutators;
    s.setGameMode(this.gameMode);
    this.stats = this.rules.training ? null : new MatchStats(s.players);
    this.practiceKickoff = 0;
    // Explicit collision participation also removes already-registered broadphase pairs.
    this.score = [0, 0];
    this.remaining = M.duration[this.mutators.matchLength] ?? 0;
    this.overtime = false;
    this.kickoff(s);
    if (mode !== "network")
      for (let i = 1; i < s.cars.length; i++) {
        s.cars[i].collider.setCollisionGroups(
          this.rules.bot
            ? this.gameMode === "hoops"
              ? HOOPS_CAR_GROUP
              : this.gameMode === "dropshot"
                ? DROPSHOT_CAR_GROUP
                : 0xffffffff
            : 0,
        );
        s.cars[i].body.setEnabled(this.rules.bot);
      }
  }
  kickoff(s: Simulation) {
    this.stats?.kickoff();
    const formation =
      this.gameMode === "heatseeker" ||
      this.gameMode === "hoops" ||
      this.gameMode === "dropshot"
        ? undefined
        : this.rules.training
          ? freeplayKickoffs[this.practiceKickoff++ % freeplayKickoffs.length]
          : this.kickoffBag.next(
              Math.max(
                ...[0, 1].map(
                  (team) => s.cars.filter((c) => c.team === team).length,
                ),
              ),
            );
    this.kickoffFormationId = formation?.id ?? null;
    s.reset(formation);
    this.previousBall = { ...s.ball.translation() };
    if (!this.rules.training)
      s.cars.forEach((c) => {
        c.boost = this.gameMode === "dropshot" ? 100 : P.match.kickoffBoost;
        c.applyBoostRule();
      });
    this.lastGoal = null;
    this.replay = null;
    this.recorder.reset();
    this.pendingEligible = null;
    this.goalFocus = null;
    this.countdown = this.rules.countdown;
    this.phase = this.countdown ? "countdown" : "playing";
    if (this.phase === "playing") s.launchKickoff();
    this.freeze = 0;
    this.resetSequence++;
    this.message = "";
    this.goTime = 0;
    s.rumble?.setPhase(
      this.phase === "playing",
      !this.timed || this.remaining > 0 || this.overtime,
    );
  }
  pause() {
    if (this.phase === "paused") this.phase = this.resumePhase;
    else if (this.active) {
      this.resumePhase = this.phase;
      this.phase = "paused";
    }
    this.simulation?.rumble?.setPhase(
      this.phase === "playing",
      !this.timed || this.remaining > 0 || this.overtime,
    );
  }
  tick(s: Simulation, pads?: Pads) {
    s.rumble?.setPhase(
      this.phase === "playing",
      !this.timed || this.remaining > 0 || this.overtime,
    );
    if (this.phase === "replay") {
      if (!this.replay || !this.replay.clock.valid) {
        this.endReplay(s);
        return;
      }
      this.replay.clock.advance(P.dt);
      if (this.replay!.clock.done) this.endReplay(s);
      return;
    }
    if (this.phase === "countdown") {
      this.countdown = advanceKickoffCountdown(this.countdown, P.dt);
      if (this.countdown === 0) {
        this.countdown = 0;
        this.phase = "playing";
        s.rumble?.setPhase(
          true,
          !this.timed || this.remaining > 0 || this.overtime,
        );
        this.goTime = KICKOFF_GO_TIME;
        s.launchKickoff();
      }
      return;
    }
    if (this.phase === "goal") {
      const clip = this.recorder.capturePostGoal(s, this.resetSequence, pads);
      if (!clip && !this.recorder.pendingGoal && this.replay)
        this.recorder.capture(s, this.resetSequence, pads); // Keep live wheel/pickup state moving; finalized clip is an immutable copy.
      if (clip && playableReplay(clip)) {
        this.replay = {
          clip,
          clock: new ReplayClock(clip),
          eligible: this.pendingEligible ?? new Set(),
          votes: new Set(),
        };
        this.pendingEligible = null;
      }
      this.freeze -= P.dt;
      if (this.freeze <= 0 && !this.recorder.pendingGoal) {
        if (this.replay) this.phase = "replay";
        else this.endReplay(s);
      }
      return;
    }
    if (this.phase !== "playing") return;
    if (!this.rules.training) {
      this.activeTicks++;
      for (const [id, activity] of this.participation)
        if (!this.progressionAbsent.has(id)) activity.ticks++;
    }
    this.stats?.observe(s);
    this.recorder.capture(s, this.resetSequence, pads);
    this.goTime = Math.max(0, this.goTime - P.dt);
    if (this.timed) this.remaining = Math.max(0, this.remaining - P.dt);
    s.rumble?.setPhase(
      true,
      !this.timed || this.remaining > 0 || this.overtime,
    );
    const p = s.ball.translation();
    const scoring =
      this.gameMode === "dropshot"
        ? (s.dropshot?.goal ?? null)
        : this.gameMode === "hoops"
          ? hoopsCrossing(this.previousBall, p, s.physics.ball.radius)
          : scoringTeam(p, s.physics.ball.radius);
    this.previousBall = { ...p };
    if (scoring !== null) {
      this.goalFocus = {
        x: p.x,
        y: this.gameMode === "hoops" ? H.hoopHeight : p.y,
        z:
          Math.sign(p.z) *
          (this.gameMode === "hoops" ? H.hoopZ : P.arena.halfLength),
      };
      if (this.gameMode === "dropshot")
        this.goalFocus = { x: p.x, y: p.y, z: p.z };
      if (this.rules.goal === "practice") {
        const scorer = s.cars.find((c) => c.id === s.lastTouchId) ?? s.cars[0];
        this.recorder.beginGoal({
          id: `${this.resetSequence}:${++this.goalSequence}`,
          time: s.clock,
          scorerId: scorer.id,
          explosion: goalExplosionId(this.explosionFor(scorer.id)),
          neutral: true,
          team: scoring,
          ownGoal: false,
          lastTouchId: s.lastTouchId,
          touchTime: Number.isFinite(s.lastTouchTime) ? s.lastTouchTime : null,
          ballSpeed: Math.hypot(...Object.values(s.ball.linvel())),
          focus: { ...this.goalFocus },
        });
        this.pendingEligible = new Set([s.cars[0].id]);
        this.phase = "goal";
        s.rumble?.reset();
        s.rumble?.setPhase(false, false);
        this.freeze = P.match.celebration;
        this.message = "";
        s.explode(p);
        return;
      }
      const team = scoring;
      this.score[team]++;
      const touch = s.cars.find((c) => c.id === s.lastTouchId);
      const scorer =
        touch?.team === team ? touch : s.cars.find((c) => c.team === team)!;
      this.lastGoal = {
        scorerId: scorer.id,
        explosion: goalExplosionId(this.explosionFor(scorer.id)),
        team,
        ownGoal: !!touch && touch.team !== team,
      };
      const goal = {
        id: `${this.resetSequence}:${++this.goalSequence}`,
        time: s.clock,
        scorerId: scorer.id,
        explosion: goalExplosionId(this.explosionFor(scorer.id)),
        team,
        ownGoal: this.lastGoal.ownGoal,
        lastTouchId: s.lastTouchId,
        touchTime:
          touch?.id === scorer.id && Number.isFinite(s.lastTouchTime)
            ? s.lastTouchTime
            : null,
        ballSpeed: Math.hypot(
          s.ball.linvel().x,
          s.ball.linvel().y,
          s.ball.linvel().z,
        ),
        focus: { ...this.goalFocus },
      };
      this.recorder.beginGoal(goal);
      this.stats?.goal(goal, s.clock);
      this.pendingEligible = new Set(
        s.cars
          .filter((_, i) => s.players[i].controller !== "bot")
          .map((c) => c.id),
      );
      this.message = `${scorer.displayName.toUpperCase()} SCORED`;
      this.phase = "goal";
      s.rumble?.reset();
      s.rumble?.setPhase(false, false);
      this.freeze = P.match.celebration;
      s.explode(p);
      return;
    }
    if (this.timed && this.remaining === 0 && s.ballGround.grounded) {
      if (this.score[0] === this.score[1]) {
        if (!this.overtime) {
          this.overtime = true;
          this.kickoff(s);
        }
      } else this.finish();
    }
  }
  finish() {
    if (
      !this.completion &&
      this.simulation &&
      !this.rules.training &&
      this.progressionId
    ) {
      const players = this.simulation.players;
      this.completion = {
        id: this.progressionId,
        mode: this.mode === "network" ? "network" : "bot",
        activeSeconds: this.activeTicks * P.dt,
        score: [this.score[0], this.score[1]],
        mvpId: matchMvp(players, this.stats?.snapshot() ?? [])?.id ?? null,
        players: players.map((p) => ({
          id: p.id,
          team: p.team,
          controller: p.controller,
          completed: !this.progressionAbsent.has(p.id),
          score: this.stats?.players.get(p.id)?.score ?? 0,
          activeSeconds: (this.participation.get(p.id)?.ticks ?? 0) * P.dt,
          activitySeconds:
            (this.participation.get(p.id)?.activityTicks ?? 0) * P.dt,
        })),
      };
    }
    this.simulation?.rumble?.reset();
    this.simulation?.rumble?.setPhase(false, false);
    this.phase = "finished";
    this.message =
      this.score[0] > this.score[1]
        ? "VICTORY"
        : this.score[0] < this.score[1]
          ? "AMBER WINS"
          : "DRAW";
  }
  skipReplay(id: string, replayId: string, s: Simulation) {
    const r = this.replay;
    if (
      this.phase !== "replay" ||
      !r ||
      r.clip.goal.id !== replayId ||
      !r.eligible.has(id) ||
      r.votes.has(id)
    )
      return false;
    r.votes.add(id);
    if ([...r.eligible].every((p) => r.votes.has(p))) this.endReplay(s);
    return true;
  }
  replayDisconnected(id: string, s: Simulation) {
    this.pendingEligible?.delete(id);
    this.replay?.eligible.delete(id);
    if (
      this.phase === "replay" &&
      this.replay &&
      [...this.replay.eligible].every((p) => this.replay!.votes.has(p))
    )
      this.endReplay(s);
  }
  private endReplay(s: Simulation) {
    if (
      this.timed &&
      (this.remaining <= 0 || this.overtime) &&
      this.score[0] !== this.score[1]
    ) {
      this.replay = null;
      this.finish();
    } else {
      if (this.timed && this.remaining <= 0) this.overtime = true;
      this.kickoff(s);
    }
  }
}
