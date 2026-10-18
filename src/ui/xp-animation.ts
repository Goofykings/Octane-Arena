import {
  progressionAt,
  xpRequired,
  XP_TUNING,
  type XPAward,
} from "../../shared/progression";
/** Presentation only. Awards are persisted before this animation ever starts. */
export class XPAnimation {
  level: number;
  xp: number;
  remaining: number;
  done = false;
  levelUp = false;
  private hold = 0;
  private rate: number;
  private boundaryPause: number;
  constructor(
    readonly award: XPAward,
    reducedMotion = false,
  ) {
    this.level = award.before.level;
    this.xp = award.before.currentLevelXP;
    this.remaining = award.amount;
    this.rate = Math.max(1, award.amount / XP_TUNING.animationSeconds);
    this.boundaryPause =
      0.4 / Math.max(1, award.after.level - award.before.level);
    if (reducedMotion || !this.remaining) this.skip();
  }
  advance(dt: number) {
    this.levelUp = false;
    if (this.done) return;
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold > 0) return;
      this.level++;
      this.xp = 0;
      this.levelUp = true;
      if (!this.remaining) this.done = true;
      return;
    }
    const needed = xpRequired(this.level) - this.xp;
    const delta = Math.min(this.remaining, needed, this.rate * Math.max(0, dt));
    this.xp += delta;
    this.remaining -= delta;
    if (this.xp >= xpRequired(this.level) - 1e-7) {
      this.xp = xpRequired(this.level);
      this.hold = this.boundaryPause;
    } else if (this.remaining < 1e-7) this.skip();
  }
  skip() {
    const after = progressionAt(this.award.after.totalXP);
    this.level = after.level;
    this.xp = after.currentLevelXP;
    this.remaining = 0;
    this.done = true;
  }
}
