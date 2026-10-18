import assert from "node:assert/strict";
import {
  CHALLENGES,
  DAILY_CHALLENGES,
  WEEKLY_CHALLENGES,
  SEASON_1_CHALLENGES,
  SEASON_CONFIG,
  challengePeriod,
  calendarKey,
  seasonStatus,
  seasonCountdown,
  weeklyCountdown,
  weeklyResetAt,
  dailyResetAt,
  dailyCountdown,
  blankChallengeSave,
  applyChallengeUpdate,
  challengeRewardId,
  type ChallengeMatchUpdate,
  type ChallengeDefinition,
} from "../shared/challenges";
import { LocalProfile, localProfileKey } from "../src/game/local-profile";
import { Challenges } from "../src/game/challenges";
import { applyStatAward, type PlayerMatchStats } from "../shared/match-stats";
import type { MatchCompletion } from "../shared/progression";
const start = Date.parse("2026-10-18T12:00:00-04:00");
assert.equal(DAILY_CHALLENGES.length, 3);
assert.equal(WEEKLY_CHALLENGES.length, 6);
assert.equal(SEASON_1_CHALLENGES.length, 6);
assert.equal(new Set(CHALLENGES.map((d) => d.id)).size, 15);
assert.ok(CHALLENGES.every((d) => d.target > 0 && d.xpReward > 0));
assert.equal(SEASON_CONFIG.startsAt, Date.parse("2026-10-18T04:00:00Z"));
assert.equal(SEASON_CONFIG.endsAt, Date.parse("2026-11-18T05:00:00Z"));
assert.equal(
  SEASON_CONFIG.endsAt - SEASON_CONFIG.startsAt,
  31 * 86400000 + 3600000,
  "Calendar month includes the New York DST change",
);
assert.equal(seasonStatus(SEASON_CONFIG.startsAt - 1), "UPCOMING");
assert.equal(seasonStatus(SEASON_CONFIG.startsAt), "ACTIVE");
assert.equal(seasonStatus(SEASON_CONFIG.endsAt - 1), "ACTIVE");
assert.equal(seasonStatus(SEASON_CONFIG.endsAt), "COMPLETE");
assert.equal(seasonCountdown(SEASON_CONFIG.endsAt), "SEASON COMPLETE");
assert.equal(weeklyResetAt(start), Date.parse("2026-10-19T00:00:00-04:00"));
assert.equal(weeklyCountdown(start), "RESETS IN 12 HOURS 0 MIN");
assert.equal(
  weeklyCountdown(Date.parse("2026-10-18T23:59:30-04:00")),
  "RESETS IN 0 HOURS 1 MIN",
);
assert.equal(
  weeklyCountdown(Date.parse("2026-10-19T00:00:00-04:00")),
  "RESETS IN 7 DAYS 0 HOURS",
);
assert.equal(
  weeklyResetAt(Date.parse("2026-10-26T00:00:00-04:00")),
  Date.parse("2026-11-02T00:00:00-05:00"),
);
assert.equal(
  weeklyCountdown(Date.parse("2026-10-26T00:00:00-04:00")),
  "RESETS IN 7 DAYS 1 HOURS",
);
assert.equal(
  weeklyResetAt(Date.parse("2026-03-02T00:00:00-05:00")),
  Date.parse("2026-03-09T00:00:00-04:00"),
);
assert.equal(
  weeklyCountdown(Date.parse("2026-03-02T00:00:00-05:00")),
  "RESETS IN 6 DAYS 23 HOURS",
);
assert.equal(challengePeriod("WEEKLY", start), "2026-10-12");
assert.equal(
  challengePeriod("WEEKLY", Date.parse("2026-10-19T00:00:00-04:00")),
  "2026-10-19",
);
assert.equal(
  calendarKey(Date.parse("2026-11-01T01:30:00-04:00")),
  "2026-11-01",
);
assert.equal(
  calendarKey(Date.parse("2026-11-01T01:30:00-05:00")),
  "2026-11-01",
);
assert.equal(
  challengePeriod("WEEKLY", Date.parse("2026-11-02T00:00:00-05:00")),
  "2026-11-02",
);
assert.equal(dailyCountdown(start), "RESETS IN 12 HOURS 0 MIN");
assert.equal(
  dailyResetAt(Date.parse("2026-11-01T00:00:00-04:00")),
  Date.parse("2026-11-02T00:00:00-05:00"),
);
assert.equal(
  dailyResetAt(Date.parse("2026-03-08T00:00:00-05:00")),
  Date.parse("2026-03-09T00:00:00-04:00"),
);
const storage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};
const memory = storage(),
  profile = new LocalProfile(memory),
  id = profile.value.localPlayerId;
profile.customize("Season Pilot", "fox");
profile.value.stats.wins = 8;
profile.save();
let now = start;
const service = new Challenges(profile, () => now);
let popups = 0;
service.onComplete(() => popups++);
await service.settled();
const stats = (playerId = id): PlayerMatchStats => ({
  playerId,
  score: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  shots: 0,
  touches: 0,
  ping: null,
});
const completion = (
  matchId: string,
  s: PlayerMatchStats,
  win = true,
): MatchCompletion => ({
  id: matchId,
  mode: "bot",
  score: win ? [1, 0] : [0, 1],
  mvpId: id,
  activeSeconds: 300,
  players: [
    {
      id: s.playerId,
      team: 0,
      controller: "local",
      completed: true,
      score: s.score,
      activeSeconds: 300,
      activitySeconds: 10,
    },
  ],
});
const packet = (
  s: PlayerMatchStats,
  matchId = crypto.randomUUID(),
): ChallengeMatchUpdate => ({
  matchId,
  playerId: s.playerId,
  mode: "bot",
  gameMode: "soccar",
  controller: "local",
  phase: "playing",
  stats: s,
});
const claimAll = async (challenges: Challenges) => {
  for (const reward of Object.values(challenges.state.pending))
    await challenges.claim(reward.category, reward.id);
};
const entry = (category: "DAILY" | "WEEKLY" | "SEASON", name: string) =>
  service.state.periods[category].entries[name];
const s = stats(),
  first = packet(s);
for (let i = 0; i < 5; i++) applyStatAward(s, "BALL_TOUCH");
service.observe(first);
await service.settled();
assert.equal(entry("DAILY", "get-involved").progress, 5);
assert.equal(entry("DAILY", "get-involved").rewardClaimed, false);
assert.equal(
  profile.value.progression.totalXP,
  0,
  "Completion does not grant XP before claim",
);
const waiting = new Challenges(new LocalProfile(memory), () => now);
await waiting.settled();
assert.equal(
  waiting.profile.value.progression.totalXP,
  0,
  "Reload keeps unclaimed rewards ready",
);
const claimResults = await Promise.all([
  service.claim("DAILY", "get-involved"),
  service.claim("DAILY", "get-involved"),
]);
assert.equal(
  claimResults.filter(Boolean).length,
  1,
  "Double claim grants once",
);
assert.ok(entry("DAILY", "get-involved").rewardClaimed);
assert.equal(profile.value.progression.totalXP, 750);
assert.equal(popups, 1);
first.phase = "finished";
first.completion = completion(first.matchId, s);
service.observe(first);
await service.settled();
assert.equal(entry("DAILY", "first-drive").progress, 1);
assert.ok(entry("DAILY", "first-drive").completed);
await claimAll(service);
assert.ok(entry("DAILY", "first-drive").rewardClaimed);
assert.equal(entry("DAILY", "winner").progress, 1);
assert.equal(profile.value.progression.totalXP, 3250);
assert.equal(profile.value.progression.level, 3);
assert.equal(popups, 3);
assert.equal(Object.keys(service.state.pending).length, 0);
for (let i = 0; i < 10; i++) {
  service.observe(first);
  await service.settled();
}
assert.equal(profile.value.progression.totalXP, 3250);
assert.equal(entry("WEEKLY", "regular-driver").progress, 1);
assert.equal(entry("SEASON", "seasoned-driver").progress, 1);
const loaded = new LocalProfile(memory),
  loadedService = new Challenges(loaded, () => now);
await loadedService.settled();
loadedService.observe(first);
await loadedService.settled();
assert.equal(loaded.value.progression.totalXP, 3250);
assert.equal(loaded.value.name, "Season Pilot");
assert.equal(loaded.value.stats.wins, 8);
assert.equal(
  loadedService.state.periods.DAILY.entries["first-drive"].rewardClaimed,
  true,
);
// Replay and out-of-order snapshots cannot inflate action progress; cumulative totals recover missed event packets.
const goalStats = stats(),
  goalMatch = packet(goalStats);
applyStatAward(goalStats, "GOAL");
service.observe(goalMatch);
await service.settled();
assert.equal(entry("WEEKLY", "goal-getter").progress, 1);
service.observe({
  ...goalMatch,
  phase: "replay",
  stats: { ...goalStats, goals: 8, score: 800 },
});
await service.settled();
assert.equal(entry("WEEKLY", "goal-getter").progress, 1);
for (let i = 1; i < 8; i++) applyStatAward(goalStats, "GOAL");
service.observe(goalMatch);
await service.settled();
assert.equal(entry("WEEKLY", "goal-getter").progress, 8);
await claimAll(service);
assert.ok(entry("WEEKLY", "goal-getter").rewardClaimed);
const afterGoals = profile.value.progression.totalXP;
service.observe({
  ...goalMatch,
  stats: { ...goalStats, goals: 1, score: 100 },
});
await service.settled();
service.observe(goalMatch);
await service.settled();
assert.equal(profile.value.progression.totalXP, afterGoals);
assert.equal(entry("SEASON", "goal-machine").progress, 8);
// Duplicate modes are a set, not a match counter. New matches use new IDs.
for (const mode of [
  "soccar",
  "soccar",
  "hoops",
  "dropshot",
  "heatseeker",
  "rumble",
] as const) {
  const st = stats(),
    u = packet(st);
  u.gameMode = mode;
  u.phase = "finished";
  u.completion = completion(u.matchId, st, false);
  service.observe(u);
  await service.settled();
  if (mode === "soccar")
    assert.equal(entry("WEEKLY", "mode-hopper").progress, 1);
}
assert.equal(entry("WEEKLY", "mode-hopper").progress, 3);
assert.equal(entry("WEEKLY", "mode-hopper").modes.length, 3);
assert.equal(entry("SEASON", "play-everything").progress, 5);
await claimAll(service);
assert.ok(entry("SEASON", "play-everything").rewardClaimed);
const beforeIdle = JSON.stringify(service.state),
  beforeXP = profile.value.progression.totalXP;
for (const mode of ["freeplay", "training", "rings", "dribble"]) {
  service.observe({ ...first, matchId: crypto.randomUUID(), mode });
  await service.settled();
}
for (const controller of ["spectator", "bot"]) {
  service.observe({ ...first, matchId: crypto.randomUUID(), controller });
  await service.settled();
}
service.observe({ ...first, playerId: "spectator-id" });
await service.settled();
assert.equal(JSON.stringify(service.state), beforeIdle);
assert.equal(profile.value.progression.totalXP, beforeXP);
// Separate player/profile only consumes its own authoritative record.
const second = new LocalProfile(storage()),
  secondId = second.value.localPlayerId,
  secondService = new Challenges(second, () => now);
const ownStats = stats(secondId),
  ownMatch = packet(ownStats);
ownMatch.phase = "finished";
ownMatch.completion = completion(ownMatch.matchId, ownStats, false);
secondService.observe(ownMatch);
await secondService.settled();
assert.equal(second.value.progression.totalXP, 0);
await claimAll(secondService);
assert.equal(second.value.progression.totalXP, 1000);
assert.equal(
  secondService.state.periods.DAILY.entries.winner?.progress ?? 0,
  0,
);
// Monday resets Weekly + the new Daily naturally, retaining the Season and stat high-water marks.
const seasonCount = entry("SEASON", "seasoned-driver").progress;
now = Date.parse("2026-10-19T00:00:00-04:00");
service.tick();
await service.settled();
assert.deepEqual(service.state.periods.DAILY.entries, {});
assert.deepEqual(service.state.periods.WEEKLY.entries, {});
assert.equal(entry("SEASON", "seasoned-driver").progress, seasonCount);
service.observe(first);
await service.settled();
assert.equal(
  entry("DAILY", "first-drive")?.progress ?? 0,
  0,
  "An old completed match cannot be counted again after reset",
);
const monday = packet(stats());
monday.phase = "finished";
monday.completion = completion(monday.matchId, monday.stats!);
service.observe(monday);
await service.settled();
assert.equal(entry("DAILY", "first-drive").progress, 1);
await claimAll(service);
assert.equal(entry("WEEKLY", "regular-driver").progress, 1);
assert.ok(
  profile.value.xpAwards[
    "CHALLENGE:" + challengeRewardId("DAILY", "2026-10-19", "first-drive")
  ],
);
now = Date.parse("2026-10-20T00:00:00-04:00");
service.tick();
await service.settled();
assert.deepEqual(service.state.periods.DAILY.entries, {});
assert.equal(entry("WEEKLY", "regular-driver").progress, 1);
const savedWeekly = entry("WEEKLY", "regular-driver").progress;
const stale = new LocalProfile(memory);
profile.customize("Updated Pilot");
stale.customize("Stale Pilot");
const afterStale = new LocalProfile(memory);
assert.equal(
  afterStale.value.challengeProgress.periods.WEEKLY.entries["regular-driver"]
    .progress,
  savedWeekly,
);
assert.equal(
  afterStale.value.progression.totalXP,
  profile.value.progression.totalXP,
);
// All supported types can be configured; no boost, aerial or demo counters are fabricated.
const custom: ChallengeDefinition[] = [
  {
    id: "assists",
    category: "DAILY",
    name: "Assist",
    description: "Assist",
    type: "GET_ASSISTS",
    target: 1,
    xpReward: 10,
  },
  {
    id: "saves",
    category: "DAILY",
    name: "Save",
    description: "Save",
    type: "GET_SAVES",
    target: 1,
    xpReward: 10,
  },
  {
    id: "shots",
    category: "DAILY",
    name: "Shot",
    description: "Shot",
    type: "TAKE_SHOTS",
    target: 1,
    xpReward: 10,
  },
  {
    id: "mode",
    category: "DAILY",
    name: "Hoops",
    description: "Hoops",
    type: "PLAY_SPECIFIC_MODE",
    target: 1,
    xpReward: 10,
    filters: { modes: ["hoops"] },
  },
  {
    id: "winmode",
    category: "DAILY",
    name: "Win",
    description: "Win",
    type: "WIN_SPECIFIC_MODE",
    target: 1,
    xpReward: 10,
    filters: { modes: ["hoops"] },
  },
  {
    id: "score",
    category: "DAILY",
    name: "Score",
    description: "Score",
    type: "EARN_MATCH_SCORE",
    target: 110,
    xpReward: 10,
  },
];
const customState = blankChallengeSave(),
  cs = stats();
applyStatAward(cs, "ASSIST");
applyStatAward(cs, "SAVE");
applyStatAward(cs, "SHOT");
const cu = packet(cs);
cu.gameMode = "hoops";
cu.phase = "finished";
cu.completion = completion(cu.matchId, cs);
applyChallengeUpdate(customState, cu, start, custom);
assert.ok(
  custom.every((d) => customState.periods.DAILY.entries[d.id].completed),
);
const filtered = blankChallengeSave();
applyChallengeUpdate(filtered, { ...cu, gameMode: "soccar" }, start, custom);
assert.equal(filtered.periods.DAILY.entries.mode, undefined);
// Recover an explicitly requested claim interrupted before XP commit, exactly once.
const crashStore = storage(),
  crash = new LocalProfile(crashStore),
  crashStats = stats(crash.value.localPlayerId),
  crashPacket = packet(crashStats);
crashPacket.phase = "finished";
crashPacket.completion = completion(crashPacket.matchId, crashStats, false);
applyChallengeUpdate(crash.value.challengeProgress, crashPacket, start);
for (const reward of Object.values(crash.value.challengeProgress.pending))
  reward.claimRequested = true;
crash.save();
const recover = new LocalProfile(crashStore),
  recoverService = new Challenges(recover, () => start);
await recoverService.settled();
assert.equal(recover.value.progression.totalXP, 1000);
assert.ok(
  recoverService.state.periods.DAILY.entries["first-drive"].rewardClaimed,
);
const recoveryAgain = new Challenges(new LocalProfile(crashStore), () => start);
await recoveryAgain.settled();
assert.equal(recoveryAgain.profile.value.progression.totalXP, 1000);
// Crash after XP commit but before claimed flag: receipt reconciliation must not re-award.
const receiptStore = storage(),
  receiptProfile = new LocalProfile(receiptStore),
  rs = stats(receiptProfile.value.localPlayerId),
  rp = packet(rs);
rp.phase = "finished";
rp.completion = completion(rp.matchId, rs, false);
applyChallengeUpdate(receiptProfile.value.challengeProgress, rp, start);
receiptProfile.save();
const rid = Object.keys(receiptProfile.value.challengeProgress.pending)[0];
await receiptProfile.awardXP(1000, { type: "CHALLENGE", id: rid });
const receiptRecovery = new Challenges(
  new LocalProfile(receiptStore),
  () => start,
);
await receiptRecovery.settled();
assert.equal(receiptRecovery.profile.value.progression.totalXP, 1000);
assert.equal(Object.keys(receiptRecovery.state.pending).length, 0);
// Pending rewards survive a category reset without completing the new day's card.
const boundaryStorage = storage(),
  boundaryProfile = new LocalProfile(boundaryStorage),
  bs = stats(boundaryProfile.value.localPlayerId),
  bp = packet(bs);
bp.phase = "finished";
bp.completion = completion(bp.matchId, bs, false);
applyChallengeUpdate(boundaryProfile.value.challengeProgress, bp, start);
for (const reward of Object.values(
  boundaryProfile.value.challengeProgress.pending,
))
  reward.claimRequested = true;
boundaryProfile.save();
const boundaryRecovery = new Challenges(new LocalProfile(boundaryStorage), () =>
  Date.parse("2026-10-19T00:00:00-04:00"),
);
await boundaryRecovery.settled();
assert.equal(boundaryRecovery.profile.value.progression.totalXP, 1000);
assert.deepEqual(boundaryRecovery.state.periods.DAILY.entries, {});
assert.equal(Object.keys(boundaryRecovery.state.pending).length, 0);
// Unrequested rewards expire with their set rather than being silently granted.
const expiredStore = storage(),
  expiredProfile = new LocalProfile(expiredStore);
const exStats = stats(expiredProfile.value.localPlayerId),
  exPacket = packet(exStats);
exPacket.phase = "finished";
exPacket.completion = completion(exPacket.matchId, exStats, false);
applyChallengeUpdate(expiredProfile.value.challengeProgress, exPacket, start);
expiredProfile.save();
const expiredService = new Challenges(new LocalProfile(expiredStore), () =>
  Date.parse("2026-10-19T00:00:00-04:00"),
);
await expiredService.settled();
assert.equal(expiredService.profile.value.progression.totalXP, 0);
assert.equal(Object.keys(expiredService.state.pending).length, 0);
assert.equal(await expiredService.claim("DAILY", "first-drive"), null);
assert.equal(service.error, "");
assert.equal(recoverService.error, "");
// Season end freezes its progress and keeps completed cards; no implicit Season 2.
const beforeSeason = JSON.stringify(service.state.periods.SEASON);
now = SEASON_CONFIG.endsAt;
service.tick();
await service.settled();
const ended = packet({ ...stats(), goals: 20, score: 2000 });
ended.phase = "finished";
ended.completion = completion(ended.matchId, ended.stats!);
service.observe(ended);
await service.settled();
assert.equal(JSON.stringify(service.state.periods.SEASON), beforeSeason);
assert.equal(service.state.periods.SEASON.key, "season-1");
const preserved = JSON.stringify(profile.value.challengeProgress);
profile.reset();
assert.equal(
  JSON.stringify(profile.value.challengeProgress),
  preserved,
  "Profile identity/stat reset retains earned challenge progress and XP guards",
);
assert.equal(
  JSON.parse(memory.getItem(localProfileKey)!).challengeProgress.version,
  1,
);
console.log(
  "PASS Challenges: 3/6/6 editable definitions, New York Monday/midnight/DST/calendar-month boundaries, live stat deltas and gap recovery, replay/resync/idempotence, completion-only matches/wins/mode sets, exclusions, independent profiles, XP level-ups, refresh/crash recovery, stale saves, daily/weekly resets and Season 1 end",
);
