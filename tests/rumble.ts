import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { Rumble } from "../src/game/rumble";
import { RUMBLE_CONFIG as R } from "../src/config/rumble";
import { P } from "../src/config/physics";
import { bodies } from "../shared/catalog";
import { neutralInput as neutral } from "../shared/player";
import { rumbleItems, rumbleSnapshotSchema } from "../shared/rumble";
import { ReplayRecorder } from "../src/replay/recorder";
await initializeSimulation();
const roster = [
  {
    id: "pilot-a",
    name: "Same name",
    team: 0 as const,
    controller: "local" as const,
  },
  {
    id: "pilot-b",
    name: "Same name",
    team: 1 as const,
    controller: "remote" as const,
  },
];
const fixture = () => {
  const s = new Simulation(true, roster);
  s.setGameMode("rumble");
  s.world.gravity = { x: 0, y: 0, z: 0 };
  s.cars[0].reset(0, 0, 0, 12);
  s.cars[1].reset(35, 35, 0, 12);
  s.ball.setTranslation({ x: 0, y: 12, z: -10 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  s.rumble!.setPhase(true, true);
  return s;
};
const tick = (s: Simulation, count: number, input = neutral()) => {
  for (let i = 0; i < count; i++) s.step([input, neutral()]);
};
{
  const s = fixture(),
    r = s.rumble!;
  assert.equal(r.players.get("pilot-a")!.cooldown, 10);
  tick(s, 1199);
  assert.equal(r.players.get("pilot-a")!.phase, "cooldown");
  tick(s, 1);
  assert.equal(r.players.get("pilot-a")!.phase, "ready");
  const held = r.players.get("pilot-a")!.item;
  tick(s, 2400);
  assert.equal(r.players.get("pilot-a")!.item, held, "Holding never rerolls");
  assert.equal(r.players.get("pilot-b")!.phase, "ready");
  assert.equal(r.grant("pilot-a", "HAYMAKER"), false, "Cannot stack/replace");
  r.end("pilot-a");
  r.grant("pilot-a", "HAYMAKER");
  s.ball.setTranslation({ x: 0, y: 12, z: -10 }, true);
  tick(s, 1, { ...neutral(), usePowerup: true });
  assert.equal(r.players.get("pilot-a")!.phase, "cooldown");
  tick(s, 1300, { ...neutral(), usePowerup: true });
  assert.equal(
    r.players.get("pilot-a")!.phase,
    "ready",
    "Held activation cannot auto-use the next grant",
  );
  assert.equal(
    r.players.get("pilot-b")!.phase,
    "ready",
    "Other player cooldown is independent",
  );
  assert.ok(rumbleSnapshotSchema.safeParse(r.snapshot()).success);
  s.dispose();
}
for (const offset of [
  new Vector3(12, 0, 0),
  new Vector3(0, 12, 0),
  new Vector3(0, 0, -12),
]) {
  const s = fixture(),
    r = s.rumble!,
    car = s.cars[0];
  r.grant(car.id, "HAYMAKER");
  s.ball.setTranslation(
    new Vector3().copy(car.body.translation()).addScaledVector(offset, 3),
    true,
  );
  assert.equal(r.use(car.id), false);
  assert.equal(r.players.get(car.id)!.phase, "ready");
  s.ball.setTranslation(
    new Vector3().copy(car.body.translation()).add(offset),
    true,
  );
  const before = new Vector3(3, 2, 4);
  s.ball.setLinvel(before, true);
  s.ball.setAngvel({ x: 0.4, y: 0.5, z: 0.6 }, true);
  assert.ok(r.use(car.id));
  const expected = before
    .clone()
    .addScaledVector(
      offset.clone().normalize(),
      R.haymaker.impulse / P.ball.mass,
    );
  assert.ok(
    expected.distanceTo(s.ball.linvel()) < 1e-4,
    "Haymaker adds current player-to-ball impulse",
  );
  assert.equal(s.ball.angvel().x, Math.fround(0.4));
  tick(s, 1);
  assert.ok(
    new Vector3().copy(s.ball.linvel()).length() <= P.ball.maxSpeed + 0.001,
  );
  s.dispose();
}
{
  const s = fixture(),
    r = s.rumble!,
    car = s.cars[0];
  r.grant(car.id, "GRAPPLING_HOOK");
  assert.ok(r.use(car.id));
  const ballBefore = { ...s.ball.linvel() };
  r.beforeStep([neutral(), neutral()]);
  assert.deepEqual(
    { ...s.ball.linvel() },
    ballBefore,
    "Grapple has no ball force",
  );
  assert.ok(car.body.linvel().z < 0);
  s.ball.setTranslation({ x: 12, y: 15, z: 0 }, true);
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  r.beforeStep([neutral(), neutral()]);
  assert.ok(
    car.body.linvel().x > 0 && car.body.linvel().y > 0,
    "Moving target is followed",
  );
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  s.ball.setTranslation({ x: 0, y: 12, z: -7 }, true);
  tick(s, 180);
  assert.equal(r.players.get(car.id)!.phase, "cooldown");
  assert.ok(s.touchSequence > 0, "Real physical collision ended grapple");
  assert.ok(
    new Vector3().copy(s.ball.linvel()).length() > 1,
    "Normal collision changed ball momentum",
  );
  s.dispose();
}
{
  const s = fixture(),
    r = s.rumble!,
    car = s.cars[0];
  r.grant(car.id, "PLUNGER");
  s.ball.setLinvel({ x: 8, y: 0, z: 0 }, true);
  const carBefore = { ...car.body.linvel() };
  assert.ok(r.use(car.id));
  r.beforeStep([neutral(), neutral()]);
  assert.deepEqual(
    { ...car.body.linvel() },
    carBefore,
    "Plunger has no car force",
  );
  assert.equal(s.ball.linvel().x, 8);
  assert.ok(
    s.ball.linvel().z > 0,
    "Sideways momentum remains while trajectory starts curving",
  );
  car.body.setTranslation({ x: 15, y: 12, z: -10 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  r.beforeStep([neutral(), neutral()]);
  assert.ok(s.ball.linvel().x > 0, "Attraction uses moving car position");
  s.dispose();
  const p = fixture();
  p.rumble!.grant("pilot-a", "PLUNGER");
  p.rumble!.use("pilot-a");
  tick(p, 500);
  assert.ok(p.touchSequence > 0, "Plunger ends on a real car contact");
  assert.equal(p.rumble!.players.get("pilot-a")!.phase, "cooldown");
  p.dispose();
}
function strike(power: boolean) {
  const s = fixture(),
    r = s.rumble!,
    car = s.cars[0];
  car.reset(0, 0, 0);
  s.ball.setTranslation({ x: 0, y: P.ball.radius + 0.02, z: -5 }, true);
  car.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
  if (power) {
    r.grant(car.id, "POWER_HITTER");
    r.use(car.id);
  }
  let speed = 0;
  for (let i = 0; i < 45; i++) {
    s.step([neutral(), neutral()]);
    speed = Math.max(speed, new Vector3().copy(s.ball.linvel()).length());
  }
  s.dispose();
  return speed;
}
assert.ok(
  strike(true) > strike(false) * 1.5,
  "Power Hitter increases a real distinct collision",
);
{
  const s = fixture(),
    r = s.rumble!;
  r.grant("pilot-a", "POWER_HITTER");
  r.use("pilot-a");
  s.cars[0].reset(0, 0, 0);
  s.cars[1].reset(0, -1.4, Math.PI);
  s.cars[0].body.setLinvel({ x: 0, y: 0, z: -3 }, true);
  tick(s, 50);
  assert.equal(
    s.cars[1].demolitionState,
    "demolished",
    "Slow opponent collision demos",
  );
  assert.equal(s.demolitions.filter((e) => e.victimId === "pilot-b").length, 1);
  s.dispose();
  const friendly = fixture();
  friendly.cars[1].team = 0;
  friendly.rumble!.grant("pilot-a", "POWER_HITTER");
  friendly.rumble!.use("pilot-a");
  friendly.cars[0].reset(0, 0, 0);
  friendly.cars[1].reset(0, -1.4, Math.PI);
  friendly.cars[0].body.setLinvel({ x: 0, y: 0, z: -3 }, true);
  tick(friendly, 50);
  assert.equal(friendly.cars[1].demolitionState, "active");
  friendly.dispose();
  const expiry = fixture();
  expiry.rumble!.grant("pilot-a", "POWER_HITTER");
  expiry.rumble!.use("pilot-a");
  tick(expiry, 721);
  assert.equal(expiry.rumble!.powerHitter("pilot-a"), false);
  assert.ok(expiry.rumble!.players.get("pilot-a")!.cooldown > 9.9);
  expiry.dispose();
}
for (const body of ["ion", "vector"] as const)
  for (const side of ["roof", "side", "front", "underside"]) {
    const s = fixture(),
      r = s.rumble!,
      car = s.cars[0];
    car.setBody(body);
    car.reset(0, 0, 0, 12);
    const d = bodies[body];
    const local =
      side === "roof"
        ? new Vector3(0, d.hitboxY + d.halfHeight + P.ball.radius - 0.02, 0)
        : side === "underside"
          ? new Vector3(0, d.hitboxY - d.halfHeight - P.ball.radius + 0.02, 0)
          : side === "side"
            ? new Vector3(d.halfWidth + P.ball.radius - 0.02, d.hitboxY, 0)
            : new Vector3(0, d.hitboxY, -d.halfLength - P.ball.radius + 0.02);
    s.ball.setTranslation(local.clone().add(car.body.translation()), true);
    r.grant(car.id, "SPIKES");
    r.use(car.id);
    tick(s, 3);
    const attachment = r.players.get(car.id)!.attachment;
    assert.ok(attachment, body + " " + side + " real contact attachment");
    if (side === "side") assert.ok(attachment.local.x > 1);
    if (side === "front") assert.ok(attachment.local.z < -1);
    if (side === "underside") assert.ok(attachment.local.y < 0);
    if (side === "roof") assert.ok(attachment.local.y > 1);
    for (let i = 0; i < 90; i++) {
      s.step([{ ...neutral(), roll: 0.6, pitch: 0.2 }, neutral()]);
      const expected = new Vector3()
        .copy(attachment.local)
        .applyQuaternion(car.body.rotation())
        .add(car.body.translation());
      assert.ok(
        expected.distanceTo(s.ball.translation()) < 0.16,
        "Rigid local attachment follows aerial translation/rotation",
      );
    }
    car.body.setLinvel({ x: 4, y: 1, z: 2 }, true);
    car.body.setAngvel({ x: 0.3, y: 0.4, z: 0.5 }, true);
    const expected = new Vector3()
      .copy(car.body.angvel())
      .cross(new Vector3().copy(s.ball.translation()).sub(car.body.worldCom()))
      .add(car.body.linvel());
    r.end(car.id);
    assert.ok(
      expected.distanceTo(s.ball.linvel()) < 1e-5,
      "Release retains contact velocity",
    );
    assert.equal(r.players.get(car.id)!.attachment, undefined);
    assert.ok(s.ball.isDynamic());
    s.dispose();
  }
{
  const s = fixture(),
    r = s.rumble!,
    car = s.cars[0],
    d = bodies[car.bodyId];
  s.ball.setTranslation(
    { x: 0, y: 12 + d.hitboxY + d.halfHeight + P.ball.radius - 0.02, z: 0 },
    true,
  );
  r.grant(car.id, "SPIKES");
  r.use(car.id);
  tick(s, 3);
  assert.ok(r.players.get(car.id)!.attachment);
  r.grant("pilot-b", "HAYMAKER");
  s.cars[1].reset(8, 0, 0, 12);
  r.use("pilot-b");
  assert.ok(
    r.players.get(car.id)!.attachment,
    "Initial protection keeps normal/strong punch attached",
  );
  r.players.get(car.id)!.attachment!.age = R.spikes.protection + 0.1;
  const release = new Vector3()
    .copy(car.body.angvel())
    .cross(new Vector3().copy(s.ball.translation()).sub(car.body.worldCom()))
    .add(car.body.linvel());
  const punch = new Vector3()
    .copy(s.ball.translation())
    .sub(s.cars[1].body.translation())
    .normalize()
    .multiplyScalar(R.haymaker.impulse / P.ball.mass);
  const punchedRelease = release.add(punch);

  r.grant("pilot-b", "HAYMAKER");
  r.use("pilot-b");
  assert.equal(r.players.get(car.id)!.attachment, undefined);
  assert.ok(
    punchedRelease.distanceTo(s.ball.linvel()) < 1e-5,
    "Breaking Spikes preserves both release velocity and the full incoming punch impulse",
  );
  assert.equal(
    r.players.get(car.id)!.phase,
    "cooldown",
    "Broken spikes are consumed, not reattached next tick",
  );
  for (let i = 0; i < 60; i++) s.step([neutral(), neutral()]);
  assert.ok(Object.values(s.ball.translation()).every(Number.isFinite));
  s.reset();
  assert.ok(
    [...r.players.values()].every(
      (st) => st.cooldown === 10 && st.item === null && !st.attachment,
    ),
  );
  s.dispose();
}
{
  const s = fixture(),
    m = new Match();
  m.gameMode = "rumble";
  m.start(s, "bot");
  m.phase = "playing";
  m.remaining = 0;
  s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
  m.tick(s);
  const r = s.rumble!;
  r.grant("pilot-a", "HAYMAKER");
  s.cars[0].reset(0, 5, 0, 10);
  s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
  assert.ok(r.use("pilot-a"), "Held item usable at zero");
  tick(s, 1300);
  assert.equal(
    r.players.get("pilot-a")!.phase,
    "cooldown",
    "Zero-second play cannot grant endless new powers",
  );
  m.finish();
  assert.equal(r.running, false);
  assert.ok([...r.players.values()].every((st) => st.item === null));
  s.dispose();
}
{
  const s = fixture(),
    r = s.rumble!,
    rec = new ReplayRecorder();
  r.grant("pilot-a", "POWER_HITTER");
  r.use("pilot-a");
  for (let i = 0; i < 140; i++) {
    s.step([neutral(), neutral()]);
    rec.capture(s, 1);
  }
  const clip = rec.clip({
    id: "r",
    time: s.clock,
    scorerId: "pilot-a",
    team: 0,
    ownGoal: false,
    lastTouchId: "pilot-a",
    touchTime: s.clock,
    ballSpeed: 0,
    focus: { x: 0, y: 12, z: 0 },
  });
  assert.ok(
    clip.rumble?.some((e) => e.state.players[0].item === "POWER_HITTER"),
  );
  r.reset();
  assert.equal(
    clip.rumble!.at(-1)!.state.players[0].phase,
    "active",
    "Replay is an independent immutable state copy",
  );
  s.dispose();
}

// Powered cars retain ordinary vulnerability; contact outcomes are decided together.
{
  const s = fixture(),
    r = s.rumble!;
  r.grant("pilot-a", "POWER_HITTER");
  r.use("pilot-a");
  s.cars[0].reset(0, 0, 0);
  s.cars[1].reset(0, -5, Math.PI);
  s.cars[1].body.setLinvel({ x: 0, y: 0, z: 23 }, true);
  tick(s, 45, { ...neutral(), throttle: 0 });
  assert.equal(
    s.cars[0].demolitionState,
    "demolished",
    "Power Hitter is still vulnerable to a normal supersonic bumper demo",
  );
  assert.equal(s.cars[1].demolitionState, "demolished");
  s.dispose();
}
// Keeping contact cannot multiply impulses every tick.
{
  const s = fixture(),
    r = s.rumble!;
  r.grant("pilot-a", "POWER_HITTER");
  r.use("pilot-a");
  const before = new Vector3().copy(s.ball.linvel());
  r.contact(
    s.cars[0],
    new Vector3(0, 12, -1),
    new Vector3(0, 0, -1),
    100,
    false,
  );
  assert.equal(before.distanceTo(s.ball.linvel()), 0);
  s.dispose();
}
// Rumble with no active abilities is the same existing vehicle/ball simulation.
{
  const a = new Simulation(true, roster),
    b = new Simulation(true, roster);
  b.setGameMode("rumble");
  b.rumble!.setPhase(true, true);
  for (let i = 0; i < 600; i++) {
    const input = {
      ...neutral(),
      throttle: 1,
      boost: i < 400,
      powerslide: i > 450,
      yaw: i > 450 ? 0.6 : 0,
    };
    a.step([input, neutral()]);
    b.step([input, neutral()]);
    assert.deepEqual(
      { ...a.cars[0].body.translation() },
      { ...b.cars[0].body.translation() },
    );
    assert.deepEqual(
      { ...a.cars[0].body.rotation() },
      { ...b.cars[0].body.rotation() },
    );
    assert.deepEqual({ ...a.ball.linvel() }, { ...b.ball.linvel() });
  }
  a.dispose();
  b.dispose();
}
// Goal captures effects before clearing them, scores once, and replay never executes powers.
{
  const s = fixture(),
    m = new Match();
  m.gameMode = "rumble";
  m.start(s, "network");
  m.phase = "playing";
  for (let i = 0; i < 300; i++) {
    s.step([neutral(), neutral()]);
    m.tick(s);
  }
  const r = s.rumble!;
  r.grant("pilot-a", "POWER_HITTER");
  r.setPhase(true, true);
  r.use("pilot-a");
  for (let i = 0; i < 60; i++) {
    s.step([neutral(), neutral()]);
    m.tick(s);
  }
  s.lastTouchId = "pilot-a";
  s.lastTouchTime = s.clock;
  s.ball.setTranslation({ x: 0, y: 2, z: -P.arena.halfLength - 1.4 }, true);
  m.tick(s);
  assert.equal(m.phase, "goal");
  assert.equal(m.score[0], 1);
  assert.ok(
    [...r.players.values()].every((st) => !st.item && st.cooldown === 10),
  );
  const scores = JSON.stringify(m.stats!.snapshot());
  for (let i = 0; i < Math.ceil(P.match.celebration / P.dt) + 1; i++) {
    s.step([neutral(), neutral()]);
    m.tick(s);
  }
  assert.equal(m.phase, "replay");
  assert.ok(
    m.replay!.clip.rumble!.some((e) =>
      e.state.players.some((st) => st.item === "POWER_HITTER"),
    ),
  );
  const time = s.clock;
  for (let i = 0; i < 100; i++) m.tick(s);
  assert.equal(s.clock, time);
  assert.equal(JSON.stringify(m.stats!.snapshot()), scores);
  const replayId = m.replay!.clip.goal.id;
  m.skipReplay("pilot-a", replayId, s);
  m.skipReplay("pilot-b", replayId, s);
  assert.equal(m.phase, "countdown");
  assert.equal(m.stats!.snapshot()[0].goals, 1);
  assert.ok([...r.players.values()].every((st) => st.cooldown === 10));
  s.dispose();
}

// Expiry/demolition release a real carrier; other powers cannot corrupt its joint.
for (const interaction of [
  "expiry",
  "demo",
  "GRAPPLING_HOOK",
  "PLUNGER",
  "HAYMAKER",
] as const) {
  const s = fixture(),
    r = s.rumble!,
    car = s.cars[0],
    d = bodies[car.bodyId];
  s.ball.setTranslation(
    { x: 0, y: 12 + d.hitboxY + d.halfHeight + P.ball.radius - 0.02, z: 0 },
    true,
  );
  r.grant(car.id, "SPIKES");
  r.use(car.id);
  tick(s, 3);
  assert.ok(r.players.get(car.id)!.attachment);
  if (interaction === "expiry") {
    tick(s, Math.ceil(R.spikes.duration / P.dt));
    assert.equal(r.players.get(car.id)!.attachment, undefined);
    assert.equal(r.players.get(car.id)!.phase, "cooldown");
    assert.ok(r.players.get(car.id)!.cooldown > 9.9);
  } else if (interaction === "demo") {
    r.grant("pilot-b", "POWER_HITTER");
    r.use("pilot-b");
    s.cars[1].reset(0, -1.4, Math.PI, 12);
    s.cars[1].body.setLinvel({ x: 0, y: 0, z: 3 }, true);
    tick(s, 40);
    assert.equal(car.demolitionState, "demolished");
    assert.equal(r.players.get(car.id)!.attachment, undefined);
  } else {
    s.cars[1].reset(8, 0, Math.PI, 12);
    r.grant("pilot-b", interaction);
    r.use("pilot-b");
    tick(s, 180);
  }
  assert.ok(s.ball.isDynamic());
  assert.ok(Object.values(s.ball.translation()).every(Number.isFinite));
  assert.ok(Object.values(s.ball.linvel()).every(Number.isFinite));
  assert.ok(Object.values(car.body.translation()).every(Number.isFinite));
  assert.equal(
    s.containmentRecoveries,
    0,
    interaction + " stays in the arena without backstop resets",
  );
  s.dispose();
}
console.log(
  "PASS Rumble independent 10-second timers/held items/edges, player-to-ball impulses/caps, moving grapple/car-only force and real collision, curved plunger/ball-only force, stronger hits/slow enemy demos/friendly safety/expiry, both-body four-sided spike joints/rotation/release/protection/break/reset, zero-second and replay isolation",
);
