import { insideArena } from "../src/arena/physics";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import {
  CustomTrainingLibrary,
  LocalTrainingPackStorage,
} from "../src/game/custom-training";
import {
  TrainingDraft,
  anglesVector,
} from "../src/game/custom-training-editor";
import {
  validatePlayablePack,
  MAX_TRAINING_SHOTS,
} from "../shared/custom-training";
import {
  CustomTrainingRun,
  constrainTrainingPosition,
} from "../src/extra/training/custom-run";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { predictBallTrajectory } from "../src/game/ball-prediction";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
const data = new Map<string, string>(),
  storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
const library = new CustomTrainingLibrary(
  new LocalTrainingPackStorage(storage, "editor-profile"),
);
const pack = library.create("Real training");
const draft = new TrainingDraft(pack);
assert.equal(draft.dirty, true);
assert.equal(draft.pack.shots.length, 1);
for (let i = 0; i < 3; i++) {
  if (i) draft.add();
  const shot = draft.shot;
  shot.carPosition = { x: i * 2, y: 0.36 + i, z: 18 - i };
  shot.carVelocity = { x: i, y: i, z: i === 0 ? 0 : -i };
  shot.carRotation = { x: 0, y: 0, z: 0, w: 1 };
  shot.ballPosition = { x: i * 3, y: 5 + i, z: -4 - i };
  shot.ballLaunchDirection = anglesVector(i * 20, 10);
  shot.ballLaunchSpeed = 10 + i * 5;
  draft.changed();
}
const saved = draft.save(library, "Maverick");
assert.equal(draft.dirty, false);
const reopened = new TrainingDraft(
  new CustomTrainingLibrary(
    new LocalTrainingPackStorage(storage, "editor-profile"),
  ).get(pack.id)!,
);
assert.deepEqual(reopened.pack.shots, saved.shots);
assert.equal(new Set(saved.shots.map((s) => s.id)).size, 3);
reopened.select(1);
const id = reopened.shot.id;
reopened.reorder(-1);
assert.equal(reopened.pack.shots[0].id, id);
reopened.add(true);
assert.notEqual(reopened.shot.id, id);
assert.deepEqual(reopened.shot.carPosition, saved.shots[1].carPosition);
while (reopened.pack.shots.length > 1) reopened.delete();
reopened.delete();
assert.equal(reopened.pack.shots.length, 1);
for (const patch of [
  { ballLaunchSpeed: Infinity },
  { ballLaunchSpeed: P.ball.maxSpeed + 1 },
  { carPosition: { x: 1e5, y: 0, z: 0 } },
  { carRotation: { x: 0, y: 0, z: 0, w: 0 } },
  { ballLaunchDirection: { x: 0, y: 0, z: 0 } },
]) {
  const bad = structuredClone(saved);
  Object.assign(bad.shots[0], patch);
  assert.throws(() => validatePlayablePack(bad));
}
assert.throws(() =>
  validatePlayablePack({
    ...saved,
    shots: Array(MAX_TRAINING_SHOTS + 1).fill(saved.shots[0]),
  }),
);
assert.throws(() =>
  validatePlayablePack({ ...saved, shots: [saved.shots[0], saved.shots[0]] }),
);
await initializeSimulation();
const simulation = new Simulation(false, [
  { id: "training", name: "Guest", team: 0, controller: "local" },
]);
try {
  const run = new CustomTrainingRun(simulation),
    shot = structuredClone(saved.shots[0]);
  shot.carPosition = { x: 20, y: 0.36, z: 18 };
  shot.carVelocity = { x: 3, y: 1, z: -4 };
  shot.ballPosition = { x: 0, y: 7, z: 0 };
  shot.ballLaunchDirection = anglesVector(50, 20);
  shot.ballLaunchSpeed = 20;
  run.reset(shot);
  assert.ok(
    new Vector3()
      .copy(simulation.cars[0].body.linvel())
      .distanceTo(new Vector3().copy(shot.carVelocity)) < 1e-6,
  );
  assert.equal(simulation.cars[0].boost, 100);
  const prediction = predictBallTrajectory(
    {
      position: shot.ballPosition,
      velocity: simulation.ball.linvel(),
      heat: null,
    },
    simulation.world,
    1,
  );
  let maxError = 0;
  for (let i = 0; i < 120; i++) {
    run.step(neutralInput(), shot);
    if ((i + 1) % 4 === 0) {
      const time = (i + 1) * P.dt,
        point = prediction.samples.reduce((a, b) =>
          Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a,
        );
      maxError = Math.max(
        maxError,
        point.position.distanceTo(
          new Vector3().copy(simulation.ball.translation()),
        ),
      );
    }
  }
  assert.ok(
    maxError < 0.22,
    "Prediction stays close to actual Soccar flight: " + maxError,
  );
  run.reset(shot);
  assert.ok(
    new Vector3()
      .copy(simulation.ball.translation())
      .distanceTo(new Vector3().copy(shot.ballPosition)) < 1e-6,
  );
  assert.equal(run.elapsed, 0);
  assert.equal(run.result, "");
  for (const point of [
    new Vector3(100, 0, 100),
    new Vector3(40, 1, 40),
    new Vector3(0, -10, 0),
    new Vector3(0, 30, 0),
  ]) {
    const clamped = constrainTrainingPosition(simulation, point, true);
    assert.ok(clamped.y >= 0 && clamped.y <= P.arena.height);
    assert.ok(Math.abs(clamped.x) <= P.arena.halfWidth);
    assert.ok(
      insideArena(simulation.arenaCollider!, clamped),
      "Clamped point is inside actual collision shell",
    );
  }
  const bounceErrors: Record<string, number> = {};
  for (const [name, position, velocity] of [
    ["floor", { x: 0, y: 3, z: 0 }, { x: 4, y: -9, z: 0 }],
    ["wall", { x: 34, y: 8, z: 0 }, { x: 30, y: 0, z: 0 }],
    ["ceiling", { x: 0, y: 17, z: 0 }, { x: 0, y: 20, z: 5 }],
    ["backboard", { x: 0, y: 10, z: 47 }, { x: 0, y: 0, z: 25 }],
  ] as const) {
    shot.ballPosition = { ...position };
    const v = new Vector3().copy(velocity);
    shot.ballLaunchSpeed = v.length();
    shot.ballLaunchDirection = v.normalize();
    run.reset(shot);
    const prediction = predictBallTrajectory(
      { position, velocity, heat: null },
      simulation.world,
      0.8,
    );
    let error = 0;
    for (let i = 0; i < 96; i++) {
      run.step(neutralInput(), shot);
      if ((i + 1) % 4 === 0) {
        const time = (i + 1) * P.dt,
          nearest = prediction.samples.reduce((a, b) =>
            Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a,
          );
        error = Math.max(
          error,
          nearest.position.distanceTo(
            new Vector3().copy(simulation.ball.translation()),
          ),
        );
      }
    }
    bounceErrors[name] = error;
    assert.ok(error < 1.25, name + " bounce prediction error: " + error);
  }
  const goalShot = structuredClone(shot);
  goalShot.ballPosition = {
    x: 0,
    y: 2,
    z: P.arena.halfLength + P.ball.radius + 0.5,
  };
  goalShot.ballLaunchSpeed = 0;
  run.reset(goalShot);
  let blasts = 0;
  const explode = simulation.explode.bind(simulation);
  simulation.explode = (origin) => {
    blasts++;
    explode(origin);
  };
  run.step(neutralInput(), goalShot);
  assert.equal(run.result, "GOAL");
  assert.ok(run.goalPosition);
  assert.equal(simulation.ball.isEnabled(), false);
  assert.ok(new Vector3().copy(simulation.cars[0].body.linvel()).length() > 5);
  for (let i = 0; i < 15; i++) run.step(neutralInput(), goalShot);
  assert.equal(blasts, 1, "Only one physical/visual goal event per attempt");
  run.reset(shot);
  assert.equal(run.goalPosition, null);
  assert.equal(simulation.ball.isEnabled(), true);
  assert.notEqual(simulation.ballCollider.collisionGroups(), 0);
  console.log(
    "PASS custom goal animation lifecycle: one blast, hidden scored ball, car launch and clean reset.",
  );
  console.log("PASS trajectory major collisions", bounceErrors);
  console.log(
    "PASS custom training: three-shot exact persistence, stable IDs, reorder/duplicate/delete, dirty save, malicious data rejection, exact playback/reset and trajectory error",
    maxError,
  );
} finally {
  simulation.dispose();
}
