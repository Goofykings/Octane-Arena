import assert from "node:assert/strict";
import { Quaternion, Vector3, PerspectiveCamera, Scene, Group } from "three";
import {
  ReplayBuffer,
  ReplaySampler,
  ReplayClock,
  slowIntervals,
  replayMessage,
  decodeReplay,
  BALL_STRIDE,
  CAR_STRIDE,
  RC,
  REPLAY_CAPACITY,
  type ReplayGoal,
} from "../shared/replay";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { Pads } from "../src/game/pads";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import { ReplayDirectorCamera } from "../src/replay/director-camera";
import { ReplayScenePlayback } from "../src/replay/scene-playback";
import { carModel, ballModel } from "../src/render/models";
import { VehicleEffects } from "../src/effects/vehicle-effects";
import { BallTrails, FlipTrails } from "../src/effects/motion-trails";
import { JumpBurst } from "../src/effects/jump-burst";
import { SkidMarks } from "../src/effects/skid-marks";
import { DemolitionFlash } from "../src/effects/demolition-flash";
import { GoalExplosion } from "../src/effects/goal-explosion";
import { LocalProfile } from "../src/game/local-profile";

const goal: ReplayGoal = {
  id: "test-goal",
  time: 8,
  scorerId: "p0",
  team: 0,
  ownGoal: false,
  lastTouchId: "p0",
  touchTime: 6,
  ballSpeed: 25,
  focus: { x: 0, y: 2, z: -51.2 },
};
const buffer = new ReplayBuffer(["p0", "p1", "p2", "p3"], 20);
for (let i = 0; i <= 8 * 120; i++) {
  const time = i / 120,
    o = buffer.write(time, 1),
    data = buffer.frames;
  data[o] = time;
  data[o + 3] = 0;
  data[o + 6] = 1;
  data[o + 13] = 1;
  for (let j = 0; j < 4; j++) {
    const c = o + BALL_STRIDE + j * CAR_STRIDE;
    data[c] = time * 2 + j;
    data[c + RC.rotation + 3] = 1;
    data[c + RC.enabled] = 1;
    data[c + RC.wheelAngle] = time * 5;
  }
  if (i % 120 === 0) buffer.event({ kind: "touch", playerId: "p0", time });
}
assert.equal(buffer.count, REPLAY_CAPACITY);
assert.ok(
  buffer.bytes < 720000,
  "Four-player rolling buffer exceeded the memory budget",
);
const clip = buffer.clip(goal);
assert.ok(clip.count <= 602 && clip.start <= 3.001 && clip.start >= 2.99);
assert.equal(clip.end, 8);
const sampler = new ReplaySampler(clip);
const frame = sampler.sample(5.004);
assert.ok(Math.abs(frame[0] - 5.004) < 1e-5);
assert.ok(Math.abs(frame[BALL_STRIDE + RC.wheelAngle] - 25.02) < 1e-4);
assert.equal(frame[BALL_STRIDE + 3 * CAR_STRIDE + RC.enabled], 1);
const wire = decodeReplay(replayMessage("match", clip));
assert.deepEqual(wire.frames, clip.frames);
assert.deepEqual(wire.times, clip.times);
assert.throws(() =>
  decodeReplay({
    ...replayMessage("match", clip),
    clip: { ...replayMessage("match", clip).clip, count: 999999 },
  }),
);
const rotational = new ReplayBuffer(["p0"], 0);
for (let i = 0; i < 2; i++) {
  const offset = rotational.write(i, 2);
  new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), i * Math.PI * 0.8)
    .toArray(rotational.frames, offset + 3);
  rotational.frames[offset + 13] = 1;
  new Quaternion().toArray(rotational.frames, offset + BALL_STRIDE + 3);
  rotational.frames[offset + BALL_STRIDE + RC.enabled] = i; // demolition/respawn discontinuity
  rotational.frames[offset + BALL_STRIDE] = i * 50;
}
const rotationSample = new ReplaySampler(
  rotational.clip({ ...goal, time: 1 }),
).sample(0.5);
assert.ok(
  new Quaternion()
    .fromArray(rotationSample, 3)
    .angleTo(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI * 0.4),
    ) < 1e-6,
);
assert.equal(
  rotationSample[BALL_STRIDE],
  50,
  "Respawn teleports must not interpolate",
);
rotational.write(2, 3);
assert.equal(
  rotational.clip({ ...goal, time: 2 }).count,
  1,
  "Kickoff discontinuity crossed reset boundary",
);
assert.equal(
  slowIntervals(clip).length,
  2,
  "Separate touch and goal regions required",
);
assert.equal(
  slowIntervals({ ...clip, goal: { ...goal, touchTime: 7.8 } }).length,
  1,
);
assert.equal(
  slowIntervals({ ...clip, goal: { ...goal, touchTime: 6.86 } }).length,
  1,
  "Near-adjacent regions must merge",
);
assert.equal(
  slowIntervals({
    ...clip,
    goal: { ...goal, ownGoal: true, lastTouchId: "p2", touchTime: 6 },
  }).length,
  1,
);
assert.equal(
  slowIntervals({ ...clip, goal: { ...goal, lastTouchId: "p2" } }).length,
  1,
  "Uncredited player touch must not slow-highlight",
);
for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
  const clock = new ReplayClock(clip);
  let elapsed = 0,
    previous = clip.start,
    minimum = 1;
  while (!clock.done && elapsed < 20) {
    clock.advance(dt);
    assert.ok(clock.time >= previous);
    previous = clock.time;
    minimum = Math.min(minimum, clock.speed);
    elapsed += dt;
  }
  assert.ok(clock.done && elapsed > 6 && elapsed < 10);
  assert.ok(minimum >= 0.399 && minimum < 0.42);
}
console.log(
  "PASS bounded 120-Hz circular buffer, five-second clips, packed transport, slerp, wheel state, discontinuities and eased/merged 0.4x slow motion",
);

await initializeSimulation();
const s = new Simulation(),
  m = new Match(),
  pads = new Pads();
m.start(s, "bot");
m.phase = "playing";
const n = neutralInput();
for (let i = 0; i < 720; i++) {
  s.step([n, n]);
  m.tick(s, pads);
}
// Physical contact establishes a real player-ID touch, without assigning lastTouchId.
s.cars[0].reset(0, 0, 0);
s.ball.setTranslation({ x: 0, y: 0.8, z: -1 }, true);
s.ball.setLinvel({ x: 0, y: 0, z: 1 }, true);
for (let i = 0; i < 20 && s.lastTouchId !== s.cars[0].id; i++) {
  s.step([n, n]);
  m.tick(s, pads);
}
assert.equal(s.lastTouchId, s.cars[0].id);
assert.equal(s.lastTouchTime, s.clock);
assert.ok(m.recorder.buffer);
s.ball.setTranslation({ x: 0, y: 2, z: -52.15 }, true);
s.ball.setLinvel({ x: 0, y: 0, z: -24 }, true);
s.step([n, n]);
const speed = Math.hypot(
  s.ball.linvel().x,
  s.ball.linvel().y,
  s.ball.linvel().z,
);
m.tick(s, pads);
assert.equal(m.phase, "goal");
assert.deepEqual(m.score, [1, 0]);
assert.equal(m.replay!.clip.goal.ballSpeed, speed);
assert.equal(m.replay!.clip.goal.lastTouchId, s.cars[0].id);
assert.ok(
  m.replay!.clip.events.some(
    (e) => e.kind === "touch" && e.playerId === s.cars[0].id,
  ),
);
assert.equal(m.replay!.eligible.size, 1);
// Preserve movable celebration and both pad types; no replay begins prematurely.
for (const pad of [pads.items[0], pads.items[6]]) {
  const c = s.cars[0];
  c.reset(pad.x, pad.z, 0);
  c.boost = 0;
  pads.tick(s.cars);
  assert.equal(c.boost, pad.large ? 100 : 12);
}
for (let i = 0; i < 500 && m.phase === "goal"; i++) {
  s.step([n, n]);
  pads.tick(s.cars);
  m.tick(s, pads);
}
assert.equal(m.phase, "replay");
const frozen = s.world.takeSnapshot(),
  score = [...m.score],
  clockBefore = s.clock;
const profile = new LocalProfile();
profile.observeMatch("match", s.cars[0].id, 0, "goal", m.score, m.lastGoal);
profile.observeMatch("match", s.cars[0].id, 0, "replay", m.score, m.lastGoal);
profile.observeMatch("match", s.cars[0].id, 0, "goal", m.score, m.lastGoal);
assert.equal(profile.value.stats.goals, 1);
for (let i = 0; i < 120; i++) m.tick(s, pads);
assert.equal(s.clock, clockBefore);
assert.deepEqual(s.world.takeSnapshot(), frozen);
assert.deepEqual(m.score, score);
assert.equal(m.skipReplay("intruder", m.replay!.clip.goal.id, s), false);
assert.equal(m.skipReplay(s.cars[0].id, "stale", s), false);

// Playback reuses exact live meshes/materials and does not write any physics data.
const scene = new Scene(),
  camera = new PerspectiveCamera(70, 16 / 9, 0.05, 340);
const models = s.cars.map((c, i) =>
  carModel(i ? 0xff9900 : 0x66ccff, c.bodyId, "turbine", "stripe"),
);
const ball = ballModel();
scene.add(...models, ball);
const effects = {
  vehicles: models.map((model) => new VehicleEffects(model, scene, 0x69e9ff)),
  ball: new BallTrails(scene),
  flips: models.map(() => new FlipTrails(scene)),
  jumps: models.map(() => new JumpBurst(scene)),
  skids: models.map(() => new SkidMarks(scene)),
  demos: models.map(() => new DemolitionFlash(scene)),
  explosion: new GoalExplosion(scene),
};
const playback = new ReplayScenePlayback(
  camera,
  models,
  models,
  ball,
  s.cars,
  effects,
);
const replayClip = m.replay!.clip,
  modelGeometry = models[0].children[0];
for (let i = 0; i < 100; i++)
  playback.render(replayClip, replayClip.start + i / 60, 1, 1 / 60);
assert.equal(models[0].children[0], modelGeometry);
assert.deepEqual(s.world.takeSnapshot(), frozen);
assert.deepEqual(m.score, score);
assert.equal(s.clock, clockBefore);
assert.equal(m.skipReplay(s.cars[0].id, m.replay!.clip.goal.id, s), true);
assert.equal(m.phase, "countdown");
assert.equal(m.countdown, 3);
assert.equal(m.skipReplay(s.cars[0].id, replayClip.goal.id, s), false);
assert.deepEqual(m.score, score);
playback.stop();
s.dispose();
console.log(
  "PASS real touch/goal speed, preserved explosion/pickups, frozen live world, exact model reuse, no repeated stats/score and single-human skip/kickoff",
);

const own = new Simulation(),
  ownMatch = new Match();
ownMatch.start(own, "bot");
ownMatch.phase = "playing";
own.lastTouchId = own.cars[1].id;
own.lastTouchTime = own.clock;
own.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
ownMatch.tick(own);
assert.equal(ownMatch.lastGoal!.ownGoal, true);
assert.equal(ownMatch.lastGoal!.scorerId, own.cars[0].id);
assert.equal(slowIntervals(ownMatch.replay!.clip).length, 1);
ownMatch.freeze = 0;
ownMatch.tick(own);
for (let i = 0; i < 1500 && String(ownMatch.phase) === "replay"; i++)
  ownMatch.tick(own);
assert.equal(
  ownMatch.phase,
  "countdown",
  "Natural replay completion must reset kickoff",
);
own.dispose();
const practice = new Simulation(),
  free = new Match();
free.start(practice, "freeplay");
practice.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
free.tick(practice);
assert.equal(free.phase, "goal");
assert.equal(free.replay, null);
assert.deepEqual(free.score, [0, 0]);
free.freeze = 0;
free.tick(practice);
assert.equal(free.phase, "playing");
practice.dispose();
console.log(
  "PASS own-goal attribution/pre-goal-only slow motion, natural completion and unchanged Free Play flow",
);

// Original director framing across straight, long aerial, flick and late redirect fixtures.
for (const aspect of [16 / 9, 4 / 3, 9 / 16]) {
  for (const variant of ["straight", "aerial", "flick", "redirect"]) {
    const camera = new PerspectiveCamera(70, aspect, 0.05, 340),
      director = new ReplayDirectorCamera(camera);
    let previous = new Vector3(),
      largestStep = 0,
      largestZoom = 0,
      lastFov = 0,
      visible = 0,
      scorerVisible = 0,
      goalVisible = 0;
    for (let i = 0; i <= 300; i++) {
      const t = i / 300;
      const ball = new Vector3(
        variant === "redirect" ? Math.sin(t * 3) * 10 : 2,
        variant === "aerial"
          ? 3 + Math.sin(t * Math.PI) * 11
          : variant === "flick"
            ? 2 + Math.sin(t * Math.PI) * 4
            : 1.5,
        25 - 78 * t,
      );
      const scorer = ball.clone().add(new Vector3(-3, -0.8, 5));
      director.update(
        ball,
        new Vector3(0, 0, -20),
        scorer,
        goal,
        1 / 60,
        3 + t * 5,
        1,
        [],
      );
      if (i) {
        largestStep = Math.max(
          largestStep,
          previous.distanceTo(camera.position),
        );
        largestZoom = Math.max(largestZoom, Math.abs(camera.fov - lastFov));
      }
      previous.copy(camera.position);
      lastFov = camera.fov;
      const screen = director.debug.ballScreen;
      if (
        Math.abs(screen.x) < 0.95 &&
        Math.abs(screen.y) < 0.9 &&
        screen.z > -1 &&
        screen.z < 1
      )
        visible++;
      const onScreen = (v: Vector3) =>
        Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.9 && v.z > -1 && v.z < 1;
      if (onScreen(director.debug.scorerScreen)) scorerVisible++;
      if (onScreen(director.debug.goalScreen)) goalVisible++;
      assert.ok(Number.isFinite(camera.position.lengthSq()));
      assert.ok(
        camera.position.y >= 4.99 && camera.position.y <= P.arena.height - 1.49,
      );
    }
    assert.ok(
      visible > 280,
      `${variant} aspect ${aspect}: ball framing ${visible}/301`,
    );
    assert.ok(
      scorerVisible > 280 && goalVisible > 280,
      `${variant} aspect ${aspect}: scorer ${scorerVisible}, goal ${goalVisible}/301`,
    );
    assert.ok(
      largestStep < 2 && largestZoom < 2,
      `${variant}: camera jumped ${largestStep}, zoom ${largestZoom}`,
    );
  }
}
console.log(
  "PASS continuous director view, aerial/flick/redirect framing, no flip-coupled rotation and smooth camera/FOV at three aspect ratios",
);
