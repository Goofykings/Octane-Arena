import { P } from "../config/physics";
import type { Simulation } from "../physics/simulation";
import { modes, type Mode } from "./modes";
import { scoringTeam } from "./goals";
import { KickoffBag, freeplayKickoffs } from "../../shared/kickoff";
import { ReplayRecorder } from "../replay/recorder";
import {
  ReplayClock,
  type ReplayClip,
  type ReplayState,
} from "../../shared/replay";
import type { Pads } from "./pads";
import type { SoccerMode } from "../../shared/soccer";
import { MatchStats } from "./match-stats";
import { advanceKickoffCountdown, KICKOFF_GO_TIME } from "../../shared/kickoff-countdown";
export type Phase =
  | "home"
  | "countdown"
  | "playing"
  | "goal"
  | "replay"
  | "paused"
  | "finished";
export class Match {
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
  lastGoal: { scorerId: string; team: number; ownGoal: boolean } | null = null;
  goalFocus: { x: number; y: number; z: number } | null = null;
  private resumePhase: Phase = "playing";
  get active() {
    return ["countdown", "playing", "goal", "replay"].includes(this.phase);
  }
  start(s: Simulation, mode: Mode = this.mode) {
    this.mode = mode;
    s.setGameMode(this.gameMode);
    this.stats = this.rules.training ? null : new MatchStats(s.players);
    this.practiceKickoff = 0;
    // Explicit collision participation also removes already-registered broadphase pairs.
    this.score = [0, 0];
    this.remaining = 300;
    this.overtime = false;
    this.kickoff(s);
    if (mode !== "network" && s.cars[1]) {
      s.cars[1].collider.setCollisionGroups(this.rules.bot ? 0xffffffff : 0);
      s.cars[1].body.setEnabled(this.rules.bot);
    }
  }
  kickoff(s: Simulation) {
    this.stats?.kickoff();
    const formation =
      this.gameMode === "heatseeker"
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
    if (!this.rules.training)
      s.cars.forEach((c) => (c.boost = P.match.kickoffBoost));
    this.lastGoal = null;
    this.replay = null;
    this.recorder.reset();
    this.goalFocus = null;
    this.countdown = this.rules.countdown;
    this.phase = this.countdown ? "countdown" : "playing";
    this.freeze = 0;
    this.resetSequence++;
    this.message = "";
    this.goTime = 0;
  }
  pause() {
    if (this.phase === "paused") this.phase = this.resumePhase;
    else if (this.active) {
      this.resumePhase = this.phase;
      this.phase = "paused";
    }
  }
  tick(s: Simulation, pads?: Pads) {
    if (this.phase === "replay") {
      this.replay!.clock.advance(P.dt);
      if (this.replay!.clock.done) this.endReplay(s);
      return;
    }
    if (this.phase === "countdown") {
      this.countdown = advanceKickoffCountdown(this.countdown, P.dt);
      if (this.countdown === 0) {
        this.countdown = 0;
        this.phase = "playing";
        this.goTime = KICKOFF_GO_TIME;
      }
      return;
    }
    if (this.phase === "goal") {
      this.freeze -= P.dt;
      if (this.freeze <= 0) {
        if (this.replay) this.phase = "replay";
        else this.endReplay(s);
      }
      return;
    }
    if (this.phase !== "playing") return;
    this.stats?.observe(s);
    if (!this.rules.training)
      this.recorder.capture(s, this.resetSequence, pads);
    this.goTime = Math.max(0, this.goTime - P.dt);
    if (this.rules.clock) this.remaining = Math.max(0, this.remaining - P.dt);
    const p = s.ball.translation(),
      a = P.arena,
      r = P.ball.radius;
    const scoring = scoringTeam(p);
    if (scoring !== null) {
      this.goalFocus = {
        x: p.x,
        y: p.y,
        z: Math.sign(p.z) * P.arena.halfLength,
      };
      if (this.rules.goal === "practice") {
        this.phase = "goal";
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
        team,
        ownGoal: !!touch && touch.team !== team,
      };
      const goal = {
        id: `${this.resetSequence}:${++this.goalSequence}`,
        time: s.clock,
        scorerId: scorer.id,
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
      const clip = this.recorder.clip(goal);
      this.stats?.goal(goal, s.clock);
      this.replay = {
        clip,
        clock: new ReplayClock(clip),
        eligible: new Set(
          s.cars
            .filter((_, i) => s.players[i].controller !== "bot")
            .map((c) => c.id),
        ),
        votes: new Set(),
      };
      this.message = `${scorer.displayName.toUpperCase()} SCORED`;
      this.phase = "goal";
      this.freeze = P.match.celebration;
      s.explode(p);
      return;
    }
    if (this.rules.clock && this.remaining === 0 && p.y < r + 0.08) {
      if (this.score[0] === this.score[1]) {
        if (!this.overtime) {
          this.overtime = true;
          this.kickoff(s);
        }
      } else this.finish();
    }
  }
  finish() {
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
      (this.remaining <= 0 || this.overtime) &&
      this.score[0] !== this.score[1]
    ) {
      this.replay = null;
      this.finish();
    } else this.kickoff(s);
  }
}
