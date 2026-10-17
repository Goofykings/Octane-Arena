import assert from "node:assert/strict";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { P } from "../src/config/physics";
import { Pads } from "../src/game/pads";
import { neutralInput } from "../shared/player";
import { HOOPS_CONFIG as H } from "../shared/hoops";
import {
  ReplayClock,
  playableReplay,
  decodeReplay,
  replayMessage,
} from "../shared/replay";
await initializeSimulation();
const n = neutralInput();
for (const mode of [
  "soccar",
  "dropshot",
  "hoops",
  "heatseeker",
  "rumble",
  "freeplay",
] as const) {
  for (const skip of [false, true]) {
    const s = new Simulation(),
      m = new Match(),
      pads = new Pads(mode === "freeplay" ? "soccar" : mode);
    m.gameMode = mode === "freeplay" ? "soccar" : mode;
    m.start(s, mode === "freeplay" ? "freeplay" : "bot");
    m.phase = "playing";
    s.cars[1].body.setEnabled(false);
    s.cars[0].reset(0, -15, 0, 4);
    s.cars[0].body.setLinvel({ x: 0, y: -5, z: 0 }, true);
    s.ball.setTranslation({ x: 0, y: 3, z: 0 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 240; i++) {
      s.step([n, n]);
      m.tick(s, pads);
    }
    s.lastTouchId = s.cars[0].id;
    s.lastTouchTime = s.clock;
    if (mode === "dropshot") {
      const d = s.dropshot!,
        p = d.arena.tiles[90].translation();
      d.touch(s.cars[0].id, 0, 0);
      d.damage(90, 8, s.clock);
      d.damage(90, 8, s.clock + 0.21);
      s.ball.setTranslation({ x: p.x, y: 3, z: p.z }, true);
      s.ball.setLinvel({ x: 0, y: -8, z: 0 }, true);
      for (let i = 0; i < 120 && m.phase === "playing"; i++) {
        s.step([n, n]);
        m.tick(s, pads);
      }
    } else if (mode === "hoops") {
      s.ball.setTranslation({ x: 0, y: H.hoopHeight + 1, z: -H.hoopZ }, true);
      m.tick(s, pads);
      s.ball.setTranslation({ x: 0, y: H.hoopHeight - 0.5, z: -H.hoopZ }, true);
      m.tick(s, pads);
    } else {
      s.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
      m.tick(s, pads);
    }
    assert.equal(m.phase, "goal", mode + " goal detection");
    for (let i = 0; i < 400 && m.phase === "goal"; i++) {
      s.step([n, n]);
      m.tick(s, pads);
    }
    assert.equal(m.phase, "replay", mode + " replay begins");
    const replay = m.replay!,
      clock = s.clock,
      reset = m.resetSequence,
      score = [...m.score];
    assert.ok(playableReplay(replay.clip));
    for (let i = 0; i < 120; i++) m.tick(s, pads);
    assert.equal(s.clock, clock, mode + " gameplay physics remains frozen");
    assert.ok(
      replay.clock.time > replay.clip.start + 0.3,
      mode + " independent replay clock advances",
    );
    if (mode === "dropshot")
      assert.equal(
        s.dropshot!.states[90],
        2,
        "Open floor preserved until replay ends",
      );
    if (skip)
      assert.equal(m.skipReplay(s.cars[0].id, replay.clip.goal.id, s), true);
    else for (let i = 0; i < 2400 && m.phase === "replay"; i++) m.tick(s, pads);
    assert.equal(
      m.resetSequence,
      reset + 1,
      mode + " reset exactly once after replay",
    );
    assert.equal(m.phase, mode === "freeplay" ? "playing" : "countdown");
    assert.deepEqual(m.score, score);
    if (mode === "dropshot") assert.equal(s.dropshot!.tiles, "0".repeat(140));
    for (const broken of [
      { ...replay.clip, count: 0 },
      { ...replay.clip, start: NaN },
      {
        ...replay.clip,
        frames: Float32Array.from(replay.clip.frames, (_, i) =>
          i === 0 ? NaN : 0,
        ),
      },
    ]) {
      assert.equal(playableReplay(broken), false);
      assert.equal(new ReplayClock(broken).done, true);
      assert.throws(() => decodeReplay(replayMessage("test", broken)));
      m.replay = { ...replay, clip: broken, clock: new ReplayClock(broken) };
      m.phase = "replay";
      const sequence = m.resetSequence;
      m.tick(s, pads);
      assert.equal(
        m.resetSequence,
        sequence + 1,
        "Invalid replay recovers to kickoff",
      );
    }
    s.dispose();
  }
}
console.log(
  "PASS six modes: real goals, frozen live physics with advancing replay clock, skip/natural completion, post-playback tile reset, one scoring award, invalid clip recovery",
);
