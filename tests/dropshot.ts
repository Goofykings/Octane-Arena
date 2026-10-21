import { DROPSHOT_BALL_GROUP } from "../src/physics/collision-groups";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  DROPSHOT_CONFIG as D,
  dropshotTiles as tiles,
  tileAt,
  DropshotView,
  floorEntry,
  openFloor,
  dropshotSpawn,
} from "../shared/dropshot";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { Pads } from "../src/game/pads";
import { P } from "../src/config/physics";
import { neutralInput } from "../shared/player";
import { DEFAULT_MUTATORS } from "../shared/mutators";
import { predictGoal } from "../src/game/ball-prediction";
import { NetworkMatch } from "../src/game/authoritative-match";
import { starter } from "../shared/catalog";
import { peerSnapshot } from "../shared/rtc";
import { chooseMatchArena } from "../shared/arenas";
import { BotTeam } from "../src/ai/team";
import { ReplayClock, decodeReplay, replayMessage } from "../shared/replay";
await initializeSimulation();
const n = neutralInput();
assert.equal(tiles.length, 140);
assert.equal(tiles.filter((t) => t.team === 0).length, 70);
for (const team of [0, 1])
  assert.deepEqual(
    Array.from(
      { length: 7 },
      (_, r) => tiles.filter((t) => t.team === team && t.row === r).length,
    ),
    [13, 12, 11, 10, 9, 8, 7],
  );
for (const t of tiles) {
  assert.equal(tileAt(t.x, t.z)?.id, t.id);
  for (const id of t.neighbors) assert.ok(tiles[id].neighbors.includes(t.id));
}
const center = tiles.find(
  (t) => t.team === 1 && t.row === 3 && Math.abs(t.x) < 4,
)!;
assert.deepEqual(
  center.clusters.map((c) => c.length),
  [1, 7, 19],
);
const s = new Simulation(),
  m = new Match();
m.gameMode = "dropshot";
m.start(s, "bot");
const ds = s.dropshot!;
assert.equal(s.cars[0].boost, 100);
assert.equal(new Pads("dropshot").items.length, 0);
assert.equal(s.rumble, null);
for (let i = 0; i < 360; i++) m.tick(s);
assert.equal(m.phase, "playing");
assert.equal(s.ball.linvel().y, 10);
s.cars.forEach((c) => c.body.setEnabled(false));
// Every tile, neutral divider and the perimeter filler have real floor contact.
s.world.step();
for (const t of tiles) {
  const hit = s.world.castRay(
    new RAPIER.Ray({ x: t.x, y: 3, z: t.z }, { x: 0, y: -1, z: 0 }),
    5,
    true,
  );
  assert.ok(
    hit && Math.abs(hit.timeOfImpact - 3) < 0.001,
    "Solid tile top " + t.id,
  );
}
for (const p of [
  { x: 0, z: 0 },
  { x: 45, z: 0 },
  { x: 0, z: 42 },
])
  assert.ok(
    s.world.castRay(
      new RAPIER.Ray({ x: p.x, y: 2, z: p.z }, { x: 0, y: -1, z: 0 }),
      4,
      true,
    ),
    "Neutral/perimeter filler",
  );
// Energy cap, decay, weak contacts, and deterministic clusters.
assert.equal(ds.touch("player", 0, 4.9), 0);
assert.equal(ds.energy, 0);
for (const [level, hits] of [
  [0, 0],
  [1, 1],
  [2, 5],
]) {
  ds.reset();
  for (let i = 0; i < hits; i++) {
    ds.tick(1);
    ds.touch("player", 0, 30);
  }
  assert.equal(ds.chargeLevel, level);
  ds.touch("player", 0, 0);
  const e = ds.damage(center.id, 3, 2)!;
  assert.equal(e.changes.length, [1, 7, 19][level]);
  assert.equal(ds.chargeLevel, 0);
  assert.equal(ds.energy, 0);
}
ds.reset();
ds.touch("player", 0, 30);
for (let i = 0; i < 40; i++) ds.touch("player", 0, 30);
assert.equal(ds.energy, 2500);
ds.tick(0.5);
assert.equal(ds.touch("player", 0, 30), 1250);
ds.reset();
ds.touch("player", 0, 0);
assert.equal(ds.damage(tiles[0].id, 10, 0), null);
assert.equal(ds.damage(center.id, 2.49, 0), null);
assert.equal(ds.damage(center.id, 4, 0)?.changes.length, 1);
assert.equal(ds.states[center.id], 1);
assert.equal(ds.damage(center.id, 4, 0.1), null);
assert.equal(ds.damage(center.id, 4, 0.21)?.changes.length, 1);
assert.equal(ds.states[center.id], 2);
assert.equal(ds.arena.tiles[center.id].isEnabled(), false);
s.world.step();
assert.equal(
  s.world.castRay(
    new RAPIER.Ray({ x: center.x, y: 2, z: center.z }, { x: 0, y: -1, z: 0 }),
    4,
    true,
    undefined,
    DROPSHOT_BALL_GROUP,
  ),
  null,
  "No ball collision under opening",
);
assert.equal(openFloor(center.x, center.z, 0.95, ds.tiles), 1);
assert.equal(openFloor(center.x + 3.2, center.z, 0.95, ds.tiles), null);
const view = new DropshotView();
view.apply(ds.snapshot(2, true));
assert.equal(view.tiles, ds.tiles);
assert.equal(ds.snapshot(2).tiles?.length, 140);
assert.equal(
  ds.snapshot(2.01).tiles,
  undefined,
  "No full tile state every tick",
);
// Actual physical sphere falls only through the open tile and scores below it.
m.phase = "playing";
s.ball.setTranslation({ x: center.x, y: 5, z: center.z }, true);
s.ball.setLinvel({ x: 0, y: -8, z: 0 }, true);
s.ballPose.snap();
for (let i = 0; i < 160 && m.phase === "playing"; i++) {
  s.step([n, n]);
  m.tick(s);
}
assert.equal(m.phase, "goal");
assert.equal(m.score[0], 1);
assert.equal(m.lastGoal?.scorerId, "player");
assert.ok(m.goalFocus!.y < -s.physics.ball.radius);
assert.equal(m.stats!.players.get("player")!.damage, 2);
// The scoring side retains its old cracks/holes across the replay/kickoff.
const keep = tiles.filter((t) => t.team === 0).slice(0, 2);
ds.states[keep[0].id] = 1;
ds.states[keep[1].id] = 2;
ds.arena.tiles[keep[1].id].setEnabled(false);
// Full existing replay flow; only the conceded side repairs its floor.
for (let i = 0; i < 400 && m.phase !== "replay"; i++) {
  s.step([n, n]);
  m.tick(s);
}
assert.equal(m.phase, "replay");
const clip = m.replay!.clip;
assert.ok(clip.dropshot?.some((e) => e.state.tiles?.[center.id] === "2"));
assert.ok(decodeReplay(replayMessage("test", clip)).dropshot?.length);
assert.ok(m.skipReplay("player", clip.goal.id, s));
assert.ok(
  tiles.filter((t) => t.team === 1).every((t) => ds.states[t.id] === 0),
);
assert.equal(ds.states[keep[0].id], 1);
assert.equal(ds.states[keep[1].id], 2);
ds.arena.tiles.forEach((c, i) =>
  assert.equal(c.isEnabled(), ds.states[i] !== 2),
);
view.apply(ds.snapshot(s.clock, true));
assert.equal(view.tiles, ds.tiles);
m.start(s);
assert.equal(ds.tiles, "0".repeat(140), "A new match repairs both halves");
assert.equal(ds.energy, 0);
// Mirror the physical goal: Blue concedes and repairs, Orange retains cracks/holes.
{
  m.start(s);
  m.phase = "playing";
  const blue = tiles
    .filter((t) => t.team === 0)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  const orange = tiles.filter((t) => t.team === 1).slice(0, 2);
  ds.states[blue.id] = 2;
  ds.arena.tiles[blue.id].setEnabled(false);
  ds.states[orange[0].id] = 1;
  ds.states[orange[1].id] = 2;
  ds.arena.tiles[orange[1].id].setEnabled(false);
  s.ball.setTranslation({ x: blue.x, y: 4, z: blue.z }, true);
  s.ball.setLinvel({ x: 0, y: -8, z: 0 }, true);
  for (let i = 0; i < 180 && m.phase === "playing"; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  assert.equal(m.phase, "goal");
  assert.equal(ds.goal, 1);
  for (let i = 0; i < 400 && m.phase !== "replay"; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  assert.equal(m.phase, "replay");
  m.skipReplay("player", m.replay!.clip.goal.id, s);
  assert.ok(
    tiles.filter((t) => t.team === 0).every((t) => ds.states[t.id] === 0),
  );
  assert.equal(ds.states[orange[0].id], 1);
  assert.equal(ds.states[orange[1].id], 2);
  assert.equal(ds.arena.tiles[orange[1].id].isEnabled(), false);
  view.apply(ds.snapshot(s.clock, true));
  assert.equal(view.tiles, ds.tiles);
  m.start(s);
  assert.equal(ds.tiles, "0".repeat(140));
}
// Closed geometry, gentle rolls, high speeds and varied ball radii never score.
for (const size of ["DEFAULT", "SMALL", "LARGE", "GIGANTIC"] as const) {
  s.configureMutators({ ...DEFAULT_MUTATORS, ballSize: size });
  m.kickoff(s);
  m.phase = "playing";
  s.cars.forEach((c) => c.body.setEnabled(false));
  s.ball.setTranslation({ x: center.x, y: 5, z: center.z }, true);
  s.ball.setLinvel({ x: 0, y: -60, z: 0 }, true);
  s.ballPose.snap();
  for (let i = 0; i < 60; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  assert.equal(m.phase, "playing");
  assert.equal(ds.goal, null);
  assert.ok(s.ball.translation().y > 0);
}
// Regeneration: held zero never gains, then exact delay and rate. Mutators override.
const c = s.cars[0];
c.body.setEnabled(true);
c.boost = 0;
c.mutators = DEFAULT_MUTATORS;
for (let i = 0; i < 120; i++) ds.regenBoost(c, true, P.dt);
assert.equal(c.boost, 0);
for (let i = 0; i < 240; i++) ds.regenBoost(c, false, P.dt);
assert.ok(c.boost < 1e-8);
for (let i = 0; i < 120; i++) ds.regenBoost(c, false, P.dt);
assert.ok(Math.abs(c.boost - 10) < 0.01);
c.mutators = { ...DEFAULT_MUTATORS, boostAmount: "NO BOOST" };
c.boost = 0;
ds.regenBoost(c, false, 2);
assert.equal(c.boost, 0);
assert.equal(chooseMatchArena(undefined, Math.random, "dropshot"), "dropshot");
for (let i = 0; i < 20; i++)
  assert.notEqual(
    chooseMatchArena(undefined, () => i / 20),
    "dropshot",
  );
for (const team of [0, 1])
  for (let slot = 0; slot < 3; slot++)
    assert.equal(
      Math.sign(dropshotSpawn(team, slot, 3).z),
      team === 0 ? 1 : -1,
    );
s.dispose();
// Authoritative packet validation, delta application/reconciliation and flexible rosters.
for (const counts of [
  [1, 1],
  [2, 2],
  [3, 3],
  [1, 3],
]) {
  const players = [
    ...Array.from({ length: counts[0] }, (_, i) => ({
      id: "blue-" + i,
      name: "Blue " + i,
      team: 0 as const,
      controller: "remote" as const,
      preset: starter(),
    })),
    ...Array.from({ length: counts[1] }, (_, i) => ({
      id: "orange-" + i,
      name: "Orange " + i,
      team: 1 as const,
      controller: "remote" as const,
      preset: starter(),
    })),
  ];
  const net = new NetworkMatch(
    players,
    "dropshot",
    crypto.randomUUID(),
    "dropshot",
  );
  const d = net.simulation.dropshot!;
  const a = new DropshotView(),
    b = new DropshotView();
  const start = net.snapshot();
  assert.ok(
    peerSnapshot(
      start,
      net.id,
      players.map((p) => p.id),
    ),
  );
  a.apply(start.dropshot!);
  b.apply(start.dropshot!);
  d.touch(players[0].id, 0, 0);
  d.damage(center.id, 5, 1);
  const next = net.snapshot();
  assert.ok(
    peerSnapshot(
      next,
      net.id,
      players.map((p) => p.id),
    ),
  );
  a.apply(next.dropshot!);
  b.apply(next.dropshot!);
  assert.equal(a.tiles, d.tiles);
  assert.equal(a.tiles, b.tiles);
  assert.ok(
    net.addSpectator({
      id: "late-watcher",
      name: "Late watcher",
      team: "spectator",
    }),
  );
  assert.ok(!net.addSpectator({ id: "fake-car", name: "Fake", team: 0 }));
  net.connected(players[0].id);
  const reconnect = net.snapshot();
  assert.equal(reconnect.dropshot?.tiles, d.tiles);
  const late = new DropshotView();
  late.apply(reconnect.dropshot!);
  assert.equal(late.tiles, d.tiles);
  const bad = structuredClone(next);
  bad.dropshot!.events[0].playerId = "forged";
  assert.equal(
    peerSnapshot(
      bad,
      net.id,
      players.map((p) => p.id),
    ),
    null,
  );
  net.simulation.dispose();
}
console.log(
  "PASS Dropshot: 140 tiles/70 per side, neighbor 1/7/19 clusters, enemy-only physical state transitions, charge cap/decay/threshold/reset, real open-floor goal/replay/reset, closed-floor CCD/mutated radii, regeneration/delay/mutator isolation, 1v1/2v2/3v3/uneven authority snapshots, deltas, reconnect and identity validation",
);
