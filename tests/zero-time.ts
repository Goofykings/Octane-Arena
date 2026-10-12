import { captureGoalReplay, captureTrainingReplay } from "./replay-capture";
import assert from "node:assert/strict";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { TrainingRun, trainingGameplayInput } from "../src/extra/training/run";
import { trainingPacks } from "../src/extra/training/packs";
import { neutralInput, type PlayerInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const n = neutralInput();
const create = () => {
  const s = new Simulation();
  s.cars.forEach((c, i) => c.reset(i ? 20 : -20, 15, 0));
  return s;
};
const setBall = (
  s: Simulation,
  x: number,
  y: number,
  z: number,
  vx = 0,
  vy = 0,
  vz = 0,
) => {
  s.ball.setTranslation({ x, y, z }, true);
  s.ball.setLinvel({ x: vx, y: vy, z: vz }, true);
  s.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  s.ballPose.snap();
};
{
  const s = create();
  try {
    setBall(s, 0, 2, 0);
    let started = 0;
    for (let i = 0; i < 240; i++) {
      s.step([n, n]);
      if (s.ballGround.started) started++;
    }
    assert.ok(started > 0, "Actual floor landing emits a contact transition");
    for (let i = 0; i < 240; i++) s.step([n, n]);
    const sequence = s.ballGround.sequence;
    for (let i = 0; i < 120; i++) s.step([n, n]);
    assert.equal(
      s.ballGround.sequence,
      sequence,
      "Resting floor contact is not emitted every tick",
    );
    for (const speed of [5, 20, 60]) {
      s.reset();
      setBall(s, 0, P.ball.radius + 0.5, 0, 0, -speed, 0);
      let bounced = false;
      for (let i = 0; i < 40; i++) {
        s.step([n, n]);
        if (s.ball.linvel().y > 0) {
          bounced = true;
          assert.equal(
            s.ballGround.grounded,
            true,
            `A ${speed}m/s physical floor bounce is detected on the impact step`,
          );
          break;
        }
      }
      assert.ok(bounced, "Fixture must make an actual floor impact");
    }
    s.reset();
    setBall(s, 0, P.ball.radius + 0.04, 0);
    assert.equal(
      s.ballGround.grounded,
      false,
      "Near-floor height alone is not contact",
    );
    for (const [label, x, y, z, vx, vy, vz] of [
      ["side wall", P.arena.halfWidth - P.ball.radius - 0.1, 12, 0, 20, 0, 0],
      ["ceiling", 0, P.arena.height - P.ball.radius - 0.1, 0, 0, 20, 0],
      [
        "crossbar",
        0,
        P.arena.goalHeight + 0.3,
        -P.arena.halfLength + 2,
        0,
        0,
        -20,
      ],
      [
        "bottom wall curve",
        P.arena.halfWidth - P.arena.ramp + 2,
        2,
        0,
        12,
        -1,
        0,
      ],
    ] as const) {
      s.reset();
      setBall(s, x, y, z, vx, vy, vz);
      for (let i = 0; i < 8; i++) {
        s.step([n, n]);
        assert.equal(s.ballGround.started, false, `${label} cannot be ground`);
      }
    }
    s.reset();
    s.cars[0].reset(0, 0, 0, 4);
    setBall(s, 0, 5.3, 0, 0, -2, 0);
    for (let i = 0; i < 20; i++) {
      s.step([n, n]);
      assert.equal(
        s.ballGround.grounded,
        false,
        "Car roof contact cannot be ground",
      );
    }
  } finally {
    s.dispose();
  }
}
for (const gameMode of ["soccar", "heatseeker"] as const) {
  const s = create(),
    m = new Match();
  try {
    m.gameMode = gameMode;
    m.start(s, "bot");
    m.phase = "playing";
    m.score = [1, 0];
    m.remaining = P.dt / 2;
    s.cars.forEach((c, i) => c.reset(i ? 20 : -20, 15, 0));
    setBall(s, 0, P.ball.radius + 0.03, 0);
    m.tick(s);
    assert.equal(
      m.phase,
      "playing",
      "Near-floor threshold cannot end regulation",
    );
    assert.equal(m.remaining, 0);
    setBall(s, 0, 5, 0);
    for (let i = 0; i < 15; i++) {
      s.step([n, n]);
      m.tick(s);
      assert.equal(m.phase, "playing", "Airborne zero-time stays playable");
    }
    setBall(s, 0, P.ball.radius, 0);
    for (let i = 0; i < 8 && m.phase === "playing"; i++) {
      s.step([n, n]);
      m.tick(s);
    }
    assert.equal(m.phase, "finished", "Real floor touch ends regulation");
    m.start(s, "bot");
    m.phase = "playing";
    m.remaining = 0;
    m.score = [0, 0];
    setBall(s, 0, 2, -P.arena.halfLength - P.ball.radius + 0.05, 0, 0, -20);
    s.step([n, n]);
    m.tick(s);
    assert.equal(m.score[0], 1);
    assert.equal(
      m.phase,
      "goal",
      "Goal at zero uses normal celebration/replay",
    );
    const stats = JSON.stringify(m.stats!.snapshot());
    captureGoalReplay(m, s);
    m.phase = "replay";
    m.skipReplay(s.cars[0].id, m.replay!.clip.goal.id, s);
    assert.equal(m.phase, "finished");
    assert.equal(JSON.stringify(m.stats!.snapshot()), stats);
    m.start(s, "bot");
    m.phase = "playing";
    m.remaining = 0;
    m.score = [0, 1];
    setBall(s, 0, 2, -P.arena.halfLength - P.ball.radius + 0.05, 0, 0, -20);
    s.step([n, n]);
    m.tick(s);
    captureGoalReplay(m, s);
    m.phase = "replay";
    m.skipReplay(s.cars[0].id, m.replay!.clip.goal.id, s);
    assert.equal(m.phase, "countdown");
    assert.equal(
      m.overtime,
      true,
      "A tying zero-time goal enters overtime directly",
    );
    m.phase = "playing";
    setBall(s, 0, P.ball.radius, 0);
    s.step([n, n]);
    m.tick(s);
    assert.equal(
      m.phase,
      "playing",
      "Sudden-death overtime does not finish on another floor touch",
    );
  } finally {
    s.dispose();
  }
}
for (const pack of trainingPacks) {
  const s = new Simulation(false, [
    { id: "training", name: "Guest", team: 0, controller: "local" },
  ]);
  const run = new TrainingRun(s, structuredClone(pack));
  try {
    assert.equal(run.duration, 10);
    run.shot.timeLimit = 7.5;
    run.reset();
    assert.equal(
      run.timeRemaining,
      7.5,
      "Per-scenario duration is configurable",
    );
    delete run.shot.timeLimit;
    run.reset();
    assert.equal(
      run.timeRemaining,
      10,
      "Unspecified duration defaults to 10 seconds",
    );
    run.shot.timeLimit = 10;
    const position = JSON.stringify({
      ball: s.ball.translation(),
      car: s.cars[0].body.translation(),
      clock: s.clock,
    });
    for (let i = 0; i < 600; i++) run.step(n);
    assert.equal(run.timeRemaining, 10);
    assert.equal(run.ready, true);
    assert.equal(
      JSON.stringify({
        ball: s.ball.translation(),
        car: s.cars[0].body.translation(),
        clock: s.clock,
      }),
      position,
    );
    for (const key of [
      "throttle",
      "steer",
      "jump",
      "boost",
      "slide",
      "pitch",
      "yaw",
      "roll",
    ] as const) {
      run.reset();
      const input = {
        ...n,
        [key]: typeof n[key] === "boolean" ? true : 0.5,
      } as PlayerInput;
      assert.equal(trainingGameplayInput(input), true);
      run.step(input);
      assert.equal(run.ready, false);
      assert.ok(run.elapsed > 0);
    }
    run.reset();
    run.step({ ...n, throttle: -1 });
    assert.equal(run.ready, false, "Reverse starts immediately");
    assert.ok(
      s.cars[0].body.linvel().z > 0,
      "Triggering reverse input is not consumed",
    );
    run.reset();
    run.step({ ...n, steer: 0.1 });
    run.frozen = false;
    s.ball.setGravityScale(1, true);
    run.elapsed = run.duration - 0.002;
    setBall(s, 0, 5, 0);
    run.step(n);
    assert.equal(run.timeRemaining, 0);
    assert.equal(run.outcome, null);
    assert.equal(s.ball.isEnabled(), true);
    setBall(s, 0, P.ball.radius, 0);
    for (let i = 0; i < 8 && !run.outcome; i++) run.step(n);
    assert.equal(run.outcome, "FAILED");
    run.reset();
    assert.equal(run.ready, true);
    assert.equal(run.timeRemaining, 10);
    if (pack.type !== "goalie") {
      run.step({ ...n, steer: 0.1 });
      run.frozen = false;
      s.ball.setGravityScale(1, true);
      run.elapsed = 10;
      setBall(s, 0, 2, -P.arena.halfLength - P.ball.radius + 0.05, 0, 0, -20);
      run.step(n);
      assert.equal(run.outcome, "SUCCESS");
      captureTrainingReplay(run);
      assert.ok(run.replay, "Zero-time goal still receives replay");
    }
  } finally {
    s.dispose();
  }
}
console.log(
  "PASS shared physical floor starts/resting dedup; wall/ceiling/frame/car exclusions; Soccar/Heatseeker zero-time goals/dead ball/overtime; all training first-input variants, 10-second clock, trigger input, zero-time play/score/fail and ready reset",
);
