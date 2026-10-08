import assert from "node:assert/strict";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { predictGoal, type BallSample } from "../src/game/ball-prediction";
import { MatchStats } from "../src/game/match-stats";
import { Match } from "../src/game/match";
import { neutralInput } from "../shared/player";
import { MatchChat, CHAT } from "../shared/chat";
import { HEATSEEKER as H } from "../src/config/heatseeker";
import { Heatseeker } from "../src/game/heatseeker";
import { P } from "../src/config/physics";
import { LocalProfile } from "../src/game/local-profile";
import { scoreboardOrder } from "../shared/match-stats";
await initializeSimulation();
const n = neutralInput(),
  s = new Simulation();
const ball = (x = 0, y = 2, z = -35, vx = 0, vy = 0, vz = -25): BallSample => ({
  position: { x, y, z },
  velocity: { x: vx, y: vy, z: vz },
  heat: null,
});
try {
  const p = predictGoal(ball(), s.world);
  console.log("Prediction", p);
  assert.equal(p?.team, 1, "Actual mouth-directed trajectory should score");
  assert.equal(
    predictGoal(ball(18), s.world),
    null,
    "Corner pass is not a shot",
  );
  assert.equal(
    predictGoal(ball(0, 11, -45, 0, 5, -30), s.world),
    null,
    "Above crossbar is not a shot",
  );
  assert.equal(
    predictGoal(ball(P.arena.goalHalf - 0.1, 2, -48), s.world),
    null,
    "Radius/post edge must miss",
  );
  assert.equal(
    predictGoal(ball(0, 2, -51.3), s.world)?.team,
    1,
    "Full-sphere goal-line threat remains detectable",
  );
  const pose = { ...s.ball.translation() },
    vel = { ...s.ball.linvel() };
  predictGoal(ball(), s.world);
  assert.deepEqual({ ...s.ball.translation() }, pose);
  assert.deepEqual({ ...s.ball.linvel() }, vel);
  const heat = new Heatseeker();
  heat.touch("a", 0, 0);
  const curved = { ...ball(0, 5, -35, 20, 0, 0), heat: { ...heat.state } };
  assert.equal(
    predictGoal(curved, s.world)?.team,
    1,
    "Heatseeker curves toward goal rather than a straight tangent",
  );
  assert.equal(heat.state.speed, H.initialSpeed);
  assert.equal(heat.state.tier, 1);
  const heatBefore = JSON.stringify(heat.state);
  predictGoal(
    { ...ball(18, 10, -50, 0, 0, -40), heat: { ...heat.state } },
    s.world,
  );
  assert.equal(
    JSON.stringify(heat.state),
    heatBefore,
    "Heatseeker prediction never changes real ownership/tier",
  );
  const roster = [
    { id: "a", name: "Same", team: 0 as const, controller: "remote" as const },
    { id: "b", name: "Same", team: 0 as const, controller: "remote" as const },
    {
      id: "c",
      name: "Defender",
      team: 1 as const,
      controller: "remote" as const,
    },
  ];
  const stats = new MatchStats(roster);
  const longHeat = new MatchStats(roster);
  longHeat.touch(
    {
      playerId: "a",
      before: ball(10, 0.97, 20, 0, 0, 0),
      after: { ...ball(10, 1.2, 20, 5, 0, -14), heat: { ...heat.state } },
    },
    { world: s.world, clock: 10 },
  );
  assert.equal(
    longHeat.players.get("a")!.shots,
    1,
    "Initial full-field Heatseeker serves qualify within the mode-aware horizon",
  );
  const touch = (
    id: string,
    before: BallSample,
    after: BallSample,
    time: number,
  ) =>
    stats.touch(
      { playerId: id, before, after },
      { world: s.world, clock: time },
    );
  touch("a", ball(0, 2, 0, 0, 0, 0), ball(), 1);
  assert.equal(stats.players.get("a")!.score, 12);
  assert.equal(stats.players.get("a")!.shots, 1);
  touch("c", ball(0, 2, -46, 0, 0, -25), ball(0, 2, -46, 0, 0, 10), 2);
  assert.equal(stats.players.get("c")!.saves, 1);
  assert.equal(stats.players.get("c")!.score, 52);
  touch("c", ball(0, 2, -50, 0, 0, -25), ball(0, 2, -54, 0, 0, -25), 2.1);
  assert.equal(
    stats.players.get("c")!.saves,
    1,
    "A touch that finishes an own goal is never a save",
  );
  assert.equal(
    stats.players.get("c")!.shots,
    0,
    "Own-goal touch cannot receive an attacking shot",
  );
  touch("c", ball(18, 2, -46), ball(0, 2, -46, 0, 0, 10), 2.3);
  assert.equal(
    stats.players.get("c")!.saves,
    1,
    "Already missing goal cannot be saved",
  );
  touch("b", ball(0, 2, 0, 0, 0, 0), ball(), 3);
  stats.goal({ id: "goal-1", scorerId: "b", team: 0, ownGoal: false }, 4);
  assert.equal(stats.players.get("b")!.goals, 1);
  assert.equal(stats.players.get("b")!.score, 112);
  assert.equal(stats.players.get("a")!.assists, 1);
  assert.equal(stats.players.get("a")!.score, 62);
  stats.goal({ id: "goal-1", scorerId: "b", team: 0, ownGoal: false }, 4);
  assert.equal(stats.players.get("b")!.score, 112);
  assert.equal(stats.players.get("b")!.assists, 0);
  assert.deepEqual(
    scoreboardOrder(roster, stats.snapshot(), 0).map((p) => p.id),
    ["b", "a"],
  );
  stats.setPing("a", 999);
  assert.deepEqual(
    scoreboardOrder(roster, stats.snapshot(), 0).map((p) => p.id),
    ["b", "a"],
  );
  assert.deepEqual(
    scoreboardOrder(roster, [], 0).map((p) => p.id),
    ["a", "b"],
    "Equal scores preserve roster order despite identical names",
  );
  stats.kickoff();
  assert.equal(stats.players.get("a")!.score, 62);
  stats.goal({ id: "own", scorerId: "c", team: 0, ownGoal: true }, 5);
  assert.equal(stats.players.get("c")!.goals, 0);
  const expired = new MatchStats(roster);
  expired.touch(
    { playerId: "a", before: ball(), after: ball() },
    { world: s.world, clock: 1 },
  );
  expired.touch(
    { playerId: "b", before: ball(), after: ball() },
    { world: s.world, clock: 7 },
  );
  expired.goal({ id: "expired", scorerId: "b", team: 0, ownGoal: false }, 8);
  assert.equal(expired.players.get("a")!.assists, 0);
  s.cars[1].collider.setCollisionGroups(0);
  s.cars[0].reset(0, 0, 0);
  s.ball.setTranslation({ x: 0, y: 1.49, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  const match = new Match();
  match.start(s, "bot");
  s.cars[1].collider.setCollisionGroups(0);
  s.cars[0].reset(0, 0, 0);
  s.ball.setTranslation({ x: 0, y: 1.49, z: 0 }, true);
  match.phase = "playing";
  let contacts = 0;
  for (let i = 0; i < 180; i++) {
    s.step([n, n]);
    contacts += s.statTouches.length;
    match.tick(s);
  }
  assert.equal(contacts, 1, "Continuous roof contact must be one touch");
  assert.equal(match.stats!.players.get("player")!.touches, 1);
  const total = match.stats!.players.get("player")!.score;
  match.kickoff(s);
  assert.equal(match.stats!.players.get("player")!.score, total);
  match.start(s, "bot");
  assert.equal(
    match.stats!.players.get("player")!.score,
    0,
    "New match resets stats",
  );
} finally {
  s.dispose();
}
const chat = new MatchChat();
assert.ok(chat.accept("a", "  Nice shot!  ", 0).message);
assert.equal(chat.messages[0].text, "Nice shot!");
assert.ok(chat.accept("a", "spam", 1).error);
assert.ok(chat.accept("a", "<img src=x onerror=alert(1)>", 1000).message);
assert.equal(chat.accept("a", " ", 2000).message, undefined);
assert.ok(chat.accept("a", "x".repeat(CHAT.maxLength + 1), 2000).error);
const data = new Map<string, string>(),
  storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
const profile = new LocalProfile(storage),
  totals = {
    playerId: "a",
    score: 212,
    goals: 2,
    assists: 1,
    saves: 3,
    shots: 4,
    touches: 6,
    ping: null,
  };
profile.observeMatch("match", "a", 0, "finished", [2, 1], null, totals);
profile.observeMatch("match", "a", 0, "finished", [2, 1], null, totals);
assert.equal(profile.value.stats.goals, 2);
assert.equal(profile.value.stats.assists, 1);
assert.equal(profile.value.stats.saves, 3);
assert.equal(profile.value.stats.shots, 4);
assert.equal(profile.value.stats.matchesPlayed, 1);
assert.equal(new LocalProfile(storage).value.stats.saves, 3);
console.log(
  "PASS sphere/arena prediction, Heatseeker curves, touch/shot/save/goal/assist scoring, continuous-contact dedup, own goals, resets, chat validation/rate limit and completion-only career dedup",
);
