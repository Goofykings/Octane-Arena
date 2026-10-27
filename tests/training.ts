import { captureTrainingReplay } from "./replay-capture";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { TrainingRun } from "../src/extra/training/run";
import { trainingPacks } from "../src/extra/training/packs";
import { neutralInput } from "../shared/player";
import { predictGoal } from "../src/game/ball-prediction";
import { scoringTeam } from "../src/game/goals";
import { P } from "../src/config/physics";
import { trainingLaunchPreview } from "../src/extra/training/preview";
await initializeSimulation();
const n = neutralInput();
function begin(run: TrainingRun) {
  const s = run.simulation,
    car = JSON.stringify({
      p: s.cars[0].body.translation(),
      q: s.cars[0].body.rotation(),
    }),
    ball = JSON.stringify(s.ball.translation()),
    clock = s.clock;
  const arrow = trainingLaunchPreview(run.shot);
  assert.equal(
    arrow.visible,
    !run.shot.ballFrozen &&
      new Vector3().copy(run.shot.ballVelocity).length() > 0,
  );
  if (arrow.visible)
    assert.ok(
      arrow.direction.angleTo(new Vector3().copy(run.shot.ballVelocity)) < 1e-7,
    );
  for (let i = 0; i < 360; i++) run.step(n);
  assert.equal(run.ready, true);
  assert.equal(run.elapsed, 0);
  assert.equal(run.timeRemaining, run.duration);
  assert.equal(s.clock, clock);
  assert.equal(
    JSON.stringify({
      p: s.cars[0].body.translation(),
      q: s.cars[0].body.rotation(),
    }),
    car,
  );
  assert.equal(JSON.stringify(s.ball.translation()), ball);
  run.step({ ...n, steer: 0.1 });
  assert.equal(run.ready, false);
  assert.ok(run.elapsed > 0);
  assert.ok(Math.abs(s.ball.linvel().x - run.shot.ballVelocity.x) < 0.05);
  assert.ok(Math.abs(s.ball.linvel().z - run.shot.ballVelocity.z) < 0.05);
}
const map = new Map<string, string>();
const storage = {
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => {
    map.set(k, v);
  },
};
assert.deepEqual(
  trainingPacks.map((p) => p.id),
  ["striker", "goalie", "aerial"],
);
for (const pack of trainingPacks) {
  const s = new Simulation(false, [
    { id: "practice", name: "Guest", team: 0, controller: "local" },
  ]);
  try {
    const run = new TrainingRun(s, pack, storage);
    assert.equal(pack.shots.length, 10);
    for (let index = 0; index < 10; index++) {
      run.index = index;
      run.reset();
      assert.equal(s.cars.length, 1);
      assert.ok(
        new Vector3()
          .copy(s.ball.translation())
          .distanceTo(pack.shots[index].ballSpawn) < 0.00001,
      );
      assert.equal(s.heatseeker, null);
      begin(run);
      const first = new Vector3().copy(s.ball.translation());
      if (run.frozen) {
        for (let i = 0; i < 240; i++) run.step(n);
        assert.ok(
          first.distanceTo(s.ball.translation()) < 0.00001,
          "Frozen ball stays exactly still before contact",
        );
        const b = s.ball.translation();
        s.cars[0].reset(b.x, b.z + 2.5, 0, b.y);
        s.cars[0].body.setLinvel({ x: 0, y: 0, z: -8 }, true);
        for (let i = 0; i < 90 && run.frozen; i++) run.step(n);
        assert.equal(
          run.frozen,
          false,
          `Aerial ${index + 1}: actual car contact releases ball`,
        );
        assert.equal(s.ball.gravityScale(), 1);
        assert.ok(
          new Vector3().copy(s.ball.linvel()).length() > 1,
          "Contact impulse retained instead of scripted velocity",
        );
      } else if (pack.type === "aerial") {
        for (let i = 0; i < 60; i++) run.step(n);
        assert.ok(
          s.ball.translation().y > first.y + 0.8,
          "Later aerial balls really rise under normal physics",
        );
        for (let i = 0; i < 180; i++) run.step(n);
        assert.ok(
          s.ball.linvel().y < 0 || s.ball.translation().y < first.y + 0.5,
          "Normal gravity brings moving aerial down",
        );
      }
      run.reset();
      assert.equal(run.elapsed, 0);
      assert.equal(run.outcome, null);
      begin(run);
      if (pack.type === "goalie") {
        assert.equal(
          predictGoal(
            {
              position: s.ball.translation(),
              velocity: s.ball.linvel(),
              heat: null,
            },
            s.world,
            4,
          )?.team,
          0,
          `Goalie ${index + 1}: real serve threatens defended goal`,
        );
        // The offset idle defender must not automatically save these scenarios.
        for (let i = 0; i < 1800 && !run.outcome; i++) run.step(n);
        assert.equal(run.outcome, "FAILED");
        assert.equal(
          scoringTeam(s.ball.translation()),
          1,
          `Goalie ${index + 1}: untreated serve actually scores`,
        );
        s.cars[0].body.setEnabled(true);
        run.reset();
        begin(run);
        // Isolate real physical save classification with an intercept fixture,
        // including elevated shots. No fake touch events or ball impulses.
        const b = s.ball.translation();
        s.cars[0].reset(b.x, b.z + 2.5, 0, b.y);
        s.cars[0].body.setLinvel({ x: 0, y: 0, z: -10 }, true);
        let contact = false;
        for (let i = 0; i < 400 && !run.outcome; i++) {
          run.step(n);
          if (s.statTouches.length) {
            contact = true;
            assert.equal(
              run.outcome,
              null,
              "Save does not complete at contact",
            );
            assert.equal(s.ball.isEnabled(), true);
          }
        }
        assert.ok(contact);
        assert.equal(
          run.outcome,
          "SUCCESS",
          `Goalie ${index + 1}: meaningful real collision redirects threat`,
        );
      } else {
        s.ball.setGravityScale(1, true);
        run.frozen = false;
        s.ball.setTranslation(
          { x: 0, y: 2, z: -P.arena.halfLength - 0.9 },
          true,
        );
        s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
        run.step(n);
        assert.equal(run.outcome, "SUCCESS", "Actual opponent goal succeeds");
      }
      if (run.recorder.pendingGoal) captureTrainingReplay(run);
      if (run.replay) {
        const index = run.index;
        const before = JSON.stringify({
          car: s.cars[0].body.translation(),
          ball: s.ball.translation(),
          clock: s.clock,
        });
        run.advance(0.1);
        assert.equal(run.index, index);
        assert.equal(run.ready, false);
        assert.equal(
          JSON.stringify({
            car: s.cars[0].body.translation(),
            ball: s.ball.translation(),
            clock: s.clock,
          }),
          before,
        );
        assert.ok(run.replay.clip.count >= 2);
        if (run.recorder.pendingGoal) captureTrainingReplay(run);
        if (index < 9) run.skipReplay();
      }
    }
    if (pack.type === "striker") {
      if (run.recorder.pendingGoal) captureTrainingReplay(run);
      if (run.replay) run.skipReplay();
      // All ten shots are scoreable with ground controls: line up behind the
      // (slightly predicted) rolling ball on the goal line, then shoot through
      // it. No ball edits, boost, jump or scripted impulses.
      for (let index = 0; index < 10; index++) {
        const originalDuration = pack.shots[index].timeLimit;
        pack.shots[index].timeLimit = 36;
        run.index = index;
        run.reset();
        begin(run);
        for (let i = 0; i < 4350 && !run.outcome; i++) {
          const car = s.cars[0],
            pos = new Vector3().copy(car.body.translation()),
            ball = new Vector3()
              .copy(s.ball.translation())
              .addScaledVector(new Vector3().copy(s.ball.linvel()).setY(0), 0.4);
          const forward = new Vector3(0, 0, -1)
            .applyQuaternion(new Quaternion().copy(car.body.rotation()))
            .setY(0)
            .normalize();
          const goalDir = new Vector3(
            -ball.x,
            0,
            -P.arena.halfLength - ball.z,
          ).normalize();
          const toBall = new Vector3(ball.x - pos.x, 0, ball.z - pos.z);
          const lateral = Math.abs(toBall.x * goalDir.z - toBall.z * goalDir.x);
          const aligned =
            toBall.dot(goalDir) > 0.5 &&
            lateral < 0.8 &&
            toBall.clone().normalize().dot(goalDir) > 0.94;
          const target = ball
            .clone()
            .addScaledVector(goalDir, aligned ? 2 : -5 - Math.min(3, lateral));
          const desired = Math.atan2(target.x - pos.x, -(target.z - pos.z)),
            heading = Math.atan2(forward.x, -forward.z);
          const error = Math.atan2(
            Math.sin(desired - heading),
            Math.cos(desired - heading),
          );
          const speed = new Vector3().copy(car.body.linvel()).dot(forward),
            want = aligned
              ? 14
              : Math.min(
                  10,
                  2 + new Vector3(target.x - pos.x, 0, target.z - pos.z).length(),
                );
          run.step({
            ...n,
            throttle:
              Math.abs(error) > 1.2
                ? 0.3
                : speed < want
                  ? 1
                  : speed > want + 2
                    ? -0.3
                    : 0.05,
            steer: Math.max(-1, Math.min(1, error * 3)),
          });
        }
        assert.equal(
          run.outcome,
          "SUCCESS",
          `Striker ${index + 1}: harder but scoreable ground-input shot`,
        );
        pack.shots[index].timeLimit = originalDuration;
        if (run.recorder.pendingGoal) captureTrainingReplay(run);
        if (index < 9) run.skipReplay();
      }
    }
    if (run.replay) run.skipReplay();
    else run.advance(1.3);
    assert.equal(run.complete, true);
    assert.equal(run.successes, 10);
    assert.equal(run.best, 10);
    assert.equal(map.get("octane-arena-training-last"), pack.id);
    assert.equal(run.navigate(-9), true);
    assert.equal(run.index, 0);
    assert.equal(run.complete, false);
    assert.equal(run.navigate(-1), false);
    assert.equal(run.navigate(9), true);
    run.reset();
    begin(run);
    run.elapsed = run.duration;
    s.ball.setTranslation({ x: 0, y: P.ball.radius, z: 0 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run.step(n);
    assert.equal(run.outcome, "FAILED");
    run.paused = true;
    const time = run.elapsed;
    run.step(n);
    run.advance(10);
    assert.equal(run.elapsed, time);
    assert.equal(run.complete, false);
    run.paused = false;
    run.advance(1.3);
    assert.equal(run.complete, true);
    assert.equal(
      run.successes,
      8,
      "Retrying first and last shots clears their previous results",
    );
    assert.equal(run.best, 10);
    assert.equal(new TrainingRun(s, pack, storage).best, 10);
  } finally {
    s.dispose();
  }
}
console.log(
  "PASS 30 data-driven scenarios, 10 real goalie serves/goals/saves, 4 frozen contact releases, 6 upward aerial trajectories, scoring, timeout, resets, unrestricted navigation, results/persistence; shared physics unchanged",
);
