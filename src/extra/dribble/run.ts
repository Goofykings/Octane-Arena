import type { LocalProfile } from "../../game/local-profile";
import type { PlayerInput } from "../../../shared/player";
import { DribblePhysics } from "./physics";
import { buildDribbleCourse, dribbleLevels } from "./levels";
export class DribbleRun {
  phase: "ready" | "running" | "complete" = "ready";
  paused = false;
  resetSequence = 0;
  reason = "";
  completionWait = 0;
  constructor(
    readonly physics: DribblePhysics,
    readonly profile: LocalProfile,
  ) {}
  get level() {
    return this.physics.course.definition.id;
  }
  get best() {
    return this.profile.challengeProgress("dribble", dribbleLevels.length);
  }
  get unlocked() {
    return Math.min(dribbleLevels.length, this.best + 1);
  }
  get complete() {
    return this.phase === "complete" && this.level === dribbleLevels.length;
  }
  select(level: number) {
    if (!Number.isInteger(level) || level < 1 || level > this.unlocked)
      return false;
    this.physics.load(buildDribbleCourse(dribbleLevels[level - 1]));
    this.phase = "ready";
    this.paused = false;
    this.reason = "";
    this.completionWait = 0;
    this.resetSequence++;
    return true;
  }
  reset(reason = "") {
    this.physics.reset();
    this.phase = "ready";
    this.reason = reason;
    this.paused = false;
    this.completionWait = 0;
    this.resetSequence++;
  }
  step(input: PlayerInput) {
    if (this.paused || this.phase === "complete") return;
    if (Math.abs(input.throttle) > 0.05 || input.jump || input.boost) {
      this.phase = "running";
      this.reason = "";
    }
    this.physics.step(input);
    if (this.physics.finished()) {
      if (
        !this.profile.completeChallengeLevel(
          "dribble",
          this.level,
          dribbleLevels.length,
        )
      )
        return;
      this.phase = "complete";
      this.completionWait = 0.9;
      this.reason = "";
      return;
    }
    const failure = this.physics.failed();
    if (failure) this.reset(failure);
  }
  advance(dt: number) {
    if (this.paused || this.phase !== "complete" || this.complete) return false;
    this.completionWait -= dt;
    return this.completionWait <= 0 && this.select(this.level + 1);
  }
}
