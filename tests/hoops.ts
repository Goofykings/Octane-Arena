import assert from "node:assert/strict";
import { Vector3, Quaternion, PerspectiveCamera, Group } from "three";
import { HOOPS_CONFIG as H, hoopsCrossing, hoopsSpawn } from "../shared/hoops";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { Pads } from "../src/game/pads";
import { P } from "../src/config/physics";
import { DEFAULT_MUTATORS as D } from "../shared/mutators";
import { neutralInput as n } from "../shared/player";
import { hoopsShell, hoopsNet, hoopsNetCollision } from "../src/arena/hoops";
import { meshEdges } from "../src/arena/shell";
import { predictGoal } from "../src/game/ball-prediction";
import { NetworkMatch } from "../src/game/authoritative-match";
import { starter } from "../shared/catalog";
import { peerSnapshot } from "../shared/rtc";
import { chooseMatchArena } from "../shared/arenas";
import { BotTeam } from "../src/ai/team";
import { captureGoalReplay } from "./replay-capture";
import { GameCamera } from "../src/camera/camera";
import {
  HOOPS_NET_GROUP,
  HOOPS_RIM_GROUP,
  HOOPS_CAR_GROUP,
  HOOPS_BALL_GROUP,
} from "../src/physics/collision-groups";
import { cameraCollisionCategory } from "../src/camera/space";
await initializeSimulation();
for (const sign of [-1, 1]) {
  const top = { x: 0, y: 6, z: sign * H.hoopZ },
    low = { ...top, y: 2 };
  assert.equal(hoopsCrossing(top, low, 0.95), sign < 0 ? 0 : 1);
  assert.equal(hoopsCrossing(low, top, 0.95), null);
  assert.equal(hoopsCrossing({ ...low, y: 1 }, { ...low, y: 2 }, 0.95), null);
  assert.equal(
    hoopsCrossing(
      { ...top, x: H.hoopRadius },
      { ...low, x: H.hoopRadius },
      0.95,
    ),
    null,
  );
  assert.equal(
    hoopsCrossing({ ...top, x: 4.4 }, { ...low, x: 4.4 }, 2),
    null,
    "Large ball needs actual clearance",
  );
  assert.equal(hoopsCrossing(top, low, 2), sign < 0 ? 0 : 1);
  assert.equal(
    hoopsCrossing({ ...top, x: 20 }, { ...low, x: 0 }, 0.95),
    null,
    "Swept crossing rejects side entry after plane",
  );
}
const shell = hoopsShell();
assert.ok(
  [...meshEdges(shell.indices).values()].every((e) => e.faces.length === 2),
  "Entire court shell is manifold/watertight",
);
assert.equal(
  chooseMatchArena(undefined, () => 0, "hoops"),
  "hoops",
);
for (let i = 0; i < 10; i++)
  assert.notEqual(
    chooseMatchArena(undefined, () => i / 10),
    "hoops",
  );
for (const size of [1, 2, 3])
  for (const team of [0, 1])
    for (let i = 0; i < size; i++) {
      const p = hoopsSpawn(team, i, size);
      assert.ok(
        Math.abs(p.x) < H.arenaWidth / 2 - 3 &&
          Math.abs(p.z) < H.arenaLength / 2 - 3,
      );
    }
for (const size of [1, 2, 3])
  for (const team of [0, 1])
    for (let i = 0; i < size; i++) {
      const p = hoopsSpawn(team, i, size);
      assert.ok(
        Math.hypot(p.x, p.z - (team === 0 ? 1 : -1) * H.hoopZ) >
          H.hoopRadius + H.netFlare + 1,
        "Kickoff cars start on clear flat court, away from the hoop/net",
      );
    }
const pads = new Pads("hoops");
assert.equal(pads.items.length, 20);
assert.equal(pads.items.filter((p) => p.large).length, 6);
function setup(config = D) {
  const s = new Simulation(),
    m = new Match();
  s.configureMutators(config);
  m.gameMode = "hoops";
  m.start(s);
  s.cars.forEach((c) => c.body.setEnabled(false));
  return { s, m };
}
for (const config of [
  D,
  { ...D, ballSize: "LARGE" as const },
  { ...D, gravity: "LOW" as const },
  { ...D, gravity: "HIGH" as const },
]) {
  const { s, m } = setup(config);
  try {
    const initial = s.ball.translation();
    assert.ok(initial.y >= s.physics.ball.radius);
    for (let i = 0; i < 359; i++) {
      m.tick(s, pads);
      assert.equal(s.ball.linvel().y, 0);
      assert.deepEqual(s.ball.translation(), initial);
    }
    m.tick(s, pads);
    assert.equal(m.phase, "playing");
    assert.equal(s.ball.linvel().y, H.kickoffVerticalVelocity);
    m.tick(s, pads);
    assert.equal(
      s.ball.linvel().y,
      H.kickoffVerticalVelocity,
      "Launch happens once",
    );
    s.ball.setTranslation({ x: 0, y: 8, z: -H.hoopZ }, true);
    s.ball.setLinvel({ x: 0, y: -3, z: 0 }, true);
    s.lastTouchId = s.cars[0].id;
    s.lastTouchTime = s.clock;
    for (let i = 0; i < 240 && m.phase === "playing"; i++) {
      s.step([n(), n()]);
      m.tick(s, pads);
    }
    assert.equal(m.phase, "goal");
    assert.deepEqual(m.score, [1, 0]);
    assert.equal(m.stats!.players.get(s.cars[0].id)!.goals, 1);
    assert.equal(m.goalFocus!.y, H.hoopHeight);
    assert.equal(m.goalFocus!.z, -H.hoopZ);
    captureGoalReplay(m, s, pads);
    assert.equal(m.replay!.clip.goal.focus.y, H.hoopHeight);
    assert.equal(s.containmentRecoveries, 0);
  } finally {
    s.dispose();
  }
}
// The net is a ball-only curved skirt; cars and all their contact probes ignore it.
for (const sign of [-1, 1]) {
  const mesh = hoopsNet(sign);
  assert.ok(
    [...meshEdges(hoopsNetCollision(sign).indices).values()].every(
      (e) => e.faces.length === 2,
    ),
    "Net collision volume is watertight",
  );
  assert.ok(
    Math.max(
      ...Array.from(mesh.vertices)
        .filter((_, i) => i % 3 === 0)
        .map(Math.abs),
    ) <=
      H.hoopRadius + H.netFlare + 0.001,
  );
  for (const height of [0.4, 2.0])
    for (const direction of [-1, 1]) {
      const run = (removeNet: boolean) => {
        const { s } = setup();
        s.ball.setEnabled(false);
        const nets: import("@dimforge/rapier3d-compat").Collider[] = [];
        s.world.forEachCollider((col) => {
          if (col.collisionGroups() === HOOPS_NET_GROUP) nets.push(col);
        });
        assert.equal(nets.length, 2);
        for (const net of nets) {
          assert.equal(cameraCollisionCategory(s, net), "IGNORE");
          if (removeNet) s.world.removeCollider(net, true);
        }
        s.world.step(); // Refresh scene queries after installing/removing static geometry.
        const c = s.cars[0];
        c.body.setEnabled(true);
        const front = sign * (H.hoopZ - H.hoopRadius),
          velocity = sign * direction * 12;
        c.reset(
          0,
          front - sign * direction * 4,
          velocity > 0 ? Math.PI : 0,
          height,
        );
        c.body.setLinvel({ x: 0, y: 0, z: velocity }, true);
        const start = c.body.translation().z;
        for (let i = 0; i < 75; i++) s.step([n(), n()]);
        const p = c.body.translation(),
          v = c.body.linvel(),
          q = c.body.rotation();
        assert.ok(
          (p.z - start) * sign * direction > 4,
          "Car actually crosses the front net and bottom curl",
        );
        assert.equal(s.containmentRecoveries, 0);
        const result = [p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w];
        s.dispose();
        return result;
      };
      const withNet = run(false),
        without = run(true);
      withNet.forEach((v, i) =>
        assert.ok(
          Math.abs(v - without[i]) < 1e-5,
          "Net must not affect chassis, wheel probes, speed or rotation",
        ),
      );
    }
  // The bank now redirects the ball smoothly instead of bouncing it straight back.
  for (const height of [1.9, 2.6])
    for (const direction of [-1, 1]) {
      const run = (removeNet: boolean) => {
        const { s } = setup();
        if (removeNet) {
          const nets: import("@dimforge/rapier3d-compat").Collider[] = [];
          s.world.forEachCollider((c) => {
            if (c.collisionGroups() === HOOPS_NET_GROUP) nets.push(c);
          });
          nets.forEach((c) => s.world.removeCollider(c, true));
        }
        s.world.gravity = { x: 0, y: 0, z: 0 };
        const flare = H.netFlare * (1 - Math.sqrt(height / H.netCurveHeight));
        const front = sign * (H.hoopZ - H.hoopRadius - flare);
        s.ball.setTranslation(
          { x: 0, y: height, z: front - sign * direction * 3 },
          true,
        );
        s.ball.setLinvel({ x: 0, y: 0, z: sign * direction * 12 }, true);
        for (let i = 0; i < 65; i++) s.step([n(), n()]);
        assert.equal(s.containmentRecoveries, 0);
        const p = new Vector3().copy(s.ball.translation());
        s.dispose();
        return p;
      };
      const withNet = run(false),
        withoutNet = run(true);
      assert.ok(
        withNet.distanceTo(withoutNet) > 0.5,
        `Net remains physical from both sides, with an angled response (${sign}, ${height}, ${direction}): ${withNet.toArray()} vs ${withoutNet.toArray()}`,
      );
    }
  for (const speed of [12, 14, 20]) {
    const { s, m } = setup();
    m.phase = "playing";
    s.ball.setTranslation(
      {
        x: 0,
        y: P.ball.radius + 0.02,
        z: sign * (H.hoopZ - H.hoopRadius - H.netFlare - 2),
      },
      true,
    );
    s.ball.setLinvel({ x: 0, y: 0, z: sign * speed }, true);
    s.ball.setAngvel({ x: (sign * speed) / P.ball.radius, y: 0, z: 0 }, true);
    let top = 0;
    for (let i = 0; i < 480 && m.phase === "playing"; i++) {
      s.step([n(), n()]);
      top = Math.max(top, s.ball.translation().y);
      m.tick(s);
    }
    assert.ok(
      top > H.hoopHeight + P.ball.radius,
      "Unassisted rolling ball climbs above the rim",
    );
    assert.equal(
      m.phase,
      "goal",
      "Rolling bank trajectory can score without aerial impulses",
    );
    assert.equal(s.containmentRecoveries, 0);
    s.dispose();
  }
  const { s } = setup();
  s.world.gravity = { x: 0, y: 0, z: 0 };
  s.ball.setTranslation({ x: 0, y: 6, z: sign * 33.3 }, true);
  s.ball.setLinvel({ x: 0, y: -6, z: 0 }, true);
  for (let i = 0; i < 65; i++) s.step([n(), n()]);
  assert.ok(
    s.ball.translation().y < 3,
    "Rear opening has no hidden circular rim",
  );
  assert.equal(
    hoopsCrossing(
      { x: 0, y: 5, z: sign * 33.3 },
      { x: 0, y: 2, z: sign * 33.3 },
      0.95,
    ),
    sign > 0 ? 1 : 0,
  );
  s.dispose();
}
// Memberships survive reset and entity rebuild, and do not leak into Soccar.
{
  const { s } = setup();
  const check = () => {
    assert.equal(s.ballCollider.collisionGroups(), HOOPS_BALL_GROUP);
    s.cars.forEach((c) =>
      assert.equal(c.collider.collisionGroups(), HOOPS_CAR_GROUP),
    );
  };
  s.reset();
  check();
  s.configurePlayers([
    { id: "net-player", name: "Net Player", team: 0, controller: "local" },
    { id: "net-bot", name: "Net Bot", team: 1, controller: "bot" },
  ]);
  check();
  s.setGameMode("soccar");
  s.reset();
  assert.equal(s.ballCollider.collisionGroups(), 0xffffffff);
  s.cars.forEach((c) => assert.equal(c.collider.collisionGroups(), 0xffffffff));
  s.setGameMode("hoops");
  s.reset();
  check();
  s.dispose();
}
// No fake floor completion: tied zero-clock play enters a Hoops overtime kickoff.
{
  const { s, m } = setup();
  m.phase = "playing";
  m.remaining = 0;
  for (let i = 0; i < 120 && !m.overtime; i++) {
    s.step([n(), n()]);
    m.tick(s, pads);
  }
  assert.ok(m.overtime);
  assert.equal(m.phase, "countdown");
  assert.equal(s.ball.linvel().y, 0);
  s.dispose();
}
// Real rounded-rim impacts reject edge hits and preserve finite rebound/spin.
{
  const { s, m } = setup();
  // Isolate the solid rim: the new over-rim bank intentionally intercepts some descending approaches.
  const bankColliders: import("@dimforge/rapier3d-compat").Collider[] = [];
  s.world.forEachCollider((c) => {
    if (c.collisionGroups() === HOOPS_NET_GROUP) bankColliders.push(c);
  });
  bankColliders.forEach((c) => s.world.removeCollider(c, true));
  m.phase = "playing";
  s.ball.setTranslation({ x: H.hoopRadius, y: 7, z: H.hoopZ }, true);
  s.ball.setLinvel({ x: 0, y: -9, z: 0 }, true);
  s.ball.setAngvel({ x: 0, y: 2, z: 1 }, true);
  let bounced = false;
  for (let i = 0; i < 160; i++) {
    const before = { ...s.ball.translation() };
    s.step([n(), n()]);
    const after = { ...s.ball.translation() };
    bounced ||= s.ball.linvel().y > 1;
    m.tick(s, pads);
    if (m.lastGoal) {
      assert.ok(bounced, "A rim impact rebounds before any later valid goal");
      assert.notEqual(
        hoopsCrossing(before, after, s.physics.ball.radius),
        null,
        "Only a later valid downward crossing can score",
      );
      break;
    }
    assert.equal(m.phase, "playing");
  }
  assert.ok(bounced);
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
// Rim contact rebounds upward, then the ball descends through the opening.
{
  const { s, m } = setup();
  m.phase = "playing";
  s.ball.setTranslation({ x: 6.5, y: 7, z: H.hoopZ }, true);
  s.ball.setLinvel({ x: -1, y: -7, z: 0 }, true);
  let bounced = false;
  for (let i = 0; i < 360 && m.phase === "playing"; i++) {
    s.step([n(), n()]);
    m.tick(s, pads);
    bounced ||= s.ball.linvel().y > 1;
  }
  assert.ok(bounced);
  assert.equal(m.phase, "goal");
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
// Rims must be entirely absent from camera queries, while still physically solid.
{
  const { s } = setup();
  let count = 0;
  s.world.forEachCollider((c) => {
    if (c.collisionGroups() === HOOPS_RIM_GROUP) {
      count++;
      assert.equal(cameraCollisionCategory(s, c), "IGNORE");
    }
  });
  assert.ok(count > 80);
  s.dispose();
}
// Cars also collide with the rim; the open net volume adds no hidden wall.
{
  const { s } = setup();
  s.ball.setEnabled(false);
  const c = s.cars[0];
  c.body.setEnabled(true);
  c.reset(9, H.hoopZ, Math.PI / 2, H.hoopHeight);
  c.body.setLinvel({ x: -10, y: 0, z: 0 }, true);
  let rebound = -10;
  for (let i = 0; i < 35; i++) {
    s.step([n(), n()]);
    rebound = Math.max(rebound, c.body.linvel().x);
  }
  assert.ok(
    rebound > -0.5 && c.body.translation().x > H.hoopRadius,
    "Solid rim supports car contact",
  );
  c.reset(0, H.hoopZ, 0);
  for (let i = 0; i < 90; i++) s.step([{ ...n(), throttle: 1 }, n()]);
  assert.ok(
    c.body.translation().z < H.hoopZ - 2,
    "Car can drive through net/scoring interior",
  );
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
// The front arc itself is solid, not just the straight wall rails.
for (const sign of [-1, 1]) {
  const { s } = setup();
  const bankColliders: import("@dimforge/rapier3d-compat").Collider[] = [];
  s.world.forEachCollider((c) => {
    if (c.collisionGroups() === HOOPS_NET_GROUP) bankColliders.push(c);
  });
  bankColliders.forEach((c) => s.world.removeCollider(c, true));
  const front = sign * (H.hoopZ - H.hoopRadius);
  s.ball.setTranslation({ x: 0, y: 7, z: front }, true);
  s.ball.setLinvel({ x: 0, y: -9, z: 0 }, true);
  let rimHit = false,
    bounced = false;
  for (let i = 0; i < 110; i++) {
    s.step([n(), n()]);
    rimHit ||= s.hits.some((h) => h.kind === "rim");
    bounced ||= s.ball.linvel().y > 1;
  }
  assert.ok(rimHit && bounced, "Ball hits and rebounds off exposed front arc");
  s.ball.setEnabled(false);
  s.world.gravity = { x: 0, y: 0, z: 0 };
  const c = s.cars[0];
  c.body.setEnabled(true);
  c.reset(0, front - sign * 4, sign > 0 ? Math.PI : 0, H.hoopHeight);
  c.body.setLinvel({ x: 0, y: 0, z: sign * 10 }, true);
  let stopped = false;
  for (let i = 0; i < 50; i++) {
    s.step([n(), n()]);
    stopped ||= c.body.linvel().z * sign < 1;
  }
  assert.ok(
    stopped && c.body.translation().z * sign < Math.abs(front),
    "Car collides with the exposed front rim",
  );
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
// Mode-aware threat prediction and deduplicated shot/save awards.
{
  const { s, m } = setup();
  m.phase = "playing";
  const sample = {
    position: { x: 0, y: 7, z: H.hoopZ },
    velocity: { x: 0, y: -4, z: 0 },
    heat: null,
    mode: "hoops" as const,
    physics: s.physics,
  };
  assert.equal(predictGoal(sample, s.world)!.team, 0);
  assert.equal(
    predictGoal({ ...sample, position: { x: 20, y: 7, z: H.hoopZ } }, s.world),
    null,
  );
  const safe = { ...sample, velocity: { x: 20, y: 5, z: -15 } };
  m.stats!.touch({ playerId: s.cars[1].id, before: safe, after: sample }, s);
  m.stats!.touch({ playerId: s.cars[1].id, before: sample, after: sample }, s);
  assert.equal(m.stats!.players.get(s.cars[1].id)!.shots, 1);
  m.stats!.touch(
    { playerId: s.cars[0].id, before: sample, after: safe, impulseSpeed: 20 },
    s,
  );
  assert.equal(m.stats!.players.get(s.cars[0].id)!.saves, 1);
  s.dispose();
}
// Authority accepts Hoops for uneven rosters, exposes identical mode/map/pads.
for (const teams of [
  [0, 1],
  [0, 0, 1, 1],
  [0, 1, 1],
] as const) {
  const players = teams.map((team, i) => ({
    id: "hoops-" + i,
    name: "Court " + i,
    team,
    controller: "remote" as const,
    preset: starter(),
  }));
  const game = new NetworkMatch(players, "city", undefined, "hoops");
  const snap = game.snapshot();
  assert.equal(snap.arenaId, "hoops");
  assert.equal(snap.gameMode, "hoops");
  assert.ok(
    peerSnapshot(
      snap,
      game.id,
      players.map((p) => p.id),
    ),
  );
  assert.equal(game.pads.items.length, 20);
  game.dispose();
}
// Bot decisions understand elevated attack/defense and provide ordinary input.
for (const difficulty of ["beginner", "intermediate", "advanced"] as const) {
  const players = [0, 0, 1, 1].map((team, i) => ({
    id: "bot-hoops-" + i,
    name: "Bot " + i,
    team: team as 0 | 1,
    controller: "bot" as const,
  }));
  const s = new Simulation(false, players),
    m = new Match();
  m.gameMode = "hoops";
  m.start(s, "network");
  m.phase = "playing";
  s.ball.setTranslation({ x: 0, y: 6, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: -2, z: 0 }, true);
  const bots = new BotTeam(difficulty);
  bots.prepare(s, pads);
  const inputs = bots.inputs(s, pads);
  assert.equal(inputs.size, 4);
  assert.ok(
    [...bots.targets.values()].every(
      (t) => t.shot.y > H.hoopHeight && Math.abs(t.shot.z) === H.hoopZ,
    ),
  );
  if (difficulty !== "beginner")
    assert.ok([...bots.targets.values()].some((t) => t.aerial));
  for (let i = 0; i < 1800 && s.touchSequence === 0; i++) {
    s.step(bots.inputs(s, pads));
    pads.tick(s.cars);
    m.tick(s, pads);
  }
  assert.ok(
    s.touchSequence > 0,
    "Ordinary Hoops bot controls still reach and contact the ball",
  );
  assert.equal(s.containmentRecoveries, 0);
  s.dispose();
}
// Crossing or sitting behind a rim cannot move the camera at all.
for (const sign of [-1, 1]) {
  const frames = (removeRim: boolean) => {
    const { s } = setup();
    if (removeRim) {
      const rims: import("@dimforge/rapier3d-compat").Collider[] = [];
      s.world.forEachCollider((c) => {
        if (c.collisionGroups() === HOOPS_RIM_GROUP) rims.push(c);
      });
      rims.forEach((c) => s.world.removeCollider(c, true));
    }
    s.world.step();
    const camera = new PerspectiveCamera(85, 16 / 9, 0.05, 340),
      rig = new GameCamera(camera),
      car = new Group(),
      ball = new Group();
    rig.ballMode = true;
    const samples: number[][] = [];
    for (let i = 0; i < 180; i++) {
      const t = i / 60;
      car.position.set(
        H.hoopRadius + Math.sin(t * 2),
        H.hoopHeight + Math.sin(t) * 0.6,
        sign * (H.hoopZ - 1),
      );
      ball.position.set(0, H.hoopHeight + 2, sign * (H.hoopZ + 3));
      rig.update(car, ball, s, 1 / 60, false, t);
      samples.push([
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
      ]);
    }
    s.dispose();
    return samples;
  };
  const present = frames(false),
    removed = frames(true);
  present.forEach((sample, i) =>
    sample.forEach((v, k) =>
      assert.ok(
        Math.abs(v - removed[i][k]) < 1e-7,
        "Rim-independent camera path",
      ),
    ),
  );
}
// Shared camera remains finite for overhead/steep motion in the actual court.
{
  const { s } = setup();
  const camera = new PerspectiveCamera(110, 16 / 9, 0.05, 340),
    rig = new GameCamera(camera),
    car = new Group(),
    ball = new Group();
  car.position.set(0, 0.4, 20);
  ball.position.set(0, 15, 20);
  for (let i = 0; i < 120; i++) rig.update(car, ball, s, 1 / 60, false, i / 60);
  assert.ok(
    [...camera.position.toArray(), ...camera.quaternion.toArray()].every(
      Number.isFinite,
    ),
  );
  s.setGameMode("soccar");
  assert.equal(s.gameMode, "soccar");
  s.reset();
  assert.equal(s.cars[0].body.translation().z, 26);
  s.dispose();
}
console.log(
  "PASS Hoops downward sphere scoring A-G, welded shell, mode-specific spawns/pads/countdown/jump ball, mutated radius/gravity, car/net baseline equivalence, two-sided ball/net rebounds, exposed rim bounce rejection, no hidden rear rim, threat/shot/save dedup, authoritative uneven rosters/snapshots, bots, overhead camera and Soccar restoration",
);
