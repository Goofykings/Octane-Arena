import { z } from "zod";
import { soccerModes, type SoccerMode } from "./soccer";
import type { PlayerMatchStats } from "./match-stats";
import { matchXP, type MatchCompletion } from "./progression";

export const SEASON_CONFIG = {
  id: "season-1",
  name: "SEASON 1",
  timeZone: "America/New_York",
  startsAt: Date.parse("2026-10-18T00:00:00-04:00"),
  endsAt: Date.parse("2026-11-18T00:00:00-05:00"),
} as const;
export const CHALLENGE_CATEGORIES = ["DAILY", "WEEKLY", "SEASON"] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];
/** Only counters supported by current match authority are exposed. */
export type ChallengeType =
  | "PLAY_MATCHES"
  | "WIN_MATCHES"
  | "SCORE_GOALS"
  | "GET_ASSISTS"
  | "GET_SAVES"
  | "TAKE_SHOTS"
  | "TOUCH_BALL"
  | "EARN_MATCH_SCORE"
  | "PLAY_SPECIFIC_MODE"
  | "WIN_SPECIFIC_MODE"
  | "UNIQUE_MODES";
export interface ChallengeDefinition {
  id: string;
  category: ChallengeCategory;
  name: string;
  description: string;
  type: ChallengeType;
  target: number;
  xpReward: number;
  filters?: {
    modes?: readonly SoccerMode[];
    matchKinds?: readonly ("bot" | "network")[];
  };
}
const definition = (
  category: ChallengeCategory,
  id: string,
  name: string,
  description: string,
  type: ChallengeType,
  target: number,
  xpReward: number,
  filters?: ChallengeDefinition["filters"],
): ChallengeDefinition => ({
  category,
  id,
  name,
  description,
  type,
  target,
  xpReward,
  filters,
});
export const DAILY_CHALLENGES: readonly ChallengeDefinition[] = [
  definition(
    "DAILY",
    "first-drive",
    "FIRST DRIVE",
    "Play 1 match",
    "PLAY_MATCHES",
    1,
    1000,
  ),
  definition(
    "DAILY",
    "winner",
    "WINNER",
    "Win 1 match",
    "WIN_MATCHES",
    1,
    1500,
  ),
  definition(
    "DAILY",
    "get-involved",
    "GET INVOLVED",
    "Get 5 ball touches",
    "TOUCH_BALL",
    5,
    750,
  ),
];
export const WEEKLY_CHALLENGES: readonly ChallengeDefinition[] = [
  definition(
    "WEEKLY",
    "regular-driver",
    "REGULAR DRIVER",
    "Play 5 matches",
    "PLAY_MATCHES",
    5,
    3000,
  ),
  definition(
    "WEEKLY",
    "winning-form",
    "WINNING FORM",
    "Win 3 matches",
    "WIN_MATCHES",
    3,
    4000,
  ),
  definition(
    "WEEKLY",
    "goal-getter",
    "GOAL GETTER",
    "Score 8 goals",
    "SCORE_GOALS",
    8,
    4000,
  ),
  definition(
    "WEEKLY",
    "defender",
    "DEFENDER",
    "Get 5 saves",
    "GET_SAVES",
    5,
    3500,
  ),
  definition(
    "WEEKLY",
    "shooter",
    "SHOOTER",
    "Take 15 shots",
    "TAKE_SHOTS",
    15,
    3000,
  ),
  definition(
    "WEEKLY",
    "mode-hopper",
    "MODE HOPPER",
    "Complete matches in 3 different modes",
    "UNIQUE_MODES",
    3,
    5000,
  ),
];
export const SEASON_1_CHALLENGES: readonly ChallengeDefinition[] = [
  definition(
    "SEASON",
    "seasoned-driver",
    "SEASONED DRIVER",
    "Play 30 matches",
    "PLAY_MATCHES",
    30,
    10000,
  ),
  definition(
    "SEASON",
    "champion",
    "CHAMPION",
    "Win 15 matches",
    "WIN_MATCHES",
    15,
    12500,
  ),
  definition(
    "SEASON",
    "goal-machine",
    "GOAL MACHINE",
    "Score 40 goals",
    "SCORE_GOALS",
    40,
    10000,
  ),
  definition(
    "SEASON",
    "the-wall",
    "THE WALL",
    "Get 25 saves",
    "GET_SAVES",
    25,
    10000,
  ),
  definition(
    "SEASON",
    "play-everything",
    "PLAY EVERYTHING",
    "Complete Soccar, Heatseeker, Rumble, Hoops and Dropshot",
    "UNIQUE_MODES",
    5,
    15000,
    { modes: soccerModes.map((m) => m.id) },
  ),
  definition(
    "SEASON",
    "high-scorer",
    "HIGH SCORER",
    "Earn 10,000 total Match Score",
    "EARN_MATCH_SCORE",
    10000,
    15000,
  ),
];
export const CHALLENGES = [
  ...DAILY_CHALLENGES,
  ...WEEKLY_CHALLENGES,
  ...SEASON_1_CHALLENGES,
];
const dayMs = 86400000;
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEASON_CONFIG.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function calendarKey(now: number): string {
  const parts = dateFormat.formatToParts(now),
    get = (name: string) => parts.find((p) => p.type === name)!.value;
  return get("year") + "-" + get("month") + "-" + get("day");
}
export function challengePeriod(
  category: ChallengeCategory,
  now: number,
): string {
  if (category === "SEASON") return SEASON_CONFIG.id;
  const day = calendarKey(now);
  if (category === "DAILY") return day;
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function seasonStatus(now: number): "UPCOMING" | "ACTIVE" | "COMPLETE" {
  return now < SEASON_CONFIG.startsAt
    ? "UPCOMING"
    : now < SEASON_CONFIG.endsAt
      ? "ACTIVE"
      : "COMPLETE";
}
export function seasonDateLabels() {
  const format = (date: number, month: "long" | "short", year = false) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: SEASON_CONFIG.timeZone,
      month,
      day: "numeric",
      ...(year ? { year: "numeric" as const } : {}),
    })
      .format(date)
      .toUpperCase();
  return {
    range:
      format(SEASON_CONFIG.startsAt, "short") +
      " - " +
      format(SEASON_CONFIG.endsAt, "short"),
    starts: format(SEASON_CONFIG.startsAt, "long"),
    ends: format(SEASON_CONFIG.endsAt, "long"),
    endsWithYear: format(SEASON_CONFIG.endsAt, "long", true),
  };
}
const resetDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEASON_CONFIG.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
/** Next Monday midnight in the same calendar zone used by challengePeriod.
 * Convert the local calendar date, rather than adding 168 hours across DST. */
export function weeklyResetAt(now: number): number {
  const next = new Date(challengePeriod("WEEKLY", now) + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 7);
  return calendarMidnightAt(next.getTime());
}
export function dailyResetAt(now: number): number {
  const next = new Date(calendarKey(now) + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  return calendarMidnightAt(next.getTime());
}
function calendarMidnightAt(target: number): number {
  let reset = target;
  for (let i = 0; i < 3; i++) {
    const parts = resetDateFormat.formatToParts(reset);
    const get = (name: string) =>
      Number(parts.find((p) => p.type === name)!.value);
    const local = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    const correction = target - local;
    reset += correction;
    if (correction === 0) break;
  }
  return reset;
}
export function weeklyCountdown(now: number): string {
  return resetCountdown(weeklyResetAt(now), now);
}
export function dailyCountdown(now: number): string {
  return resetCountdown(dailyResetAt(now), now);
}
function resetCountdown(resetAt: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((resetAt - now) / 60000));
  const hours = Math.floor(minutes / 60);
  return (
    "RESETS IN " +
    (hours >= 24
      ? Math.floor(hours / 24) + " DAYS " + (hours % 24) + " HOURS"
      : hours + " HOURS " + (minutes % 60) + " MIN")
  );
}
export function seasonCountdown(now: number): string {
  const status = seasonStatus(now);
  if (status === "COMPLETE") return "SEASON COMPLETE";
  if (status === "UPCOMING") return "STARTS " + seasonDateLabels().starts;
  const hours = Math.max(0, Math.floor((SEASON_CONFIG.endsAt - now) / 3600000));
  return hours >= 24
    ? Math.floor(hours / 24) + " DAYS " + (hours % 24) + " HOURS LEFT"
    : hours +
        " HOURS " +
        (Math.floor((SEASON_CONFIG.endsAt - now) / 60000) % 60) +
        " MIN LEFT";
}
export function challengeRewardId(
  category: ChallengeCategory,
  period: string,
  id: string,
) {
  return "challenge/" + category + "/" + period + "/" + id;
}
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const modeSchema = z.enum([
  "soccar",
  "heatseeker",
  "rumble",
  "hoops",
  "dropshot",
]);
const progressSchema = z.object({
  progress: count,
  completed: z.boolean(),
  rewardClaimed: z.boolean(),
  modes: z.array(modeSchema).max(5),
});
const periodSchema = z.object({
  key: z.string().max(80),
  entries: z.record(z.string().max(80), progressSchema),
});
const pendingSchema = z.object({
  id: z.string().max(80),
  category: z.enum(CHALLENGE_CATEGORIES),
  period: z.string().max(80),
  name: z.string().max(100),
  amount: count,
  matchId: z.string().max(80),
  claimRequested: z.boolean().optional(),
});
export const challengeSaveSchema = z.object({
  version: z.literal(1),
  periods: z.object({
    DAILY: periodSchema,
    WEEKLY: periodSchema,
    SEASON: periodSchema,
  }),
  // score/goals/assists/saves/shots/touches + completed; compact durable high-water marks.
  history: z.record(z.string().max(170), z.array(count).length(7)),
  pending: z.record(z.string().max(160), pendingSchema),
});
export type ChallengeProgress = z.infer<typeof progressSchema>;
export type ChallengeSave = z.infer<typeof challengeSaveSchema>;
export type ChallengeReward = z.infer<typeof pendingSchema>;
export const blankChallengeProgress = (): ChallengeProgress => ({
  progress: 0,
  completed: false,
  rewardClaimed: false,
  modes: [],
});
export const blankChallengeSave = (): ChallengeSave => ({
  version: 1,
  periods: {
    DAILY: { key: "", entries: {} },
    WEEKLY: { key: "", entries: {} },
    SEASON: { key: "", entries: {} },
  },
  history: {},
  pending: {},
});
export function readChallengeSave(raw: unknown): ChallengeSave {
  const parsed = challengeSaveSchema.safeParse(raw);
  return parsed.success ? parsed.data : blankChallengeSave();
}
/** Stale profile/customization saves cannot erase newer challenge state. */
export function mergeChallengeSaves(
  a: ChallengeSave,
  b: ChallengeSave,
): ChallengeSave {
  for (const category of CHALLENGE_CATEGORIES) {
    const current = a.periods[category],
      other = b.periods[category];
    if (!other.key) continue;
    if (
      !current.key ||
      (category !== "SEASON" && other.key > current.key) ||
      (category === "SEASON" &&
        other.key === SEASON_CONFIG.id &&
        current.key !== other.key)
    ) {
      a.periods[category] = structuredClone(other);
      continue;
    }
    if (current.key !== other.key) continue;
    for (const [id, progress] of Object.entries(other.entries)) {
      const own = current.entries[id];
      current.entries[id] = own
        ? {
            progress: Math.max(own.progress, progress.progress),
            completed: own.completed || progress.completed,
            rewardClaimed: own.rewardClaimed || progress.rewardClaimed,
            modes: [...new Set([...own.modes, ...progress.modes])],
          }
        : structuredClone(progress);
    }
  }
  for (const [key, values] of Object.entries(b.history)) {
    const own = a.history[key];
    a.history[key] = own
      ? own.map((v, i) => Math.max(v, values[i]))
      : [...values];
  }
  for (const [id, reward] of Object.entries(b.pending))
    a.pending[id] = {
      ...reward,
      claimRequested: !!(
        a.pending[id]?.claimRequested || reward.claimRequested
      ),
    };
  return a;
}
export function resetChallengePeriods(
  state: ChallengeSave,
  now: number,
): boolean {
  let changed = false;
  for (const category of CHALLENGE_CATEGORIES) {
    const key = challengePeriod(category, now),
      current = state.periods[category].key;
    // A clock correction must not reset an already newer Daily/Weekly set backwards.
    if (current === key || (category !== "SEASON" && current > key)) continue;
    for (const [id, reward] of Object.entries(state.pending))
      if (
        reward.category === category &&
        reward.period !== key &&
        !reward.claimRequested
      )
        delete state.pending[id];
    state.periods[category] = { key, entries: {} };
    changed = true;
  }
  return changed;
}
export interface ChallengeMatchUpdate {
  matchId: string;
  playerId: string;
  mode: string;
  gameMode: SoccerMode;
  controller: string;
  phase: string;
  stats?: PlayerMatchStats;
  completion?: MatchCompletion | null;
}
const fields = [
  "score",
  "goals",
  "assists",
  "saves",
  "shots",
  "touches",
] as const;
const statIndex: Partial<Record<ChallengeType, number>> = {
  EARN_MATCH_SCORE: 0,
  SCORE_GOALS: 1,
  GET_ASSISTS: 2,
  GET_SAVES: 3,
  TAKE_SHOTS: 4,
  TOUCH_BALL: 5,
};
export function applyChallengeUpdate(
  state: ChallengeSave,
  update: ChallengeMatchUpdate,
  now: number,
  definitions: readonly ChallengeDefinition[] = CHALLENGES,
): boolean {
  let changed = resetChallengePeriods(state, now);
  const u = update;
  if (
    (u.mode !== "bot" && u.mode !== "network") ||
    (u.controller !== "local" && u.controller !== "remote") ||
    !["playing", "goal", "finished"].includes(u.phase) ||
    !u.stats ||
    u.stats.playerId !== u.playerId
  )
    return changed;
  const key = u.matchId + "/" + u.playerId,
    previous = state.history[key] ?? Array(7).fill(0);
  if (previous[6]) return changed; // A finalized match cannot earn more progress on a later resync.
  const counters = fields.map((f) => u.stats![f]);
  if (!counters.every((n) => Number.isSafeInteger(n) && n >= 0)) return changed;
  const delta = counters.map((n, i) => Math.max(0, n - previous[i]));
  const completion =
    u.phase === "finished" && u.completion?.id === u.matchId
      ? u.completion
      : null;
  const finished =
    !previous[6] && !!completion && !!matchXP(completion, u.playerId);
  const player = completion?.players.find((p) => p.id === u.playerId);
  const won =
    finished &&
    player &&
    completion!.score[player.team] > completion!.score[1 - player.team];
  if (!delta.some(Boolean) && !finished) return changed;
  state.history[key] = [
    ...counters.map((n, i) => Math.max(n, previous[i])),
    finished ? 1 : previous[6],
  ];
  changed = true;
  for (const d of definitions) {
    if (d.category === "SEASON" && seasonStatus(now) !== "ACTIVE") continue;
    if (d.filters?.matchKinds && !d.filters.matchKinds.includes(u.mode))
      continue;
    if (d.filters?.modes && !d.filters.modes.includes(u.gameMode)) continue;
    const set = state.periods[d.category],
      p = (set.entries[d.id] ??= blankChallengeProgress());
    if (p.completed) continue;
    const index = statIndex[d.type];
    const amount =
      index !== undefined
        ? delta[index]
        : d.type === "WIN_MATCHES" || d.type === "WIN_SPECIFIC_MODE"
          ? won
            ? 1
            : 0
          : finished
            ? 1
            : 0;
    if (!amount) continue;
    if (d.type === "UNIQUE_MODES") {
      if (!p.modes.includes(u.gameMode)) p.modes.push(u.gameMode);
      p.progress = Math.min(d.target, p.modes.length);
    } else p.progress = Math.min(d.target, p.progress + amount);
    if (p.progress >= d.target) {
      p.completed = true;
      const rewardId = challengeRewardId(d.category, set.key, d.id);
      state.pending[rewardId] = {
        id: d.id,
        category: d.category,
        period: set.key,
        name: d.name,
        amount: d.xpReward,
        matchId: u.matchId,
      };
    }
  }
  return changed;
}
export function acknowledgeChallengeReward(
  state: ChallengeSave,
  rewardId: string,
): boolean {
  const reward = state.pending[rewardId];
  if (!reward) return false;
  const set = state.periods[reward.category],
    entry = set.entries[reward.id];
  if (set.key === reward.period && entry) entry.rewardClaimed = true;
  delete state.pending[rewardId];
  return true;
}
