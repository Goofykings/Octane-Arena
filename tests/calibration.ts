import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { Simulation } from "../src/physics/simulation";
import { neutral, type Controls } from "../src/input/types";
import { P, curvature } from "../src/config/physics";
import { FixedLoop } from "../src/physics/loop";
import { Match } from "../src/game/match";
import { Pads } from "../src/game/pads";
import { Opponent } from "../src/ai/opponent";
import { writeFileSync, mkdirSync } from "node:fs";
await RAPIER.init();
const results: { name: string; value: unknown; pass: boolean }[] = [];
function record(name: string, value: unknown, pass: boolean) {
  results.push({ name, value, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(value)}`);
}
function setup(flat = true) {
  const s = new Simulation(flat);
  s.cars[0].reset(0, 0, 0);
  s.cars[1].reset(100, 100, 0);
  s.ball.setTranslation({ x: 100, y: 1, z: 100 }, true);
  for (let i = 0; i < 120; i++) s.step([neutral(), neutral()]);
  return s;
}
function run(
  s: Simulation,
  seconds: number,
  c: Partial<Controls> | ((t: number) => Partial<Controls>),
) {
  for (let i = 0; i < Math.round(seconds / P.dt); i++)
    s.step([
      { ...neutral(), ...(typeof c === "function" ? c(i * P.dt) : c) },
      neutral(),
    ]);
}
const speed = (s: Simulation) =>
  new Vector3().copy(s.cars[0].body.linvel()).length();
for (const boost of [false, true]) {
  const s = setup();
  run(s, 3, { throttle: 1, boost });
  record(
    boost ? "boost top speed" : "throttle top speed",
    speed(s),
    Math.abs(speed(s) - (boost ? 23 : 14.1)) < 0.3,
  );
  s.dispose();
}
for (const braking of [false, true]) {
  const s = setup();
  s.cars[0].body.setLinvel({ x: 0, y: 0, z: -14 }, true);
  run(s, 0.25, { throttle: braking ? -1 : 0 });
  const expected = 14 - (braking ? 35 : 5.25) * 0.25;
  record(
    braking ? "braking" : "coasting",
    speed(s),
    Math.abs(speed(s) - expected) < 0.2,
  );
  s.dispose();
}
for (const velocity of [5, 10, 20]) {
  const s = setup();
  s.cars[0].body.setLinvel({ x: 0, y: 0, z: -velocity }, true);
  run(s, 0.4, { throttle: 0.02, steer: 1 });
  const c = s.cars[0],
    v = Math.abs(c.forwardSpeed),
    yaw = Math.abs(c.body.angvel().y),
    radius = v / yaw;
  record(
    `turning radius at ${velocity} m/s`,
    { radius, target: 1 / curvature(v) },
    Math.abs(radius * curvature(v) - 1) < 0.2,
  );
  s.dispose();
}
const heights: number[] = [];
for (const kind of ["tap", "hold", "double"]) {
  const s = setup();
  let height = 0;
  run(s, 2.5, (t) => {
    height = Math.max(height, s.cars[0].body.translation().y);
    return {
      jump:
        kind === "tap"
          ? t < P.dt
          : kind === "hold"
            ? t < 0.2
            : t < 0.2 || (t > 0.3 && t < 0.35),
    };
  });
  heights.push(height);
  record(`${kind} jump apex`, height, Number.isFinite(height) && height > 0.7);
  s.dispose();
}
record(
  "jump heights increase",
  heights,
  heights[1] > heights[0] + 0.5 && heights[2] > heights[1] + 1,
);
{
  const s = setup();
  run(s, 2, { boost: true });
  record(
    "boost consumption over 2s",
    s.cars[0].boost,
    Math.abs(s.cars[0].boost - 33.4) < 0.02,
  );
  s.dispose();
}
{
  const s = setup();
  s.ball.setTranslation({ x: 0, y: 10, z: 20 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  run(s, 0.5, {});
  record(
    "ball free fall after .5s",
    s.ball.translation().y,
    Math.abs(s.ball.translation().y - 9.1875) < 0.03,
  );
  let previous = 0,
    ratio = 0;
  for (let i = 0; i < 240; i++) {
    previous = s.ball.linvel().y;
    s.step([neutral(), neutral()]);
    if (previous < -1 && s.ball.linvel().y > 0) {
      ratio = s.ball.linvel().y / -previous;
      break;
    }
  }
  record("calmer ball bounce restitution", ratio, ratio > 0.45 && ratio < 0.51);
  s.dispose();
}
for (const v of [2, 10, 20])
  for (const side of [false, true]) {
    const s = setup();
    s.ball.setTranslation(
      { x: side ? 0.95 : 0, y: P.ball.radius, z: -3 },
      true,
    );
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.cars[0].body.setLinvel({ x: 0, y: 0, z: -v }, true);
    run(s, Math.min(2, 3 / v + 0.2), { throttle: 0.02 });
    const ballSpeed = new Vector3().copy(s.ball.linvel()).length();
    record(
      `${side ? "glancing" : "front"} strike ${v} m/s`,
      ballSpeed,
      ballSpeed > v * 0.4 &&
        ballSpeed < 42.01 &&
        (side || v < 10 || ballSpeed < v * 1.6),
    );
    s.dispose();
  }
{
  const s = setup(false);
  s.cars[0].reset(27, 0, -Math.PI / 2);
  let maxY = 0,
    wallContacts = 0;
  run(s, 2.8, () => {
    const c = s.cars[0];
    maxY = Math.max(maxY, c.body.translation().y);
    if (c.normal.y < 0.5 && c.grounded) wallContacts++;
    return { throttle: 1, boost: true };
  });
  record(
    "floor to vertical wall driving",
    { maxY, wallContacts },
    maxY > 5 && wallContacts > 10,
  );
  s.dispose();
}
const snapshots: number[][] = [];
for (const fps of [30, 60, 144]) {
  const s = setup();
  const loop = new FixedLoop();
  let tick = 0;
  for (let f = 0; f < fps * 2; f++)
    loop.advance(1 / fps, () => {
      s.step([
        {
          ...neutral(),
          throttle: 1,
          steer: tick > 120 ? 0.4 : 0,
          jump: tick > 60 && tick < 80,
        },
        neutral(),
      ]);
      tick++;
    });
  const p = s.cars[0].body.translation();
  snapshots.push([p.x, p.y, p.z, tick]);
  s.dispose();
}
record(
  "frame rate independent transforms 30/60/144",
  snapshots,
  snapshots.every((p) =>
    p.every((v, i) => Math.abs(v - snapshots[0][i]) < 1e-5),
  ),
);
{
  const s = setup();
  run(s, 3, { throttle: -1 });
  record("reverse throttle cap", speed(s), Math.abs(speed(s) - 14.1) < 0.1);
  s.dispose();
}
for (const dir of [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
]) {
  const s = setup();
  run(s, 0.2, { jump: true });
  run(s, 0.05, {});
  s.step([
    { ...neutral(), jump: true, steer: dir[0], throttle: dir[1] },
    neutral(),
  ]);
  const v = s.cars[0].body.linvel(),
    w = s.cars[0].body.angvel();
  record(
    `dodge direction ${dir}`,
    { x: v.x, z: v.z, angular: Math.hypot(w.x, w.y, w.z) },
    v.x * dir[0] - v.z * dir[1] > 4 && Math.hypot(w.x, w.y, w.z) > 0.5,
  );
  s.dispose();
}
{
  const s = setup();
  run(s, 0.2, { jump: true });
  run(s, 0.05, {});
  run(s, 0.03, { jump: true });
  run(s, 0.05, {});
  const before = s.cars[0].body.linvel().y;
  run(s, P.dt, { jump: true });
  record(
    "third jump rejected",
    { before, after: s.cars[0].body.linvel().y },
    s.cars[0].body.linvel().y < before,
  );
  run(s, 3, {});
  run(s, P.dt, { jump: true });
  record(
    "landing restores jump",
    s.cars[0].body.linvel().y,
    s.cars[0].body.linvel().y > 2,
  );
  s.dispose();
}
{
  const s = setup();
  run(s, 0.025, { jump: true });
  s.cars[0].body.setTranslation({ x: 0, y: 10, z: 0 }, true);
  run(s, 1.35, {});
  run(s, P.dt, { jump: true });
  record(
    "expired aerial window",
    {
      used: s.cars[0].jump.used,
      second: s.cars[0].jump.second,
      age: s.cars[0].jump.age,
    },
    s.cars[0].jump.used && !s.cars[0].jump.second && s.cars[0].jump.age > 1.3,
  );
  s.dispose();
}
{
  const s = setup();
  s.cars[0].reset(0, 0, 0, 10);
  s.cars[0].body.setRotation(
    { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
    true,
  );
  run(s, 0.25, { boost: true });
  const v = s.cars[0].body.linvel();
  record(
    "air boost follows nose",
    { x: v.x, y: v.y, z: v.z },
    v.y > 0.8 && Math.abs(v.z) < 0.1,
  );
  s.dispose();
}
{
  const s = setup(false);
  s.ball.setTranslation({ x: 38, y: 9, z: 0 }, true);
  s.ball.setLinvel({ x: 60, y: 0, z: 0 }, true);
  run(s, 0.1, {});
  record(
    "CCD fast wall bounce",
    { x: s.ball.translation().x, vx: s.ball.linvel().x },
    s.ball.translation().x < 40 && s.ball.linvel().x < 0,
  );
  s.dispose();
}
{
  const s = setup();
  const pads = new Pads(),
    p = pads.items.find((p) => !p.large)!;
  s.cars[0].reset(p.x, p.z, 0);
  s.cars[0].boost = 0;
  pads.tick(s.cars);
  record(
    "small pad pickup",
    s.cars[0].boost,
    s.cars[0].boost === 12 && p.cooldown === 4,
  );
  s.cars[0].reset(100, 100, 0);
  for (let i = 0; i < 481; i++) pads.tick(s.cars);
  record("small pad respawn", p.cooldown, p.cooldown === 0);
  s.dispose();
}
{
  const s = setup();
  const m = new Match();
  m.start(s);
  for (let i = 0; i < 359; i++) m.tick(s);
  record(
    "three-second kickoff holds match clock",
    { phase: m.phase, countdown: m.countdown, clock: m.remaining },
    m.phase === "countdown" && m.remaining === 300,
  );
  m.pause();
  const held = m.countdown;
  m.tick(s);
  record("pause freezes countdown", m.countdown, m.countdown === held);
  m.pause();
  m.tick(s);
  record("kickoff releases at three seconds", m.phase, m.phase === "playing");
  s.ball.setTranslation({ x: 0, y: 1, z: -P.arena.halfLength - 0.3 }, true);
  m.tick(s);
  record("partial goal crossing rejected", m.score[0], m.score[0] === 0);
  s.ball.setTranslation({ x: 0, y: 1, z: -P.arena.halfLength - 1 }, true);
  m.tick(s);
  record(
    "full goal crossing scores",
    m.score[0],
    m.score[0] === 1 && m.phase === "goal",
  );
  const blastSpeed = speed(s);
  record(
    "goal blast launches cars",
    blastSpeed,
    blastSpeed > 8 && !s.ball.isEnabled(),
  );
  const previousPosition = new Vector3().copy(s.cars[0].body.translation());
  for (let i = 0; i < 120; i++) {
    s.step([neutral(), neutral()], true);
    m.tick(s);
  }
  record(
    "cars move during celebration",
    previousPosition.distanceTo(s.cars[0].body.translation()),
    previousPosition.distanceTo(s.cars[0].body.translation()) > 3,
  );
  for (let i = 0; i < 266; i++) m.tick(s);
  if (m.phase === "replay" && m.replay)
    m.skipReplay(s.cars[0].id, m.replay.clip.goal.id, s);
  record(
    "goal resets kickoff",
    { phase: m.phase, z: s.ball.translation().z },
    m.phase === "countdown" &&
      s.ball.translation().z === 0 &&
      s.ball.isEnabled(),
  );
  for (let i = 0; i < 360; i++) m.tick(s);
  m.remaining = 0.001;
  m.tick(s);
  record("full time result", m.phase, m.phase === "finished");
  m.start(s);
  for (let i = 0; i < 360; i++) m.tick(s);
  m.remaining = 0.001;
  m.tick(s);
  record(
    "tied match overtime",
    m.overtime,
    m.overtime && m.phase === "countdown",
  );
  for (let i = 0; i < 360; i++) m.tick(s);
  s.ball.setTranslation({ x: 0, y: 1, z: P.arena.halfLength + 1 }, true);
  m.tick(s);
  for (let i = 0; i < 386; i++) m.tick(s);
  if (m.phase === "replay" && m.replay)
    m.skipReplay(s.cars[0].id, m.replay.clip.goal.id, s);
  record(
    "overtime goal ends match",
    m.phase,
    m.phase === "finished" && m.score[1] === 1,
  );
  s.dispose();
}
{
  const outcomes: number[] = [];
  for (const slide of [false, true]) {
    const s = setup();
    // The new handbrake takes .2s to engage; measure fully engaged tire grip here.
    run(s, 0.25, { slide });
    s.cars[0].body.setLinvel({ x: 5, y: 0, z: -10 }, true);
    run(s, 0.2, { slide, throttle: 0.02 });
    outcomes.push(Math.abs(s.cars[0].body.linvel().x));
    s.dispose();
  }
  record(
    "powerslide preserves lateral slip",
    outcomes,
    outcomes[1] > outcomes[0] + 2,
  );
}
{
  const outcomes: number[] = [];
  for (const cancel of [false, true]) {
    const s = setup();
    run(s, 0.2, { jump: true });
    run(s, 0.03, {});
    run(s, P.dt, { jump: true, throttle: 1 });
    run(s, 0.15, { pitch: cancel ? -1 : 0 });
    outcomes.push(s.cars[0].body.angvel().x);
    s.dispose();
  }
  record(
    "opposite pitch cancels forward flip",
    outcomes,
    outcomes[1] > outcomes[0] + 1,
  );
}
{
  const s = new Simulation(),
    m = new Match(),
    bot = new Opponent();
  m.start(s);
  let escaped = false,
    steps = 0;
  // The stationary player can concede many goals; each adds 6.2 s of stopped-clock time.
  for (; steps < 120 * 1200 && m.phase !== "finished"; steps++) {
    if (m.phase === "playing")
      s.step([neutral(), bot.sample(s.cars[1], s.ball.translation(), s.clock)]);
    if (m.phase === "goal") s.step([neutral(), neutral()], true);
    m.tick(s);
    for (const body of [s.ball, ...s.cars.map((c) => c.body)]) {
      const p = body.translation();
      if (
        !Number.isFinite(p.x + p.y + p.z) ||
        Math.abs(p.x) > 42 ||
        Math.abs(p.z) > 61 ||
        p.y < -0.5 ||
        p.y > 22
      )
        escaped = true;
    }
  }
  record(
    "complete 5-minute live simulation",
    { seconds: steps / 120, score: m.score, phase: m.phase, escaped },
    !escaped && m.phase === "finished",
  );
  s.dispose();
}
for (const glancing of [false, true]) {
  const s = setup();
  s.cars[0].reset(glancing ? 0.4 : 0, 2, 0);
  s.cars[1].reset(0, -2, Math.PI);
  s.cars[0].body.setLinvel({ x: 0, y: 0, z: -20 }, true);
  let collision = false;
  for (let i = 0; i < 45; i++) {
    s.step([{ ...neutral(), throttle: 1 }, neutral()]);
    if (s.cars[1].impactTime > 0) collision = true;
  }
  record(
    `${glancing ? "glancing" : "head-on"} opponent collision`,
    {
      collision,
      opponentZ: s.cars[1].body.translation().z,
      playerZ: s.cars[0].body.translation().z,
    },
    collision && s.cars[1].body.translation().z < -2.4,
  );
  s.dispose();
}
mkdirSync("docs", { recursive: true });
writeFileSync("docs/calibration.json", JSON.stringify(results, null, 2) + "\n");
if (results.some((r) => !r.pass)) process.exitCode = 1;
