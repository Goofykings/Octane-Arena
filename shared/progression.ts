import { z } from "zod";
import type { PlayerInput } from "./player";

/** All progression balancing lives here. Levels measure play, never competitive rank. */
export const XP_TUNING = {
  perSecond: 4,
  maxPlaySeconds: 1200,
  scoreMultiplier: 0.1,
  win: 100,
  mvp: 50,
  minimumScore: 20,
  minimumActivitySeconds: 3,
  firstLevelXP: 1000,
  earlyLevelStep: 1000,
  steadyLevel: 20,
  steadyLevelXP: 20000,
  animationSeconds: 2.2,
} as const;
export interface Progression {
  level: number;
  currentLevelXP: number;
  totalXP: number;
}
export type XPSourceType =
  | "MATCH"
  | "CHALLENGE"
  | "EVENT"
  | "ROCKET_PASS_BONUS";
export interface XPSource {
  type: XPSourceType;
  id: string;
}
export interface XPBreakdown {
  playtime: number;
  performance: number;
  win: number;
  mvp: number;
  total: number;
}
export interface XPAward {
  source: XPSource;
  amount: number;
  before: Progression;
  after: Progression;
  breakdown?: XPBreakdown;
}
const safe = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const completionSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(["bot", "network"]),
  activeSeconds: z.number().finite().nonnegative(),
  score: z.tuple([safe, safe]),
  mvpId: z.string().max(80).nullable(),
  players: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        team: z.union([z.literal(0), z.literal(1)]),
        controller: z.enum(["local", "remote", "bot"]),
        completed: z.boolean(),
        score: safe,
        activeSeconds: z.number().finite().nonnegative(),
        activitySeconds: z.number().finite().nonnegative(),
      }),
    )
    .min(1)
    .max(6),
});
export type MatchCompletion = z.infer<typeof completionSchema>;
export function xpRequired(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) throw Error("Invalid level");
  return level >= XP_TUNING.steadyLevel
    ? XP_TUNING.steadyLevelXP
    : XP_TUNING.firstLevelXP + (level - 1) * XP_TUNING.earlyLevelStep;
}
export function xpAtLevel(level: number): number {
  xpRequired(level);
  let total = 0;
  for (let i = 1; i < Math.min(level, XP_TUNING.steadyLevel); i++)
    total += xpRequired(i);
  total += Math.max(0, level - XP_TUNING.steadyLevel) * XP_TUNING.steadyLevelXP;
  if (!Number.isSafeInteger(total))
    throw Error("XP exceeds safe integer range");
  return total;
}
export function progressionAt(totalXP: number): Progression {
  if (!Number.isSafeInteger(totalXP) || totalXP < 0) throw Error("Invalid XP");
  let level = 1,
    remaining = totalXP;
  while (level < XP_TUNING.steadyLevel && remaining >= xpRequired(level)) {
    remaining -= xpRequired(level++);
  }
  if (level >= XP_TUNING.steadyLevel) {
    level += Math.floor(remaining / XP_TUNING.steadyLevelXP);
    remaining %= XP_TUNING.steadyLevelXP;
  }
  return { level, currentLevelXP: remaining, totalXP };
}
export function meaningfulInput(input: PlayerInput): boolean {
  return (
    input.jump ||
    input.boost ||
    !!input.usePowerup ||
    [input.throttle, input.steer, input.pitch, input.yaw, input.roll].some(
      (v) => Math.abs(v) > 0.15,
    )
  );
}
/** Only a completion produced by match authority is accepted; never recount stat events. */
export function matchXP(
  completion: MatchCompletion,
  playerId: string,
): XPBreakdown | null {
  if (completion.mode !== "bot" && completion.mode !== "network") return null;
  const p = completion.players.find((p) => p.id === playerId);
  if (
    !p ||
    !p.completed ||
    p.controller === "bot" ||
    (p.score < XP_TUNING.minimumScore &&
      p.activitySeconds < XP_TUNING.minimumActivitySeconds)
  )
    return null;
  const playtime = Math.floor(
    Math.min(
      p.activeSeconds,
      completion.activeSeconds,
      XP_TUNING.maxPlaySeconds,
    ) *
      XP_TUNING.perSecond +
      1e-7,
  );
  const performance = Math.round(p.score * XP_TUNING.scoreMultiplier);
  const win =
    completion.score[p.team] > completion.score[1 - p.team] ? XP_TUNING.win : 0;
  const mvp = completion.mvpId === playerId ? XP_TUNING.mvp : 0;
  return {
    playtime,
    performance,
    win,
    mvp,
    total: playtime + performance + win + mvp,
  };
}

const progressionSchema = z.object({
  level: safe.min(1),
  currentLevelXP: safe,
  totalXP: safe,
});
export const xpAwardSchema = z
  .object({
    source: z.object({
      type: z.enum(["MATCH", "CHALLENGE", "EVENT", "ROCKET_PASS_BONUS"]),
      id: z.string().min(1).max(160),
    }),
    amount: safe,
    before: progressionSchema,
    after: progressionSchema,
    breakdown: z
      .object({
        playtime: safe,
        performance: safe,
        win: safe,
        mvp: safe,
        total: safe,
      })
      .optional(),
  })
  .refine((a) =>
    a.source.type === "CHALLENGE"
      ? /^challenge\/(DAILY|WEEKLY|SEASON)\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(
          a.source.id,
        )
      : z.string().uuid().safeParse(a.source.id).success,
  )
  .refine((a) => a.after.totalXP - a.before.totalXP === a.amount);
