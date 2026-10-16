import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../src/game/authoritative-match";
import { starter } from "../shared/catalog";
import { neutralInput } from "../shared/player";
import {
  REPLAY_HZ,
  REPLAY_POST_GOAL,
  BALL_STRIDE,
  CAR_STRIDE,
  RC,
  ReplaySampler,
} from "../shared/replay";
import { P } from "../src/config/physics";
await initializeMatchPhysics();
const players = [0, 1].map((i) => ({
  id: `human-${i}`,
  name: "Same Name",
  team: i as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
for (const mode of ["soccar", "heatseeker"] as const) {
  const game = new NetworkMatch(players, "city", `post-${mode}`, mode);
  try {
    game.match.phase = "playing";
    for (let i = 0; i < 660; i++) game.step(i * P.dt * 1000);
    const s = game.simulation,
      m = game.match;
    s.cars[0].reset(-8, 0, 0, 4);
    s.cars[1].reset(8, 0, Math.PI, 5);
    s.cars.forEach((c, i) => {
      c.boost = 100;
      c.body.setLinvel({ x: 0, y: 0, z: i ? 8 : -10 }, true);
      c.body.setAngvel({ x: 0.5, y: 1.5, z: 0.3 }, true);
    });
    s.lastTouchId = players[0].id;
    s.lastTouchTime = s.clock;
    s.ball.setTranslation({ x: 0, y: 2, z: -P.arena.halfLength - 1.4 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
    game.step(660 * P.dt * 1000);
    assert.equal(m.phase, "goal");
    assert.equal(Boolean(m.replay), false);
    assert.ok(m.recorder.pendingGoal);
    const goalTime = m.recorder.pendingGoal.time,
      goalPositions = s.cars.map((c) =>
        new Vector3().copy(c.body.translation()),
      );
    const stats = JSON.stringify(
      m.stats!.snapshot().map(({ ping, ...p }) => p),
    );
    const eventCount = m.stats!.events.length;
    for (let i = 1; i <= REPLAY_HZ * REPLAY_POST_GOAL; i++) {
      for (const p of players)
        game.accept(
          p.id,
          i,
          { ...neutralInput(), throttle: 1, boost: true, yaw: 0.4, roll: 0.15 },
          (660 + i) * P.dt * 1000,
        );
      game.step((660 + i) * P.dt * 1000);
      if (i < REPLAY_HZ * REPLAY_POST_GOAL)
        assert.equal(
          m.replay,
          null,
          "Never finalize before one second of live physics",
        );
    }
    assert.ok(m.replay);
    const clip = m.replay.clip;
    assert.ok(Math.abs(clip.end - goalTime - REPLAY_POST_GOAL) < 1e-7);
    assert.ok(goalTime - clip.start > 4.9);
    assert.ok(
      clip.count >= 720 && clip.count <= 721,
      "Bounded five-before/one-after buffer",
    );
    assert.equal(clip.events.filter((e) => e.kind === "goal").length, 1);
    const last = (clip.count - 1) * clip.stride;
    for (let i = 0; i < 2; i++) {
      const at = last + BALL_STRIDE + i * CAR_STRIDE;
      const position = new Vector3().fromArray(clip.frames, at);
      assert.ok(
        position.distanceTo(s.cars[i].body.translation()) < 1e-4,
        "Recorded endpoint equals authoritative state, no resimulation",
      );
      assert.ok(
        position.distanceTo(goalPositions[i]) > 5,
        "Both cars keep moving after goal",
      );
      assert.equal(clip.frames[at + RC.boosting], 1);
      if (mode === "heatseeker") assert.equal(clip.frames[at + RC.boost], 100);
      else assert.ok(clip.frames[at + RC.boost] < 100);
      assert.ok(
        new Vector3().fromArray(clip.frames, at + RC.angular).length() > 0.1,
        "Rotation continues",
      );
    }
    const sampler = new ReplaySampler(clip),
      sample = sampler.sample(goalTime + 0.2);
    const early = new Vector3().fromArray(sample, BALL_STRIDE);
    sampler.sample(goalTime + 0.9);
    assert.ok(
      early.distanceTo(new Vector3().fromArray(sample, BALL_STRIDE)) > 3,
      "Playback continues moving well after the goal",
    );
    const frozen = clip.frames.slice();
    for (let i = 0; i < 20; i++) game.step((800 + i) * P.dt * 1000);
    assert.deepEqual(
      clip.frames,
      frozen,
      "Finalized clip is immutable while celebration keeps moving",
    );
    assert.equal(
      JSON.stringify(m.stats!.snapshot().map(({ ping, ...p }) => p)),
      stats,
    );
    assert.equal(m.stats!.events.length, eventCount);
    assert.deepEqual(m.score, [1, 0]);
  } finally {
    game.dispose();
  }
}
console.log(
  "PASS authoritative Soccar/Heatseeker five-second lead-in + exact one-second moving/boosting/rotating tail, immutable real endpoints, interpolated playback motion and single goal/stat events",
);
