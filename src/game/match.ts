import { P } from "../config/physics";
import type { Simulation } from "../physics/simulation";
import { modes, type Mode } from "./modes";
import { scoringTeam } from "./goals";
export type Phase =
  | "home"
  | "countdown"
  | "playing"
  | "goal"
  | "paused"
  | "finished";
export class Match {
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
    return ["countdown", "playing", "goal"].includes(this.phase);
  }
  start(s: Simulation, mode: Mode = this.mode) {
    this.mode = mode;
    // Explicit collision participation also removes already-registered broadphase pairs.
    this.score = [0, 0];
    this.remaining = 300;
    this.overtime = false;
    this.kickoff(s);
    s.cars[1].collider.setCollisionGroups(this.rules.bot ? 0xffffffff : 0);
    s.cars[1].body.setEnabled(this.rules.bot);
  }
  kickoff(s: Simulation) {
    s.reset();
    if (!this.rules.training)
      s.cars.forEach((c) => (c.boost = P.match.kickoffBoost));
    this.lastGoal = null;
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
  tick(s: Simulation) {
    if (this.phase === "countdown") {
      this.countdown = Math.max(0, this.countdown - P.dt);
      if (this.countdown < 1e-8) {
        this.countdown = 0;
        this.phase = "playing";
        this.goTime = 0.7;
      }
      return;
    }
    if (this.phase === "goal") {
      this.freeze -= P.dt;
      if (this.freeze <= 0) {
        if (
          (this.remaining <= 0 || this.overtime) &&
          this.score[0] !== this.score[1]
        )
          this.finish();
        else this.kickoff(s);
      }
      return;
    }
    if (this.phase !== "playing") return;
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
}
