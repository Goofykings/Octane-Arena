import assert from "node:assert/strict";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { MatchStats } from "../src/game/match-stats";
import { predictGoal, type BallSample } from "../src/game/ball-prediction";
import { NetworkMatch } from "../src/game/authoritative-match";
import { starter } from "../shared/catalog";
import { peerSnapshot } from "../shared/rtc";
await initializeSimulation();
const roster = [
  {
    id: crypto.randomUUID(),
    name: "Same",
    team: 0 as const,
    controller: "remote" as const,
  },
  {
    id: crypto.randomUUID(),
    name: "Same",
    team: 0 as const,
    controller: "remote" as const,
  },
  {
    id: crypto.randomUUID(),
    name: "Same",
    team: 1 as const,
    controller: "remote" as const,
  },
];
const [a, b, c] = roster.map((p) => p.id),
  s = new Simulation(false, roster);
const ball = (x = 0, y = 2, z = -35, vz = -25, vx = 0): BallSample => ({
  position: { x, y, z },
  velocity: { x: vx, y: 0, z: vz },
  heat: null,
});
const still = () => ball(0, 2, 0, 0),
  shot = () => ball(),
  miss = () => ball(18);
const touch = (
  st: MatchStats,
  id: string,
  before: BallSample,
  after: BallSample,
  time: number,
) => st.touch({ playerId: id, before, after }, { world: s.world, clock: time });
try {
  const st = new MatchStats(roster);
  touch(st, a, still(), shot(), 1);
  assert.equal(st.players.get(a)!.shots, 1);
  assert.equal(st.activeShot!.creditedPlayerId, a);
  for (let i = 1; i <= 5; i++)
    touch(st, a, shot(), ball(0, 2, -35, -25 - 0.02 * i), 1 + i * 0.05);
  assert.equal(st.players.get(a)!.shots, 1);
  assert.equal(st.players.get(a)!.touches, 6);
  assert.equal(st.players.get(a)!.score, 22);
  touch(st, b, shot(), ball(0, 2, -35, -25, 0.01), 1.4);
  assert.equal(st.players.get(b)!.shots, 0);
  assert.equal(st.players.get(b)!.touches, 1);
  assert.equal(st.activeShot!.creditedPlayerId, a);
  assert.equal(st.events.filter((e) => e.type === "SHOT").length, 1);
  touch(st, c, shot(), ball(0, 2, -35, -24.98), 1.5);
  assert.equal(st.players.get(c)!.saves, 0);
  assert.equal(
    st.activeShot!.creditedPlayerId,
    a,
    "Failed save does not restart the threat",
  );
  touch(st, a, shot(), shot(), 60);
  assert.equal(st.players.get(a)!.shots, 1, "No timer-only shot cooldown");
  touch(st, c, ball(0, 2, -46, -25), ball(0, 2, -46, 10), 61);
  assert.equal(st.activeShot, null);
  assert.equal(st.players.get(c)!.saves, 1);
  assert.equal(st.players.get(c)!.score, 54);
  touch(st, a, still(), shot(), 62);
  assert.equal(st.players.get(a)!.shots, 2);
  assert.equal(st.activeShot!.startTime, 62);
  st.goal({ id: "goal", scorerId: b, team: 0, ownGoal: false }, 63);
  assert.equal(st.activeShot, null);
  assert.equal(st.players.get(b)!.goals, 1);
  const score = st.players.get(b)!.score;
  st.goal({ id: "goal", scorerId: b, team: 0, ownGoal: false }, 63);
  assert.equal(st.players.get(b)!.score, score);
  touch(st, a, still(), shot(), 64);
  st.kickoff();
  assert.equal(st.activeShot, null);
  assert.equal(st.players.get(a)!.shots, 3);
  const redirect = new MatchStats(roster);
  touch(redirect, a, still(), miss(), 1);
  assert.equal(redirect.players.get(a)!.shots, 0);
  touch(redirect, a, miss(), shot(), 2);
  assert.equal(redirect.players.get(a)!.shots, 1);
  assert.equal(redirect.players.get(a)!.score, 14);
  const wide = new MatchStats(roster);
  for (const after of [miss(), ball(0, 11, -45, -30)])
    touch(wide, a, still(), after, 1);
  assert.equal(wide.players.get(a)!.shots, 0);
  assert.equal(wide.players.get(a)!.touches, 2);
  const simultaneous = new MatchStats(roster);
  touch(simultaneous, a, still(), shot(), 1);
  touch(simultaneous, b, still(), shot(), 1);
  assert.equal(simultaneous.players.get(a)!.shots, 1);
  assert.equal(simultaneous.players.get(b)!.shots, 0);
  assert.equal(simultaneous.players.get(b)!.touches, 1);
  const loss = new MatchStats(roster);
  touch(loss, a, still(), shot(), 1);
  s.ball.setTranslation(miss().position, true);
  s.ball.setLinvel(miss().velocity, true);
  s.statTouches.length = 0;
  for (const clock of [1.12, 1.24]) {
    s.clock = clock;
    loss.observe(s);
  }
  assert.ok(loss.activeShot, "Brief predictor loss has a small grace");
  s.clock = 1.36;
  loss.observe(s);
  assert.equal(
    loss.activeShot,
    null,
    "Untouched surface/miss trajectory ends the threat",
  );
  touch(loss, a, miss(), shot(), 1.5);
  assert.equal(loss.players.get(a)!.shots, 2);
  const counter = new MatchStats(roster);
  touch(counter, a, still(), shot(), 1);
  const clear = ball(0, 1, -46, 55);
  assert.equal(predictGoal(clear, s.world)?.team, 0);
  touch(counter, c, ball(0, 1, -46, -25), clear, 2);
  assert.equal(counter.activeShot!.attackingTeam, 1);
  assert.equal(counter.activeShot!.targetGoal, 0);
  assert.equal(counter.players.get(c)!.saves, 1);
  assert.equal(counter.players.get(c)!.shots, 1);
  // The exact same authority feeds LAN and PeerJS snapshots; clients receive totals/events, not a second detector.
  const game = new NetworkMatch(
    roster.map((p) => ({ ...p, preset: starter() })),
    "city",
  );
  try {
    const stats = game.match.stats!;
    stats.touch(
      { playerId: a, before: still(), after: shot() },
      game.simulation,
    );
    for (let i = 0; i < 5; i++)
      stats.touch(
        { playerId: a, before: shot(), after: shot() },
        game.simulation,
      );
    const snap = game.snapshot();
    assert.equal(snap.stats!.find((p) => p.playerId === a)!.shots, 1);
    assert.equal(snap.stats!.find((p) => p.playerId === a)!.touches, 6);
    assert.equal(snap.stats!.find((p) => p.playerId === a)!.score, 22);
    assert.equal(snap.statEvents!.filter((e) => e.type === "SHOT").length, 1);
    assert.ok(
      peerSnapshot(
        snap,
        game.id,
        roster.map((p) => p.id),
      ),
    );
  } finally {
    game.dispose();
  }
} finally {
  s.dispose();
}
console.log(
  "PASS continuous shot A-G: five tiny touches, teammate/failing defender credit, genuine save/new attack, redirect/misses, shared-tick contacts, surface threat loss, goal/kickoff and authoritative synchronized totals with separate touch points",
);
