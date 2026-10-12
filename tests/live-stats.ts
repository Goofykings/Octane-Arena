import { captureGoalReplay } from "./replay-capture";
import assert from "node:assert/strict";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import {
  applyStatAward,
  type PlayerMatchStats,
  type StatKind,
} from "../shared/match-stats";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const stat: PlayerMatchStats = {
  playerId: "uuid-human",
  score: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  shots: 0,
  touches: 0,
  ping: null,
};
for (const [kind, score, field] of [
  ["BALL_TOUCH", 2, "touches"],
  ["SHOT", 12, "shots"],
  ["SAVE", 62, "saves"],
  ["ASSIST", 112, "assists"],
  ["GOAL", 212, "goals"],
] as const) {
  applyStatAward(stat, kind as StatKind);
  assert.equal(stat.score, score);
  assert.equal(stat[field], 1);
}
assert.deepEqual(stat, {
  playerId: "uuid-human",
  score: 212,
  goals: 1,
  assists: 1,
  saves: 1,
  shots: 1,
  touches: 1,
  ping: null,
});
const n = neutralInput(),
  id = "560f0580-d6e3-4dde-9f40-115c01586aa4";
function setup() {
  const s = new Simulation(false, [
    { id, name: "Same Name", team: 0, controller: "local" },
    { id: "teammate-id", name: "Same Name", team: 0, controller: "remote" },
    { id: "opponent-id", name: "Rival", team: 1, controller: "remote" },
  ]);
  const match = new Match();
  match.start(s, "network");
  match.phase = "playing";
  s.cars[1].reset(25, 20, 0);
  s.cars[2].reset(-25, 20, 0);
  return { s, match };
}
function frame(s: Simulation, m: Match, throttle = 0) {
  s.step([{ ...n, throttle }, n, n]);
  m.tick(s);
}
{
  const { s, match: m } = setup();
  try {
    s.cars[0].reset(0, -32, 0);
    s.cars[0].body.setLinvel({ x: 0, y: 0, z: -10 }, true);
    s.ball.setTranslation({ x: 0, y: P.ball.radius + 0.025, z: -35 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.ballPose.snap();
    for (let i = 0; i < 900 && m.phase === "playing"; i++) frame(s, m, 0.4);
    const stats = m.stats!.players.get(id)!;
    assert.equal(m.score[0], 1);
    assert.equal(stats.goals, 1);
    assert.ok(stats.touches >= 1 && stats.shots >= 1);
    assert.equal(m.stats!.events.filter((e) => e.type === "GOAL").length, 1);
    assert.equal(
      stats.score,
      stats.touches * 2 + stats.shots * 10 + 100,
      "Actual touch/shot/goal awards are accumulated by stable ID",
    );
    const total = JSON.stringify(m.stats!.snapshot());
    captureGoalReplay(m, s);
    m.phase = "replay";
    for (let i = 0; i < 30; i++) m.tick(s);
    assert.equal(
      JSON.stringify(m.stats!.snapshot()),
      total,
      "Replay doesn't award again",
    );
    m.kickoff(s);
    assert.equal(
      JSON.stringify(m.stats!.snapshot()),
      total,
      "Kickoff retains match totals",
    );
    m.start(s, "network");
    assert.ok(
      m
        .stats!.snapshot()
        .every((p) => p.score === 0 && p.goals === 0 && p.touches === 0),
      "New match resets totals",
    );
  } finally {
    s.dispose();
  }
}
{
  const { s, match: m } = setup();
  try {
    s.cars[0].reset(0, 45, 0);
    s.cars[0].body.setLinvel({ x: 0, y: 0, z: -8 }, true);
    s.ball.setTranslation({ x: 0, y: P.ball.radius + 0.025, z: 42 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 15 }, true);
    s.ballPose.snap();
    for (let i = 0; i < 180 && !m.stats!.players.get(id)!.saves; i++)
      frame(s, m, 0.4);
    const stats = m.stats!.players.get(id)!;
    assert.equal(stats.saves, 1);
    assert.equal(m.stats!.events.filter((e) => e.type === "SAVE").length, 1);
    assert.equal(
      stats.score,
      stats.touches * 2 + stats.shots * 10 + 50,
      "Actual save adds exactly 50",
    );
    assert.equal(m.score[1], 0);
    const clock = s.clock;
    m.stats!.observe(s);
    m.stats!.observe(s);
    assert.equal(s.clock, clock);
    assert.equal(
      stats.saves,
      1,
      "Repeated observation of same physics tick doesn't award twice",
    );
  } finally {
    s.dispose();
  }
}
{
  const { s, match: m } = setup();
  try {
    s.cars[0].reset(0, -15, 0);
    s.cars[0].body.setLinvel({ x: 0, y: 0, z: -8 }, true);
    s.ball.setTranslation({ x: 0, y: P.ball.radius + 0.025, z: -18 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.ballPose.snap();
    for (let i = 0; i < 180 && !m.stats!.players.get(id)!.touches; i++)
      frame(s, m, 0.3);
    assert.ok(m.stats!.players.get(id)!.touches > 0);
    const before = m.stats!.players.get(id)!.score;
    const b = s.ball.translation();
    s.cars[0].reset(25, 15, 0);
    // An airborne receiving-car fixture intercepts the physically lifted pass.
    s.cars[1].reset(b.x, b.z + 1.65, 0, b.y);
    s.cars[1].body.setLinvel({ x: 0, y: 0, z: -16 }, true);
    for (let i = 0; i < 1000 && m.phase === "playing"; i++) {
      s.step([n, { ...n, throttle: 0.7 }, n]);
      m.tick(s);
    }
    assert.equal(m.score[0], 1);
    assert.equal(m.lastGoal?.scorerId, "teammate-id");
    const assister = m.stats!.players.get(id)!;
    assert.equal(assister.assists, 1);
    assert.equal(assister.score, before + 50);
    assert.equal(m.stats!.players.get("teammate-id")!.goals, 1);
    const eventCount = m.stats!.events.length;
    captureGoalReplay(m, s);
    m.stats!.goal(m.replay!.clip.goal, s.clock);
    assert.equal(
      m.stats!.events.length,
      eventCount,
      "Duplicate goal also cannot repeat assist",
    );
  } finally {
    s.dispose();
  }
}
console.log(
  "PASS exact 0→2→12→62→112→212 awards; real physical touch/shot/save/goal/assist with UUIDs and duplicate names; replay/kickoff preservation, observation dedup and new-match reset",
);
