import {
  localIdentitySchema,
  profileIdentitySchema,
  newLocalPlayerId,
  avatarIdSchema,
  avatarColorSchema,
  defaultAvatarColor,
} from "../../shared/local-profile";
import type { PlayerMatchStats } from "../../shared/match-stats";
import {
  progressionAt,
  matchXP,
  xpAwardSchema,
  type MatchCompletion,
  type Progression,
  type XPAward,
  type XPSource,
  type XPBreakdown,
} from "../../shared/progression";
import {
  blankChallengeSave,
  readChallengeSave,
  mergeChallengeSaves,
  acknowledgeChallengeReward,
  type ChallengeSave,
} from "../../shared/challenges";
export const localProfileKey = "octane-arena-profile";
const blankStats = () => ({
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  shots: 0,
  playTime: 0,
});
export interface LocalProfileData {
  profileVersion: 1;
  progression: Progression;
  xpBaseTotal: number;
  xpAwards: Record<string, XPAward>;
  localPlayerId: string;
  name: string;
  avatarId: string;
  avatarColor: string;
  stats: ReturnType<typeof blankStats>;
  recentEvents: string[];
  challenges: Record<string, number>;
  challengeProgress: ChallengeSave;
}
export class LocalProfile {
  value: LocalProfileData = {
    profileVersion: 1,
    progression: progressionAt(0),
    xpBaseTotal: 0,
    xpAwards: {},
    localPlayerId: newLocalPlayerId(),
    name: "Guest",
    avatarId: "helmet",
    avatarColor: defaultAvatarColor,
    stats: blankStats(),
    recentEvents: [],
    challenges: {},
    challengeProgress: blankChallengeSave(),
  };
  persistent = true;
  private pendingTime = 0;
  private cachedProfile = "";
  private xpListeners = new Set<(award: XPAward) => void>();
  /** Future passes/challenges can observe XP without coupling to a results screen. */
  onXPAward(listener: (award: XPAward) => void) {
    this.xpListeners.add(listener);
    return () => {
      this.xpListeners.delete(listener);
    };
  }
  private mergeXP(raw: any) {
    if (!raw || raw.localPlayerId !== this.value.localPlayerId) return;
    if (raw.xpAwards && typeof raw.xpAwards === "object") {
      for (const [key, candidate] of Object.entries(raw.xpAwards)) {
        let receipt = candidate;
        // Compact persistent receipts retain full breakdown/overflow data without
        // repeating source IDs and three progression objects for every old match.
        if (Array.isArray(candidate)) {
          if (
            ![2, 6].includes(candidate.length) ||
            !candidate.every((n) => Number.isSafeInteger(n) && n >= 0) ||
            !Number.isSafeInteger(candidate[0] + candidate[1])
          )
            continue;
          const [type, id] = key.split(":");
          receipt = {
            source: { type, id },
            amount: candidate[1],
            before: progressionAt(candidate[0]),
            after: progressionAt(candidate[0] + candidate[1]),
            breakdown:
              candidate.length === 6
                ? {
                    playtime: candidate[2],
                    performance: candidate[3],
                    win: candidate[4],
                    mvp: candidate[5],
                    total: candidate[1],
                  }
                : undefined,
          };
        }
        const parsed = xpAwardSchema.safeParse(receipt);
        if (
          parsed.success &&
          key === parsed.data.source.type + ":" + parsed.data.source.id
        )
          this.value.xpAwards[key] = parsed.data;
      }
    }
    const awarded = Object.values(this.value.xpAwards).reduce(
      (n, a) => n + a.amount,
      0,
    );
    const base =
      raw.xpBaseTotal ?? Math.max(0, (raw.progression?.totalXP ?? 0) - awarded);
    if (Number.isSafeInteger(base) && base >= 0)
      this.value.xpBaseTotal = Math.max(this.value.xpBaseTotal, base);
    const total = this.value.xpBaseTotal + awarded;
    if (Number.isSafeInteger(total))
      this.value.progression = progressionAt(total);
    this.value.challengeProgress = mergeChallengeSaves(
      this.value.challengeProgress,
      readChallengeSave(raw.challengeProgress),
    );
    for (const id of Object.keys(this.value.challengeProgress.pending))
      if (this.value.xpAwards["CHALLENGE:" + id])
        acknowledgeChallengeReward(this.value.challengeProgress, id);
  }
  private refreshXP() {
    try {
      const encoded = this.storage?.getItem(localProfileKey) ?? "";
      if (encoded && encoded !== this.cachedProfile) {
        this.mergeXP(JSON.parse(encoded));
        this.cachedProfile = encoded;
      }
    } catch {
      /* Storage fallback remains usable. */
    }
  }
  async completeMatch(completion: MatchCompletion, playerId: string) {
    const breakdown = matchXP(completion, playerId);
    if (!breakdown) return null;
    return this.awardXP(
      breakdown.total,
      { type: "MATCH", id: completion.id },
      breakdown,
    );
  }
  /** Serializes same-origin tabs; the durable ledger is never truncated with recent stat notices. */
  async awardXP(
    amount: number,
    source: XPSource,
    breakdown?: XPBreakdown,
  ): Promise<XPAward | null> {
    if (
      !["MATCH", "CHALLENGE"].includes(source.type) ||
      !Number.isSafeInteger(amount) ||
      amount < 0
    )
      return null;
    const transaction = () => {
      this.refreshXP();
      const key = source.type + ":" + source.id;
      const previous = this.value.xpAwards[key];
      if (previous) return structuredClone(previous);
      const before = { ...this.value.progression },
        total = before.totalXP + amount;
      if (!Number.isSafeInteger(total)) return null;
      const award: XPAward = {
        source: { ...source },
        amount,
        before,
        after: progressionAt(total),
        breakdown,
      };
      if (!xpAwardSchema.safeParse(award).success) return null;
      this.value.xpAwards[key] = award;
      this.value.progression = award.after;
      this.save(); // Persist the receipt and total together before notifying subscribers.
      for (const listener of this.xpListeners) {
        try {
          listener(structuredClone(award));
        } catch {
          /* An observer cannot roll back a committed award. */
        }
      }
      return structuredClone(award);
    };
    return this.withProfileLock(transaction);
  }
  private async withProfileLock<T>(transaction: () => T): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      let entered = false;
      try {
        return await navigator.locks.request(
          "octane-arena-xp:" + this.value.localPlayerId,
          () => {
            entered = true;
            return transaction();
          },
        );
      } catch (error) {
        if (entered) throw error;
        /* Embedded browsers may expose Web Locks but disallow requests. */
      }
    }
    return transaction();
  }
  async updateChallenges(work: (state: ChallengeSave) => boolean) {
    return this.withProfileLock(() => {
      this.refreshXP();
      const changed = work(this.value.challengeProgress);
      if (changed) this.save();
      return changed;
    });
  }
  constructor(private storage?: Pick<Storage, "getItem" | "setItem">) {
    try {
      const raw = JSON.parse(storage?.getItem(localProfileKey) ?? "{}");
      const id = localIdentitySchema.shape.localPlayerId.safeParse(
        raw?.localPlayerId,
      );
      const identity = profileIdentitySchema.safeParse({
        name: raw?.name ?? "Guest",
        avatarId: avatarIdSchema.safeParse(raw?.avatarId).data ?? "helmet",
        avatarColor:
          avatarColorSchema.safeParse(raw?.avatarColor).data ??
          defaultAvatarColor,
      });
      if (id.success) this.value.localPlayerId = id.data;
      if (identity.success) Object.assign(this.value, identity.data);
      for (const key of Object.keys(
        this.value.stats,
      ) as (keyof LocalProfileData["stats"])[]) {
        const n = raw?.stats?.[key];
        if (typeof n === "number" && Number.isFinite(n) && n >= 0)
          this.value.stats[key] = key === "playTime" ? n : Math.floor(n);
      }
      if (Array.isArray(raw?.recentEvents))
        this.value.recentEvents = raw.recentEvents
          .filter((v: unknown) => typeof v === "string" && v.length < 160)
          .slice(-256);
      this.mergeXP(raw);
      const dribble = raw?.challenges?.dribble;
      if (Number.isInteger(dribble) && dribble >= 0 && dribble <= 1000)
        this.value.challenges.dribble = dribble;
    } catch {
      /* Corrupt saves fall back to a playable local profile. */
    }
    this.save();
  }
  customize(
    name: string,
    avatarId = this.value.avatarId,
    avatarColor = this.value.avatarColor,
  ) {
    const identity = profileIdentitySchema.parse({
      name,
      avatarId,
      avatarColor,
    });
    Object.assign(this.value, identity);
    this.save();
  }
  save() {
    try {
      if (!this.storage) throw Error();
      this.refreshXP();
      const xpAwards = Object.fromEntries(
        Object.entries(this.value.xpAwards).map(([key, a]) => [
          key,
          a.breakdown
            ? [
                a.before.totalXP,
                a.amount,
                a.breakdown.playtime,
                a.breakdown.performance,
                a.breakdown.win,
                a.breakdown.mvp,
              ]
            : [a.before.totalXP, a.amount],
        ]),
      );
      const encoded = JSON.stringify({ ...this.value, xpAwards });
      this.storage.setItem(localProfileKey, encoded);
      this.cachedProfile = encoded;
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
    this.pendingTime = 0;
  }
  reset() {
    // Identity stays stable so a reset never invalidates an active LAN session.
    Object.assign(this.value, {
      name: "Guest",
      avatarId: "helmet",
      avatarColor: defaultAvatarColor,
      stats: blankStats(),
      challenges: {},
    });
    this.save();
  }
  flush() {
    if (this.pendingTime > 0) this.save();
  }
  challengeProgress(id: string, total: number) {
    const count = this.value.challenges[id] ?? 0;
    return Number.isInteger(count) && count >= 0 && count <= total ? count : 0;
  }
  completeChallengeLevel(id: string, level: number, total: number) {
    const completed = this.challengeProgress(id, total);
    if (
      !Number.isInteger(level) ||
      level < 1 ||
      level > total ||
      level > completed + 1
    )
      return false;
    this.value.challenges[id] = Math.max(completed, level);
    this.save();
    return true;
  }
  addPlayTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.value.stats.playTime += seconds;
    this.pendingTime += seconds;
    if (this.pendingTime >= 5) this.save();
  }
  private event(key: string, work: () => void) {
    if (this.value.recentEvents.includes(key)) return;
    work();
    this.value.recentEvents.push(key);
    this.value.recentEvents = this.value.recentEvents.slice(-256);
    this.save();
  }
  observeMatch(
    id: string,
    localId: string,
    team: number,
    phase: string,
    score: number[],
    goal?: { scorerId: string; ownGoal: boolean } | null,
    matchStats?: PlayerMatchStats,
  ) {
    if (
      !matchStats &&
      phase === "goal" &&
      goal?.scorerId === localId &&
      !goal.ownGoal
    )
      this.event(
        `${id}:goal:${score.join(":")}`,
        () => this.value.stats.goals++,
      );
    if (phase === "finished")
      this.event(`${id}:finished`, () => {
        this.value.stats.matchesPlayed++;
        if (matchStats && matchStats.playerId === localId) {
          const credited = this.value.recentEvents.filter((key) =>
            key.startsWith(id + ":goal:"),
          ).length;
          this.value.stats.goals += Math.max(0, matchStats.goals - credited);
          this.value.stats.assists += matchStats.assists;
          this.value.stats.saves += matchStats.saves;
          this.value.stats.shots += matchStats.shots;
        }
        const difference = score[team] - score[1 - team];
        if (difference > 0) this.value.stats.wins++;
        if (difference < 0) this.value.stats.losses++;
      });
  }
}
export function browserProfile() {
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Session-only fallback. */
  }
  return new LocalProfile(storage);
}
