import { captureTrainingReplay } from "./replay-capture";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { TrainingRun, TRAINING_SAVE } from "../src/extra/training/run";
import { trainingPacks } from "../src/extra/training/packs";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const n = neutralInput();
const create = (pack = 0) => {
  const s = new Simulation(false, [
    { id: "practice", name: "Human", team: 0, controller: "local" },
  ]);
  const run = new TrainingRun(s, trainingPacks[pack]);
  run.step({ ...n, steer: 0.1 });
  return { s, run };
};
for (const pack of [0, 2]) {
  const { s, run } = create(pack);
  try {
    run.frozen = false;
    s.ball.setGravityScale(1, true);
    for (let i = 0; i < 240; i++) run.step(n);
    s.ball.setTranslation({ x: 0, y: 2, z: -P.arena.halfLength - 0.8 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: -30 }, true);
    run.step(n);
    assert.equal(run.outcome, "SUCCESS");
    captureTrainingReplay(run);
    assert.ok(run.replay);
    assert.ok(run.replay.clip.count >= 240);
    assert.equal(run.replay.clip.goal.scorerId, "practice");
    assert.ok(run.replay.clip.goal.ballSpeed > 20);
    assert.ok(run.replay.clip.events.some((e) => e.kind === "goal"));
    const score = run.successes,
      sequence = run.outcomeSequence,
      physical = JSON.stringify({
        ball: s.ball.translation(),
        car: s.cars[0].body.translation(),
        clock: s.clock,
      });
    assert.equal(
      run.navigate(1),
      false,
      "Navigation cannot start a new shot under replay",
    );
    for (let i = 0; i < 30; i++) {
      run.advance(1 / 60);
      run.step({ ...n, throttle: 1, jump: true });
    }
    captureTrainingReplay(run);
    assert.ok(run.replay);
    assert.equal(run.ready, false);
    assert.equal(run.successes, score);
    assert.equal(run.outcomeSequence, sequence);
    assert.equal(
      JSON.stringify({
        ball: s.ball.translation(),
        car: s.cars[0].body.translation(),
        clock: s.clock,
      }),
      physical,
    );
    run.paused = true;
    const replayTime = run.replay.clock.time;
    run.advance(10);
    assert.equal(run.replay.clock.time, replayTime);
    assert.equal(run.skipReplay(), false);
    run.paused = false;
    assert.equal(run.skipReplay(), true);
    assert.equal(run.replay, null);
    assert.equal(run.index, 1);
    assert.equal(run.ready, true);
    assert.equal(run.successes, 1);
    assert.equal(run.outcomeSequence, sequence);
    assert.equal(run.elapsed, 0);
    assert.equal(run.skipReplay(), false);
    run.step({ ...n, steer: 0.1 });
    if (run.frozen) {
      run.frozen = false;
      s.ball.setGravityScale(1, true);
    }
    s.ball.setTranslation({ x: 0, y: 2, z: -P.arena.halfLength - 0.8 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: -30 }, true);
    run.step(n);
    captureTrainingReplay(run);
    for (let i = 0; i < 900 && run.replay; i++) run.advance(1 / 60);
    assert.equal(run.replay, null);
    assert.equal(run.index, 2);
    assert.equal(run.ready, true);
    assert.equal(run.successes, 2, "Natural replay completion advances once");
  } finally {
    s.dispose();
  }
}
for (const rethreat of [false, true]) {
  const { s, run } = create(1);
  try {
    const b = s.ball.translation();
    s.cars[0].reset(b.x, b.z + 2.5, 0, b.y);
    s.cars[0].body.setLinvel({ x: 0, y: 0, z: -10 }, true);
    for (let i = 0; i < 120 && !run.saveCandidate; i++) run.step(n);
    assert.equal(run.saveCandidate, true);
    assert.equal(run.outcome, null);
    assert.equal(s.ball.isEnabled(), true);
    assert.ok(s.ball.linvel().z < 0, "Real collision physically rebounds ball");
    const start = new Vector3().copy(s.ball.translation());
    for (let i = 0; i < 120 && run.saveDelay < 0.4; i++) run.step(n);
    assert.ok(run.saveDelay >= 0.4);
    assert.equal(run.outcome, null);
    assert.equal(s.ball.isEnabled(), true);
    assert.ok(
      start.distanceTo(s.ball.translation()) > 2,
      "Rebound remains visibly moving during success delay",
    );
    if (rethreat) {
      s.cars[0].reset(25, 0, 0);
      s.ball.setTranslation({ x: 0, y: 2, z: P.arena.halfLength - 5 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 15 }, true);
      run.saveSafeTime = TRAINING_SAVE.debounce;
      run.saveDelay = TRAINING_SAVE.delay - P.dt / 2;
      run.step(n);
      assert.equal(
        run.outcome,
        null,
        "Final completion checks the live trajectory before hiding ball",
      );
      for (let i = 0; i < 5; i++) run.step(n);
      assert.equal(run.saveDelay, 0);
      assert.equal(run.saveSafeTime, 0, "Returning threat cancels safe timer");
      for (let i = 0; i < 120 && !run.outcome; i++) run.step(n);
      assert.equal(run.outcome, "FAILED");
      assert.equal(run.ballBurstSequence, 0);
    } else {
      const before = run.elapsed;
      for (let i = 0; i < 180 && !run.outcome; i++) run.step(n);
      assert.equal(run.outcome, "SUCCESS");
      assert.equal(run.ballBurstSequence, 1);
      assert.equal(s.ball.isEnabled(), false);
      assert.ok(run.elapsed - before >= TRAINING_SAVE.delay - 0.45);
      for (let i = 0; i < 60; i++) run.step(n);
      assert.equal(
        run.ballBurstSequence,
        1,
        "Burst/completion are emitted once",
      );
      run.advance(1.3);
      assert.equal(run.index, 1);
      assert.equal(run.ready, true);
      assert.equal(s.ball.isEnabled(), true);
    }
  } finally {
    s.dispose();
  }
}
console.log(
  "PASS real save rebound + debounce + one-second delay + returning-threat cancellation/failure; single burst; recorded Striker/Aerial replay, pause, immediate solo skip, natural completion, frozen physics and no duplicate results",
);
