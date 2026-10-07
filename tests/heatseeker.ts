import assert from "node:assert/strict";
import { Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { Heatseeker, isBackboard } from "../src/game/heatseeker";
import { HEATSEEKER as H } from "../src/config/heatseeker";
import { P, UU } from "../src/config/physics";
import { neutralInput } from "../shared/player";
import { NetworkMatch } from "../src/game/authoritative-match";
import { starter } from "../shared/catalog";
import { peerSnapshot } from "../shared/rtc";
await initializeSimulation();
const n = neutralInput();
assert.equal(H.initialSpeed / UU, 70 / 3.6 / UU);
assert.equal(H.maxSpeed, P.ball.maxSpeed);
const h = new Heatseeker();
assert.equal(h.state.active, false);
assert.ok(h.touch("blue", 0, 1));
assert.equal(h.state.targetTeam, 1);
assert.equal(h.state.ownerTeam, 0);
assert.equal(h.state.speed, H.initialSpeed);
assert.equal(h.touch("blue", 0, 1.01), false);
assert.ok(h.touch("blue", 0, 2));
assert.equal(h.state.speed, H.initialSpeed + H.speedIncrement);
assert.ok(h.touch("orange", 1, 3));
assert.equal(h.state.targetTeam, 0);
assert.equal(h.backboard(1), false);
assert.ok(h.backboard(0));
assert.equal(h.state.targetTeam, 1);
for (let i = 0; i < 100; i++) h.touch("blue", 0, i + 5);
assert.equal(h.state.speed, H.maxSpeed);
h.reset(1);
assert.equal(h.state.active, false);
assert.equal(h.state.tier, 0);
assert.equal(
  isBackboard({ x: 0, y: 10, z: -P.arena.halfLength }, { x: 0, y: 0, z: 1 }, 1),
  true,
);
assert.equal(
  isBackboard({ x: P.arena.halfWidth, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, 1),
  false,
);
assert.equal(
  isBackboard({ x: 0, y: 0, z: -P.arena.halfLength }, { x: 0, y: 1, z: 0 }, 1),
  false,
);
assert.equal(
  isBackboard({ x: 0, y: 10, z: -P.arena.halfLength }, { x: 0, y: 0, z: 1 }, 0),
  false,
);
const s = new Simulation(),
  m = new Match();
m.gameMode = "heatseeker";
try {
  const random = Math.random;
  try {
    for (const value of [0.1, 0.9]) {
      Math.random = () => value;
      m.start(s, "network");
      assert.equal(m.phase, "countdown");
      assert.equal(m.countdown, 3);
      const receiver = value < 0.5 ? 0 : 1;
      assert.equal(s.heatseeker!.state.kickoffTeam, receiver);
      assert.equal(
        s.ball.translation().z,
        (receiver === 0 ? 1 : -1) * H.kickoffBallDistance,
      );
      assert.equal(s.heatseeker!.state.active, false);
      assert.equal(s.ball.linvel().z, 0);
      assert.ok(
        s.cars.every(
          (c) => Math.abs(c.body.translation().z) === H.kickoffCarDistance,
        ),
      );
    }
  } finally {
    Math.random = random;
  }
  s.cars.forEach((c) => c.collider.setCollisionGroups(0));
  s.ball.setTranslation({ x: 0, y: 8, z: 0 }, true);
  s.ball.setLinvel({ x: 12, y: 0, z: 0 }, true);
  s.ball.setAngvel({ x: 2, y: 3, z: 4 }, true);
  s.heatseeker!.touch("blue", 0, s.clock);
  const before = new Vector3().copy(s.ball.linvel());
  s.step([n, n]);
  assert.ok(
    new Vector3().copy(s.ball.linvel()).angleTo(before) <
      H.maxTurnRate * P.dt + 0.02,
    "No one-frame direction snap",
  );
  assert.ok(s.ball.linvel().x > 10, "Real hit momentum remains");
  assert.ok(s.ball.angvel().y > 2.9, "Spin survives homing");
  for (let i = 0; i < 120; i++) s.step([n, n]);
  assert.ok(new Vector3().copy(s.ball.linvel()).length() > H.initialSpeed - 1);
  // Actual relevant mesh contact, not a height/position-only reversal.
  s.ball.setTranslation(
    { x: 0, y: 10, z: -P.arena.halfLength + P.ball.radius + 0.2 },
    true,
  );
  s.ball.setLinvel({ x: 0, y: 0, z: -35 }, true);
  s.heatseeker!.reset(0);
  s.heatseeker!.touch("blue", 0, s.clock);
  for (let i = 0; i < 40 && s.heatseeker!.state.backboardSequence === 0; i++)
    s.step([n, n]);
  assert.equal(
    s.heatseeker!.state.backboardSequence,
    1,
    "Defending backboard contact must reverse",
  );
  assert.equal(s.heatseeker!.state.targetTeam, 0);
  assert.equal(s.heatseeker!.state.ownerTeam, 1);
  assert.equal(s.heatseeker!.state.speed, H.initialSpeed + H.speedIncrement);
  for (const pose of [
    {
      x: P.arena.halfWidth - P.ball.radius - 0.1,
      y: 8,
      z: 0,
      v: { x: 35, y: 0, z: 0 },
    },
    { x: 0, y: P.ball.radius + 0.1, z: 0, v: { x: 0, y: -15, z: 0 } },
    {
      x: 0,
      y: P.arena.height - P.ball.radius - 0.1,
      z: 0,
      v: { x: 0, y: 15, z: 0 },
    },
  ]) {
    s.heatseeker!.reset(0);
    s.heatseeker!.touch("blue", 0, s.clock);
    s.ball.setTranslation(pose, true);
    s.ball.setLinvel(pose.v, true);
    for (let i = 0; i < 20; i++) s.step([n, n]);
    assert.equal(s.heatseeker!.state.targetTeam, 1);
    assert.equal(s.heatseeker!.state.backboardSequence, 0);
    assert.ok(
      s.ball.translation().y >= P.ball.radius - 0.02 &&
        s.ball.translation().y < P.arena.height,
    );
  }
  // A real car collision starts homing; a persistent contact cannot spam tiers.
  m.start(s, "network");
  s.cars[1].collider.setCollisionGroups(0);
  s.cars[0].collider.setCollisionGroups(0xffffffff);
  s.cars[0].reset(0, 0, 0);
  s.ball.setTranslation({ x: 0, y: P.ball.radius + 0.02, z: -1.3 }, true);
  for (let i = 0; i < 120 && !s.heatseeker!.state.active; i++)
    s.step([{ ...n, throttle: 1 }, n]);
  assert.ok(s.heatseeker!.state.active);
  assert.equal(s.heatseeker!.state.lastTouchPlayerId, s.cars[0].id);
  assert.equal(s.heatseeker!.state.targetTeam, 1);
  const tier = s.heatseeker!.state.tier;
  for (let i = 0; i < 6; i++) s.step([n, n]);
  assert.equal(s.heatseeker!.state.tier, tier);
  m.phase = "playing";
  m.tick(s);
  s.ball.setTranslation({ x: 0, y: 2, z: -P.arena.halfLength - 2 }, true);
  m.tick(s);
  assert.deepEqual(m.score, [1, 0]);
  assert.equal(m.phase, "goal");
  assert.ok(m.replay?.clip.heatseeker?.length);
  m.tick(s);
  assert.deepEqual(m.score, [1, 0]);
  m.freeze = 0;
  m.tick(s);
  assert.equal(m.phase, "replay");
  assert.ok(m.skipReplay(s.cars[0].id, m.replay!.clip.goal.id, s));
  assert.equal(m.phase, "countdown");
  assert.equal(s.heatseeker!.state.active, false);
  assert.equal(s.heatseeker!.state.speed, H.initialSpeed);
  m.gameMode = "soccar";
  m.start(s, "network");
  assert.equal(s.heatseeker, null);
  assert.equal(s.ball.translation().z, 0);
  s.cars.forEach((c) => c.collider.setCollisionGroups(0));
  s.ball.setTranslation({ x: 0, y: 8, z: 0 }, true);
  s.ball.setLinvel({ x: 12, y: 0, z: 0 }, true);
  for (let i = 0; i < 20; i++) s.step([n, n]);
  assert.equal(s.ball.linvel().z, 0, "Soccar must never home");
} finally {
  s.dispose();
}
const players = [0, 1].map((team) => ({
  id: "id-" + team,
  name: "Guest",
  team: team as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
const game = new NetworkMatch(players, "beach", undefined, "heatseeker");
try {
  const snap = game.snapshot();
  assert.equal(snap.gameMode, "heatseeker");
  assert.equal(snap.heatseeker!.active, false);
  assert.ok(
    peerSnapshot(
      snap,
      game.id,
      players.map((p) => p.id),
    ),
  );
  game.simulation.heatseeker!.touch(players[1].id, 1, 1);
  assert.equal(game.snapshot().heatseeker!.lastTouchPlayerId, players[1].id);
  assert.equal(game.snapshot().heatseeker!.targetTeam, 0);
} finally {
  game.dispose();
}
console.log(
  "PASS Heatseeker neutral kickoffs, physical touches, bounded steering, preserved momentum/spin, actual backboard-only reversal, floor/ceiling/side collision, cap, scoring/replay/reset, Soccar isolation and shared authority snapshots",
);
