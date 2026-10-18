import { LocalProfile, localProfileKey } from "./local-profile";
import {
  CHALLENGES,
  resetChallengePeriods,
  applyChallengeUpdate,
  acknowledgeChallengeReward,
  challengePeriod,
  challengeRewardId,
  type ChallengeCategory,
  CHALLENGE_CATEGORIES,
  type ChallengeMatchUpdate,
  type ChallengeReward,
  type ChallengeDefinition,
} from "../../shared/challenges";
import type { XPAward } from "../../shared/progression";

/** Event adapter: only changed authoritative counters enter the persistent engine.
 * Cumulative per-match high-water marks also recover gaps in the short network event history. */
export class Challenges {
  private listeners = new Set<() => void>();
  private completionListeners = new Set<(reward: ChallengeReward) => void>();
  private chain: Promise<void> = Promise.resolve();
  error = "";
  private signature = "";
  private periods = "";
  constructor(
    readonly profile: LocalProfile,
    private clock: () => number = Date.now,
    readonly definitions: readonly ChallengeDefinition[] = CHALLENGES,
  ) {
    this.tick();
    if (typeof window !== "undefined")
      window.addEventListener("storage", (event) => {
        if (event.key === localProfileKey)
          this.enqueue(async () => {
            await this.profile.updateChallenges(() => false);
            this.changed();
          });
      });
  }
  get state() {
    return this.profile.value.challengeProgress;
  }
  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onComplete(listener: (reward: ChallengeReward) => void) {
    this.completionListeners.add(listener);
    return () => {
      this.completionListeners.delete(listener);
    };
  }
  private changed() {
    for (const listener of this.listeners) listener();
  }
  private enqueue(work: () => Promise<void>) {
    this.chain = this.chain.then(work).catch(() => {
      this.error =
        "Challenges are temporarily unavailable. Match XP is unaffected.";
      this.changed();
    });
    return this.chain;
  }
  /** Called once a second, but touches storage only at a real period boundary. */
  tick() {
    const now = this.clock(),
      periods = CHALLENGE_CATEGORIES.map((c) => challengePeriod(c, now)).join(
        "/",
      );
    if (periods === this.periods) return;
    this.periods = periods;
    this.enqueue(async () => {
      await this.profile.updateChallenges((state) =>
        resetChallengePeriods(state, now),
      );
      await this.rewards();
      this.changed();
    });
  }
  observe(update: ChallengeMatchUpdate) {
    if (
      (update.mode !== "bot" && update.mode !== "network") ||
      (update.controller !== "local" && update.controller !== "remote") ||
      !["playing", "goal", "finished"].includes(update.phase) ||
      !update.stats ||
      update.stats.playerId !== update.playerId
    )
      return;
    const s = update.stats;
    const signature = [
      update.matchId,
      update.playerId,
      update.gameMode,
      s.score,
      s.goals,
      s.assists,
      s.saves,
      s.shots,
      s.touches,
      update.phase === "finished" && !!update.completion,
    ].join("/");
    if (signature === this.signature) return;
    this.signature = signature;
    const input = structuredClone(update),
      now = this.clock();
    this.enqueue(async () => {
      const completed: ChallengeReward[] = [];
      const changed = await this.profile.updateChallenges((state) => {
        const previous = new Set(Object.keys(state.pending));
        const changed = applyChallengeUpdate(
          state,
          input,
          now,
          this.definitions,
        );
        for (const [id, reward] of Object.entries(state.pending))
          if (!previous.has(id)) completed.push(structuredClone(reward));
        return changed;
      });
      await this.rewards();
      if (changed) this.changed();
      for (const reward of completed)
        for (const listener of this.completionListeners) listener(reward);
    });
  }
  /** Completion only unlocks a reward. Persist an explicit request before XP,
   * so a reload can finish an interrupted claim without claiming other cards. */
  claim(
    category: ChallengeCategory,
    challengeId: string,
  ): Promise<XPAward | null> {
    let award: XPAward | null = null;
    return this.enqueue(async () => {
      let requestedId = "";
      await this.profile.updateChallenges((state) => {
        const reset = resetChallengePeriods(state, this.clock());
        const set = state.periods[category];
        const entry = set.entries[challengeId];
        const id = challengeRewardId(category, set.key, challengeId);
        const reward = state.pending[id];
        if (
          !entry?.completed ||
          entry.rewardClaimed ||
          !reward ||
          reward.claimRequested
        )
          return reset;
        reward.claimRequested = true;
        requestedId = id;
        return true;
      });
      if (requestedId) award = await this.grant(requestedId);
      this.changed();
    }).then(() => award);
  }
  private async grant(id: string): Promise<XPAward | null> {
    const reward = this.state.pending[id];
    if (!reward?.claimRequested) return null;
    const receipt = await this.profile.awardXP(reward.amount, {
      type: "CHALLENGE",
      id,
    });
    if (receipt)
      await this.profile.updateChallenges((state) =>
        acknowledgeChallengeReward(state, id),
      );
    return receipt;
  }
  private async rewards() {
    for (const [id, reward] of Object.entries(this.state.pending))
      if (reward.claimRequested) await this.grant(id);
  }
  /** Wait for progress persistence and any explicitly requested reward grants. */
  settled() {
    return this.chain;
  }
}
