import { DROPSHOT_CONFIG } from "./dropshot";
import { z } from "zod";
export const MATCH_POINTS = {
  BALL_TOUCH: 2,
  GOAL: 100,
  ASSIST: 50,
  SAVE: 50,
  SHOT: 10,
  DAMAGE: DROPSHOT_CONFIG.damagePoints,
} as const;
export const STAT_TUNING = {
  assistWindow: 5,
  predictionHorizon: 3,
  heatPredictionHorizon: 6,
  predictionStep: 1 / 60,
  saveHorizon: 2.5,
  materialVelocityChange: 0.75,
  threatCheckInterval: 0.1,
  threatNeutralTime: 0.2,
  eventHistory: 24,
  touchHistory: 128,
} as const;
export type StatKind = keyof typeof MATCH_POINTS;
export const STAT_FIELD = {
  BALL_TOUCH: "touches",
  SHOT: "shots",
  SAVE: "saves",
  ASSIST: "assists",
  GOAL: "goals",
  DAMAGE: "damage",
} as const;
/** Called only by the stat authority when it awards an already classified event. */
export function applyStatAward(
  stats: PlayerMatchStats,
  type: StatKind,
  amount = 1,
) {
  const field = STAT_FIELD[type];
  stats[field] = (stats[field] ?? 0) + amount;
  stats.score += MATCH_POINTS[type] * amount;
}
export interface PlayerMatchStats {
  playerId: string;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  touches: number;
  damage?: number;
  ping: number | null;
}
export function scoreboardOrder<T extends { id: string; team: 0 | 1 }>(
  players: T[],
  stats: PlayerMatchStats[],
  team: 0 | 1,
) {
  const scores = new Map(stats.map((s) => [s.playerId, s.score]));
  return players
    .map((player, index) => ({ player, index }))
    .filter((row) => row.player.team === team)
    .sort(
      (a, b) =>
        (scores.get(b.player.id) ?? 0) - (scores.get(a.player.id) ?? 0) ||
        a.index - b.index,
    )
    .map((row) => row.player);
}
export interface MatchStatEvent {
  id: number;
  type: StatKind;
  playerId: string;
  team: 0 | 1;
  scoreAward: number;
  timestamp: number;
}
export const playerStatsSchema = z.object({
  playerId: z.string().max(80),
  score: z.number().int().nonnegative(),
  goals: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  shots: z.number().int().nonnegative(),
  touches: z.number().int().nonnegative(),
  damage: z.number().int().nonnegative().optional(),
  ping: z.number().finite().min(0).max(60000).nullable(),
});
export const statEventSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(["BALL_TOUCH", "GOAL", "ASSIST", "SAVE", "SHOT", "DAMAGE"]),
  playerId: z.string().max(80),
  team: z.union([z.literal(0), z.literal(1)]),
  scoreAward: z.number().int().nonnegative(),
  timestamp: z.number().finite(),
});

/** Deterministic MVP across both teams. Stable roster order is final tiebreak. */
export function matchMvp<T extends { id: string }>(
  players: readonly T[],
  stats: readonly PlayerMatchStats[],
): T | undefined {
  const byId = new Map(stats.map((s) => [s.playerId, s]));
  return players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      for (const key of [
        "score",
        "goals",
        "assists",
        "saves",
        "shots",
      ] as const) {
        const delta =
          (byId.get(b.player.id)?.[key] ?? 0) -
          (byId.get(a.player.id)?.[key] ?? 0);
        if (delta) return delta;
      }
      return a.index - b.index;
    })[0]?.player;
}
