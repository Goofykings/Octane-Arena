import { DROPSHOT_BALL_GROUP } from "../src/physics/collision-groups";
import { refreshStaticQueries } from "../src/physics/queries";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Group, PerspectiveCamera } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import {
  DROPSHOT_CONFIG as D,
  dropshotTiles,
  hexVertices,
} from "../shared/dropshot";
import { P } from "../src/config/physics";
import { neutralInput } from "../shared/player";
import { Match } from "../src/game/match";
import { MatchStats } from "../src/game/match-stats";
import { predictGoal, type BallSample } from "../src/game/ball-prediction";
import { BotTeam } from "../src/ai/team";
import { GameCamera } from "../src/camera/camera";
const n = neutralInput();
await initializeSimulation();
const setup = () => {
  const s = new Simulation();
  s.setGameMode("dropshot");
  s.reset();
  s.cars.forEach((c) => c.body.setEnabled(false));
  s.ball.setEnabled(false);
  s.world.step();
  return s;
};
const center = dropshotTiles.find(
  (t) => t.team === 1 && t.row === 3 && Math.abs(t.x) < 4,
)!;
{
  const s = setup();
  for (let x = -40; x <= 40; x += 2)
    for (let z = -40; z <= 40; z += 2) {
      if (Math.hypot(x, z) > 40) continue;
      assert.ok(
        s.world.castRay(
          new RAPIER.Ray({ x, y: 2, z }, { x: 0, y: -1, z: 0 }),
          3,
          true,
        ),
        "No hole in intact floor at " + x + "," + z,
      );
    }
  for (const tile of dropshotTiles)
    for (const v of hexVertices(tile.x, tile.z))
      assert.ok(
        s.world.castRay(
          new RAPIER.Ray({ x: v.x, y: 2, z: v.z }, { x: 0, y: -1, z: 0 }),
          3,
          true,
        ),
        "Joined tile vertex " + tile.id,
      );
  for (const speed of [1, 50])
    for (const z of [-31, -0.1, 0, 0.1, 31]) {
      s.reset();
      s.cars.forEach((c) => c.body.setEnabled(false));
      s.ball.setEnabled(true);
      s.ball.setTranslation(
        { x: -30, y: s.physics.ball.radius + 0.025, z },
        true,
      );
      s.ball.setLinvel({ x: speed, y: 0, z: 0 }, true);
      s.ballPose.snap();
      let corrections = 0;
      const translate = s.ball.setTranslation.bind(s.ball);
      s.ball.setTranslation = (p, w) => {
        corrections++;
        translate(p, w);
      };
      for (let i = 0; i < 120; i++) {
        s.step([n, n]);
        assert.equal(
          corrections,
          0,
          "Seam traversal must not rely on a numerical recovery",
        );
        assert.ok(s.ball.translation().y > 0, "No ball seam escape");
      }
      assert.equal(s.containmentRecoveries, 0);
      s.ball.setTranslation = translate;
    }
  s.dispose();
}
// Client query refresh toggles real holes without advancing moving bodies.
{
  const s = new Simulation();
  s.setGameMode("dropshot");
  const c = s.cars[0];
  const before = {
    p: { ...c.body.translation() },
    v: { ...c.body.linvel() },
    b: { ...s.ball.translation() },
  };
  refreshStaticQueries(s);
  const t = dropshotTiles[90],
    ray = () =>
      s.world.castRay(
        new RAPIER.Ray({ x: t.x, y: 2, z: t.z }, { x: 0, y: -1, z: 0 }),
        3,
        true,
        undefined,
        DROPSHOT_BALL_GROUP,
      );
  assert.ok(ray());
  s.dropshot!.arena.tiles[90].setEnabled(false);
  refreshStaticQueries(s);
  assert.equal(ray(), null);
  assert.deepEqual({ ...c.body.translation() }, before.p);
  assert.deepEqual({ ...c.body.linvel() }, before.v);
  assert.deepEqual({ ...s.ball.translation() }, before.b);
  s.dispose();
}
// Real car impact charges once per contact episode, rather than by overlap ticks.
{
  const s = setup(),
    c = s.cars[0];
  s.ball.setEnabled(true);
  c.reset(0, 2, 0, 1.35);
  c.body.setEnabled(true);
  c.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
  s.ball.setTranslation({ x: 0, y: 2, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  s.ballPose.snap();
  for (let i = 0; i < 25; i++) s.step([n, n]);
  assert.equal(s.dropshot!.lastTouchPlayerId, c.id);
  assert.ok(s.dropshot!.energy >= 500, "Physical impulse contributes energy");
  assert.ok(
    s.dropshot!.energy <= 2500 + 25 * P.dt * 2500,
    "Contact cannot add unbounded per-frame energy",
  );
  s.dispose();
}
// Damage alone is not a shot. Only an existing open-floor trajectory is a threat.
{
  const s = setup(),
    d = s.dropshot!,
    stats = new MatchStats(s.players);
  s.ball.setEnabled(true);
  d.touch("player", 0, 0);
  d.damage(center.id, 5, 0);
  stats.observe(s);
  assert.equal(stats.players.get("player")!.shots, 0);
  assert.equal(stats.players.get("player")!.damage, 1);
  d.damage(center.id, 5, 0.3);
  s.world.step();
  const attack: BallSample = {
    position: { x: center.x, y: 4, z: center.z },
    velocity: { x: 0, y: -5, z: 0 },
    heat: null,
    mode: "dropshot",
    physics: s.physics,
    dropshot: { tiles: d.tiles },
  };
  assert.equal(predictGoal(attack, s.world)?.team, 1);
  const safe: BallSample = {
    ...attack,
    position: { x: 0, y: 4, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  stats.touch(
    { playerId: "player", before: safe, after: attack, impulseSpeed: 6 },
    s,
  );
  s.clock += 0.05;
  stats.touch(
    { playerId: "player", before: attack, after: attack, impulseSpeed: 0.1 },
    s,
  );
  assert.equal(stats.players.get("player")!.shots, 1, "One continuous threat");
  const cleared = { ...attack, velocity: { x: 20, y: 5, z: 10 } };
  assert.equal(predictGoal(cleared, s.world), null);
  s.clock += 0.05;
  stats.touch(
    { playerId: "bot", before: attack, after: cleared, impulseSpeed: 15 },
    s,
  );
  assert.equal(stats.players.get("bot")!.saves, 1, "Meaningful defender clear");
  s.ball.setTranslation({ x: 0, y: D.arenaHeight - 1, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: 10, z: 0 }, true);
  s.ballPose.snap();
  for (let i = 0; i < 10; i++) {
    s.step([n, n]);
    assert.equal(s.dropshot!.grounded, false, "Ceiling contact is not ground");
  }
  s.dispose();
}
// Ordinary wheel driving crosses hex seams and both rounded wall ramps.
for (const sign of [-1, 1]) {
  const s = setup(),
    c = s.cars[0];
  c.reset(0, sign * 30, sign > 0 ? Math.PI : 0);
  c.body.setEnabled(true);
  let highest = 0;
  for (let i = 0; i < 420; i++) {
    s.step([{ ...n, throttle: 1, boost: true }, n]);
    highest = Math.max(highest, c.body.translation().y);
    assert.ok(c.body.translation().y > D.carFallDepth, "Rigid floor support");
  }
  assert.ok(highest > 5, "Wall reached on normal inputs");
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
for (const angle of [0, Math.PI / 2, Math.PI]) {
  const s = setup(),
    c = s.cars[0];
  c.reset(0, 40, Math.PI, 3);
  c.body.setRotation(
    new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle)),
    true,
  );
  c.body.setEnabled(true);
  c.body.setLinvel({ x: 0, y: 4, z: 30 }, true);
  for (let i = 0; i < 240; i++) s.step([n, n]);
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
// Difficulty tiers use shared input controllers, current tile state and dynamic roles.
for (const difficulty of ["beginner", "intermediate", "advanced"] as const) {
  const s = setup();
  s.configurePlayers(
    Array.from({ length: 6 }, (_, i) => ({
      id: "car-" + i,
      name: "Pilot " + i,
      team: (i < 3 ? 0 : 1) as 0 | 1,
      controller: "bot" as const,
    })),
  );
  s.reset();
  const team = new BotTeam(difficulty);
  team.prepare(s);
  assert.deepEqual([...team.decision.roles.values()].sort(), [
    "first",
    "first",
    "second",
    "second",
    "third",
    "third",
  ]);
  let moving = 0;
  for (let i = 0; i < 120; i++) {
    const inputs = team.inputs(s);
    for (const input of inputs.values()) {
      assert.ok(Math.abs(input.throttle) <= 1);
      if (input.boost) moving++;
    }
    s.step(inputs);
  }
  assert.ok(moving > 0, "Bots travel using boost");
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
{
  const s = setup(),
    camera = new PerspectiveCamera(110, 16 / 9, 0.05, 340),
    rig = new GameCamera(camera),
    car = new Group(),
    ball = new Group();
  car.position.set(0, 0.4, 20);
  let previous: Quaternion | undefined;
  for (let i = 0; i < 360; i++) {
    ball.position.set(
      Math.sin(i / 60) * 0.2,
      2 + 16 * Math.abs(Math.sin(i / 100)),
      20 + Math.cos(i / 60) * 0.2,
    );
    rig.update(car, ball, s, 1 / 60, false, i / 60);
    assert.ok(
      [...camera.position.toArray(), ...camera.quaternion.toArray()].every(
        Number.isFinite,
      ),
    );
    if (previous)
      assert.ok(
        previous.angleTo(camera.quaternion) < 0.3,
        "No overhead camera snap",
      );
    previous = camera.quaternion.clone();
  }
  s.dispose();
}
// Zero-second live play, tied-floor overtime and next-goal completion.
{
  const s = setup(),
    m = new Match();
  m.gameMode = "dropshot";
  m.start(s, "bot");
  m.phase = "playing";
  m.remaining = 0;
  m.score = [2, 2];
  s.cars.forEach((c) => c.body.setEnabled(false));
  s.ball.setEnabled(true);
  s.ball.setTranslation({ x: 0, y: 5, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  s.ballPose.snap();
  for (let i = 0; i < 30; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  assert.equal(m.phase, "playing", "Live airborne ball at zero stays live");
  for (let i = 0; i < 240 && !m.overtime; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  assert.equal(m.overtime, true);
  assert.equal(m.phase, "countdown");
  m.phase = "playing";
  s.cars.forEach((c) => c.body.setEnabled(false));
  const d = s.dropshot!;
  d.touch("player", 0, 0);
  d.damage(center.id, 5, s.clock);
  d.damage(center.id, 5, s.clock + 0.21);
  s.ball.setTranslation({ x: center.x, y: 4, z: center.z }, true);
  s.ball.setLinvel({ x: 0, y: -6, z: 0 }, true);
  s.ballPose.snap();
  for (let i = 0; i < 180 && m.phase === "playing"; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  assert.equal(m.phase, "goal");
  assert.deepEqual(m.score, [3, 2]);
  for (let i = 0; i < 400 && m.phase !== "replay"; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  assert.equal(m.phase, "replay");
  m.skipReplay("player", m.replay!.clip.goal.id, s);
  assert.equal(m.phase, "finished");
  s.dispose();
}
console.log(
  "PASS Dropshot quality: intact floor/hex vertices, slow/fast ball seam rolls, real impulse charging, open-floor shot/save continuity, ceiling zero-second exclusion, full-boost wall ramps, roof/side aerial collisions, three bot difficulties/roles and overhead camera continuity",
);
