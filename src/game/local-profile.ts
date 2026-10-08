import {
  localIdentitySchema,
  profileIdentitySchema,
  newLocalPlayerId,
  avatarIdSchema,
  avatarColorSchema,
  defaultAvatarColor,
} from "../../shared/local-profile";
import type { PlayerMatchStats } from "../../shared/match-stats";
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
  localPlayerId: string;
  name: string;
  avatarId: string;
  avatarColor: string;
  stats: ReturnType<typeof blankStats>;
  recentEvents: string[];
  challenges: Record<string, number>;
}
export class LocalProfile {
  value: LocalProfileData = {
    profileVersion: 1,
    localPlayerId: newLocalPlayerId(),
    name: "Guest",
    avatarId: "helmet",
    avatarColor: defaultAvatarColor,
    stats: blankStats(),
    recentEvents: [],
    challenges: {},
  };
  persistent = true;
  private pendingTime = 0;
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
      this.storage.setItem(localProfileKey, JSON.stringify(this.value));
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
