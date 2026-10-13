import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput as n } from "../shared/player";
import { RUMBLE_CONFIG as R } from "../src/config/rumble";
import { P } from "../src/config/physics";
import { matchMvp } from "../shared/match-stats";
import { MatchStats } from "../src/game/match-stats";
import { bodies } from "../shared/catalog";
import { ReplayRecorder } from "../src/replay/recorder";
import { ReplaySampler, BALL_STRIDE, RC } from "../shared/replay";
import { rumbleSnapshotSchema } from "../shared/rumble";
await initializeSimulation();
const roster = [
  { id: "a", name: "A", team: 0 as const, controller: "local" as const },
  {
    id: "friend",
    name: "Friend",
    team: 0 as const,
    controller: "remote" as const,
  },
  { id: "b", name: "B", team: 1 as const, controller: "remote" as const },
  { id: "c", name: "C", team: 1 as const, controller: "remote" as const },
];
function fixture(flat = true) {
  const s = new Simulation(flat, roster);
  s.setGameMode("rumble");
  s.rumble!.setPhase(true, false);
  s.cars.forEach((c, i) => c.reset(i * 5, 0, 0, 10));
  s.ball.setTranslation({ x: 0, y: 10, z: -20 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  return s;
}
const tick = (s: Simulation, count: number) => {
  for (let i = 0; i < count; i++) s.step(roster.map(n));
};
{
  const s = fixture(),
    r = s.rumble!;
  r.grant("a", "SWAPPER");
  assert.equal(r.target("a")!.id, "b", "Closer teammate ignored");
  s.cars[3].body.setTranslation({ x: 9.8, y: 10, z: 0 }, true);
  assert.equal(r.target("a")!.id, "b", "Hysteresis");
  s.cars[3].body.setTranslation({ x: 7, y: 10, z: 0 }, true);
  assert.equal(r.target("a")!.id, "c");
  s.cars[3].body.setEnabled(false);
  assert.equal(r.target("a")!.id, "b", "Demo ignored");
  r.suspend("b");
  assert.equal(r.target("a"), undefined, "Disconnected ignored");
  r.suspend("b", false);
  const a = s.cars[0],
    b = s.cars[2];
  a.body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6),
    true,
  );
  a.body.setLinvel({ x: 3, y: 1, z: 8 }, true);
  b.body.setLinvel({ x: -4, y: 2, z: 5 }, true);
  a.body.setAngvel({ x: 0.3, y: 0.6, z: 0.9 }, true);
  b.body.setAngvel({ x: -0.7, y: 0.2, z: 0.4 }, true);
  const capture = (c: typeof a) => ({
    p: { ...c.body.translation() },
    q: { ...c.body.rotation() },
    v: { ...c.body.linvel() },
    w: { ...c.body.angvel() },
  });
  const before = [capture(a), capture(b)];
  assert.ok(r.use("a"));
  for (const [i, c] of [a, b].entries()) {
    assert.deepEqual({ ...c.body.translation() }, before[1 - i].p);
    assert.deepEqual({ ...c.body.rotation() }, before[i].q);
    assert.deepEqual({ ...c.body.linvel() }, before[i].v);
    assert.deepEqual({ ...c.body.angvel() }, before[i].w);
    assert.equal(c.teleportSequence, 1);
  }
  assert.equal(r.events.filter((e) => e.kind === "SWAP").length, 1);
  assert.ok(rumbleSnapshotSchema.safeParse(r.snapshot()).success);
  r.grant("a", "SWAPPER");
  b.body.setTranslation({ x: 90, y: 10, z: 0 }, true);
  assert.equal(r.use("a"), false);
  s.dispose();
}
// Orientation-sensitive landing placement remains above floor and rejects goal interiors.
{
  const s = fixture(false),
    r = s.rumble!;
  s.cars[0].reset(0, 0, 0, 8);
  s.cars[2].reset(12, 0, 0);
  s.cars[3].body.setEnabled(false);
  s.cars[0].body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
    true,
  );
  r.grant("a", "SWAPPER");
  assert.ok(r.use("a"));
  let penetration = 0;
  s.world.forEachCollider((c) => {
    if (!c.parent()) {
      const hit = c.contactShape(
        s.cars[0].collider.shape,
        s.cars[0].collider.translation(),
        s.cars[0].collider.rotation(),
        0,
      );
      if (hit) penetration = Math.min(penetration, hit.distance);
    }
  });
  assert.ok(penetration > -0.02, "Receiving chassis is not underground");
  r.grant("a", "SWAPPER");
  s.cars[2].body.setTranslation(
    { x: 0, y: 2, z: P.arena.halfLength + 2 },
    true,
  );
  s.cars[0].body.setTranslation(
    { x: 0, y: 2, z: P.arena.halfLength - 5 },
    true,
  );
  assert.equal(r.use("a"), false, "No invalid goal swaps");
  s.dispose();
}
// Pursuit tests use the real solver/contact pipeline, not synthetic contact events.
for (const scenario of ["floor-side", "moving", "fast", "side"]) {
  const s = fixture();
  s.cars[1].body.setEnabled(false);
  s.cars[2].body.setEnabled(false);
  s.cars[3].body.setEnabled(false);
  const car = s.cars[0];
  car.reset(0, 0, 0, scenario === "floor-side" ? 0.36 : 8);
  s.ball.setTranslation(
    { x: 8, y: scenario === "floor-side" ? P.ball.radius + 0.02 : 8, z: 0 },
    true,
  );
  s.ball.setLinvel({ x: 0, y: 0, z: scenario === "moving" ? 6 : 0 }, true);
  car.body.setLinvel(
    { x: scenario === "fast" ? 23 : 0, y: 0, z: scenario === "side" ? 18 : 0 },
    true,
  );
  if (scenario !== "floor-side") s.world.gravity = { x: 0, y: 0, z: 0 };
  const r = s.rumble!;
  r.grant("a", "GRAPPLING_HOOK");
  assert.ok(r.use("a"));
  const v = new Vector3().copy(car.body.linvel());
  r.beforeStep(roster.map(n));
  assert.ok(
    v.distanceTo(car.body.linvel()) <=
      R.grapple.maxAcceleration * P.dt + 0.0001,
    "Bounded acceleration",
  );
  if (scenario === "fast")
    assert.ok(car.body.linvel().x < 23, "Brake high closing velocity");
  if (scenario === "side")
    assert.ok(car.body.linvel().z < 18, "Damp lateral orbit motion");
  tick(s, 600);
  assert.ok(s.touchSequence > 0, scenario + " converges onto actual ball");
  assert.equal(
    r.players.get("a")!.phase,
    "cooldown",
    scenario + " ends on real contact",
  );
  s.dispose();
}
{
  const s = fixture(),
    r = s.rumble!;
  r.grant("a", "GRAPPLING_HOOK");
  r.use("a");
  // Run authority forces without the solver touching: near misses and time never end it.
  s.ball.setTranslation({ x: 0, y: 12, z: 0 }, true);
  for (let i = 0; i < 1200; i++) r.beforeStep(roster.map(n));
  assert.equal(r.players.get("a")!.phase, "active");
  r.suspend("a");
  assert.equal(r.players.get("a")!.phase, "cooldown");
  s.dispose();
}
{
  const s = fixture(),
    r = s.rumble!;
  r.grant("a", "PLUNGER");
  r.use("a");
  for (let i = 0; i < Math.round(R.plunger.duration / P.dt) - 1; i++)
    r.beforeStep(roster.map(n));
  assert.equal(r.players.get("a")!.phase, "active");
  r.beforeStep(roster.map(n));
  assert.equal(r.players.get("a")!.phase, "cooldown");
  assert.ok(R.plunger.duration < 3);
  s.dispose();
}
{
  const stats = new MatchStats(roster);
  const rows = stats.snapshot();
  rows[2].score = 80;
  rows[3].score = 80;
  rows[3].goals = 1;
  assert.equal(matchMvp(roster, rows)?.id, "c");
  rows[2].goals = 1;
  assert.equal(matchMvp(roster, rows)?.id, "b");
  rows[0].score = 90;
  assert.equal(matchMvp(roster, rows)?.id, "a");
}

// Short swaps must not smear in replay, even below the old 8m teleport heuristic.
{
  const s = fixture(),
    r = s.rumble!,
    rec = new ReplayRecorder();
  s.cars[2].reset(4, 0, 0, 10);
  s.cars[3].body.setEnabled(false);
  rec.capture(s, 0);
  r.grant("a", "SWAPPER");
  r.use("a");
  s.clock = P.dt;
  rec.capture(s, 0);
  const clip = rec.clip({
    id: "swap-goal",
    time: s.clock,
    scorerId: "a",
    team: 0,
    ownGoal: false,
    lastTouchId: "a",
    touchTime: 0,
    ballSpeed: 0,
    focus: { x: 0, y: 1, z: 0 },
  });
  const frame = new ReplaySampler(clip).sample(P.dt * 0.5);
  assert.equal(
    frame[BALL_STRIDE + RC.position],
    4,
    "Discrete swap, no cross-field lerp",
  );
  assert.ok(
    clip.rumble!.some((h) => h.state.events.some((e) => e.kind === "SWAP")),
  );
  s.dispose();
}

// A swapped Spikes carrier must release its native joint before teleporting.
{
  const s = fixture(),
    r = s.rumble!,
    carrier = s.cars[2],
    d = bodies[carrier.bodyId];
  s.world.gravity = { x: 0, y: 0, z: 0 };
  s.ball.setTranslation(
    new Vector3()
      .copy(carrier.body.translation())
      .add(new Vector3(0, d.hitboxY + d.halfHeight + P.ball.radius - 0.02, 0)),
    true,
  );
  r.grant(carrier.id, "SPIKES");
  r.use(carrier.id);
  tick(s, 3);
  assert.ok(
    r.players.get(carrier.id)!.attachment,
    "Real car-ball manifold makes Spikes joint",
  );
  assert.equal(s.world.impulseJoints.len(), 1);
  r.grant("a", "SWAPPER");
  assert.ok(r.use("a"));
  assert.equal(s.world.impulseJoints.len(), 0, "No stretched teleport joint");
  assert.equal(r.players.get(carrier.id)!.item, null);
  tick(s, 60);
  assert.ok(
    s.cars.every((c) => Object.values(c.body.linvel()).every(Number.isFinite)),
  );
  s.dispose();
}
{
  const stats = new MatchStats(roster).snapshot();
  for (const key of ["goals", "assists", "saves", "shots"] as const) {
    for (const row of stats) {
      row.score = 0;
      row.goals = row.assists = row.saves = row.shots = 0;
    }
    stats[2].score = stats[3].score = 20;
    stats[2][key] = 1;
    stats[3][key] = 2;
    assert.equal(
      matchMvp(roster, stats)?.id,
      "c",
      key + " resolves score ties",
    );
  }
}
console.log(
  "PASS Swapper targeting/authority/placement/kinematics, bounded moving-ball grapple pursuit/contact lifecycle, shorter Plunger and deterministic MVP",
);
