import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Quaternion, Vector3 } from "three";
import {
  kickoffSlots,
  kickoffSpawn,
  soloKickoffs,
  duoKickoffs,
  KickoffBag,
  freeplayKickoffs,
  type KickoffFormation,
} from "../shared/kickoff";
import { Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { P } from "../src/config/physics";
import { insideArena } from "../src/arena/physics";
import { bodies } from "../shared/catalog";
import { neutralInput, type PlayerEntity } from "../shared/player";
import { Opponent } from "../src/ai/opponent";

await RAPIER.init();
const close = (a: number, b: number, epsilon = 1e-5) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function verify(s: Simulation, formation: KickoffFormation) {
  s.reset(formation);
  assert.deepEqual(
    { ...s.ball.translation() },
    {
      x: 0,
      y: Math.fround(P.ball.radius + 0.02),
      z: 0,
    },
  );
  assert.deepEqual({ ...s.ball.linvel() }, { x: 0, y: 0, z: 0 });
  assert.deepEqual({ ...s.ball.angvel() }, { x: 0, y: 0, z: 0 });
  const teams = [0, 1].map((t) => s.cars.filter((c) => c.team === t));
  for (let slot = 0; slot < formation.slots.length; slot++) {
    const blue = teams[0][slot],
      orange = teams[1][slot];
    const p = blue.body.translation(),
      other = orange.body.translation();
    close(p.x, -other.x);
    close(p.z, -other.z);
    close(p.y, other.y);
    close(
      new Vector3().copy(p).distanceTo(s.ball.translation()),
      new Vector3().copy(other).distanceTo(s.ball.translation()),
    );
    for (const car of [blue, orange]) {
      const q = new Quaternion().copy(car.body.rotation());
      const forward = new Vector3(0, 0, -1).applyQuaternion(q);
      const center = new Vector3(
        -car.body.translation().x,
        0,
        -car.body.translation().z,
      ).normalize();
      assert.ok(forward.dot(center) > 0.999999);
      assert.deepEqual({ ...car.body.linvel() }, { x: 0, y: 0, z: 0 });
      assert.deepEqual({ ...car.body.angvel() }, { x: 0, y: 0, z: 0 });
      const model = new Group();
      car.pose.render(model, 1);
      assert.ok(model.position.distanceTo(car.body.translation()) < 1e-6);
      assert.ok(model.quaternion.normalize().angleTo(q.normalize()) < 1e-6);
      const d = bodies[car.bodyId];
      for (const x of [-d.halfWidth, d.halfWidth])
        for (const y of [d.hitboxY - d.halfHeight, d.hitboxY + d.halfHeight])
          for (const z of [-d.halfLength, d.halfLength])
            assert.ok(
              insideArena(
                s.arenaCollider!,
                new Vector3(x, y, z)
                  .applyQuaternion(q)
                  .add(car.body.translation()),
                0.001,
              ),
            );
    }
  }
  for (let i = 0; i < s.cars.length; i++)
    for (let j = i + 1; j < s.cars.length; j++)
      assert.ok(
        new Vector3()
          .copy(s.cars[i].body.translation())
          .distanceTo(s.cars[j].body.translation()) > 2,
      );
}
const roster: PlayerEntity[] = Array.from({ length: 4 }, (_, i) => ({
  id: `kickoff-${i}`,
  name: `Driver ${i}`,
  team: (i % 2) as 0 | 1,
  controller: i % 2 ? "bot" : "local",
}));
const solo = new Simulation(false, roster.slice(0, 2)),
  duo = new Simulation(false, roster);
try {
  for (const s of [solo, duo])
    s.cars.forEach((c, i) => c.setBody(i % 2 ? "vector" : "ion"));
  for (const formation of soloKickoffs) verify(solo, formation);
  for (const formation of duoKickoffs) verify(duo, formation);
  console.log(
    "PASS all five solo and eight duo formations: mirroring, clearance, facing, poses and zero velocities",
  );
  for (const slot of Object.keys(
    kickoffSlots,
  ) as (keyof typeof kickoffSlots)[]) {
    const arena = { halfWidth: 61.44, halfLength: 40.96 };
    const normal = kickoffSpawn(slot, 0, P.arena),
      scaled = kickoffSpawn(slot, 0, arena);
    close(normal.x / P.arena.halfWidth, scaled.x / arena.halfWidth);
    close(normal.z / P.arena.halfLength, scaled.z / arena.halfLength);
    const direction = new Vector3(0, 0, -1).applyAxisAngle(
      new Vector3(0, 1, 0),
      scaled.yaw,
    );
    assert.ok(
      direction.dot(new Vector3(-scaled.x, 0, -scaled.z).normalize()) >
        0.999999,
    );
  }
  console.log(
    "PASS independent arena-axis scaling and mathematically calculated heading",
  );
  for (const [size, formations] of [
    [1, soloKickoffs],
    [2, duoKickoffs],
  ] as const) {
    const bag = new KickoffBag(() => 0.375);
    let previous = "";
    for (let cycle = 0; cycle < 10; cycle++) {
      const seen = new Set<string>();
      for (let i = 0; i < formations.length; i++) {
        const chosen = bag.next(size);
        assert.notEqual(chosen.id, previous);
        assert.ok(!seen.has(chosen.id));
        seen.add(chosen.id);
        previous = chosen.id;
      }
      assert.equal(seen.size, formations.length);
    }
  }
  console.log(
    "PASS shuffle bags use every formation and avoid consecutive repeats across reshuffles",
  );
  const m = new Match();
  m.start(solo, "bot");
  const first = m.kickoffFormationId;
  for (const car of solo.cars) {
    assert.equal(car.boost, P.match.kickoffBoost);
    car.steerAtKickoff({ ...neutralInput(), steer: 1 });
  }
  const locked = solo.cars.map((c) => ({
    p: { ...c.body.translation() },
    q: { ...c.body.rotation() },
  }));
  for (let i = 0; i < 360; i++) m.tick(solo);
  assert.equal(m.phase, "playing");
  solo.cars.forEach((c, i) => {
    assert.deepEqual({ ...c.body.translation() }, locked[i].p);
    assert.deepEqual({ ...c.body.rotation() }, locked[i].q);
    assert.ok(Math.abs(c.steerAngle) > 0.2);
    assert.equal(c.boost, P.match.kickoffBoost);
  });
  solo.ball.setTranslation({ x: 0, y: 1, z: -P.arena.halfLength - 2 }, true);
  m.tick(solo);
  assert.equal(m.phase, "goal");
  while (m.phase === "goal") m.tick(solo);
  assert.notEqual(m.kickoffFormationId, first);
  assert.equal(m.phase, "countdown");
  assert.deepEqual(m.score, [1, 0]);
  solo.cars.forEach((c) => assert.equal(c.boost, P.match.kickoffBoost));
  const afterGoal = m.kickoffFormationId;
  m.start(solo, "bot");
  assert.notEqual(m.kickoffFormationId, afterGoal);
  assert.deepEqual(m.score, [0, 0]);
  m.start(solo, "freeplay");
  const practice = solo.cars.map((c) => ({ ...c.body.translation() }));
  for (let i = 0; i < 10; i++) {
    m.kickoff(solo);
    const formation = freeplayKickoffs[(i + 1) % freeplayKickoffs.length];
    assert.equal(m.kickoffFormationId, formation.id);
    assert.equal(m.phase, "playing");
    const spawn = kickoffSpawn(formation.slots[0], 0, P.arena);
    close(solo.cars[0].body.translation().x, spawn.x);
    close(solo.cars[0].body.translation().z, spawn.z);
  }
  const firstPractice = kickoffSpawn(freeplayKickoffs[0].slots[0], 0, P.arena);
  close(practice[0].x, firstPractice.x);
  close(practice[0].z, firstPractice.z);
  console.log(
    "PASS countdown steering/lock, goal reset, boost, restart and predictable Free Play",
  );
  // Real bot controller and unchanged car physics, from every canonical slot.
  solo.ball.setEnabled(false);
  for (const formation of soloKickoffs) {
    solo.reset(formation);
    solo.cars[0].body.setEnabled(false);
    solo.cars[1].body.setEnabled(true);
    solo.cars[1].collider.setCollisionGroups(0xffffffff);
    solo.cars[1].boost = P.match.kickoffBoost;
    const bot = new Opponent();
    let closest = Infinity;
    for (let i = 0; i < 1200; i++) {
      const input = bot.sample(
        solo.cars[1],
        { x: 0, y: P.ball.radius, z: 0 },
        solo.clock,
      );
      solo.step([neutralInput(), input]);
      const p = solo.cars[1].body.translation();
      closest = Math.min(closest, Math.hypot(p.x, p.z));
      if (closest < 3) break;
    }
    assert.ok(closest < 3, `${formation.id}: bot closest ${closest}`);
    assert.equal(solo.containmentRecoveries, 0);
    console.log("PASS bot reaches midfield from", formation.id, closest);
  }
} finally {
  solo.dispose();
  duo.dispose();
}
