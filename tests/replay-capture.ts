import assert from "node:assert/strict";
import type { Match } from "../src/game/match";
import type { Simulation } from "../src/physics/simulation";
import type { Pads } from "../src/game/pads";
import type { TrainingRun } from "../src/extra/training/run";
import { neutralInput } from "../shared/player";
import { REPLAY_HZ, REPLAY_POST_GOAL } from "../shared/replay";
/** Fixtures advance real live physics during capture, never invent snapshots. */
export function captureGoalReplay(m: Match, s: Simulation, pads?: Pads) {
  for (
    let i = 0;
    i < REPLAY_HZ * (REPLAY_POST_GOAL + 1) && m.recorder.pendingGoal;
    i++
  ) {
    s.step(s.cars.map(() => neutralInput()));
    pads?.tick(s.cars);
    m.tick(s, pads);
  }
  assert.ok(m.replay, "Post-goal recording must finalize a real clip");
  assert.ok(
    m.replay.clip.end - m.replay.clip.goal.time >= REPLAY_POST_GOAL - 1e-7,
  );
}
export function captureTrainingReplay(run: TrainingRun) {
  for (
    let i = 0;
    i < REPLAY_HZ * (REPLAY_POST_GOAL + 1) && run.recorder.pendingGoal;
    i++
  )
    run.step(neutralInput());
  assert.ok(
    run.replay,
    "Training post-goal recording must finalize a real clip",
  );
  assert.ok(
    run.replay.clip.end - run.replay.clip.goal.time >= REPLAY_POST_GOAL - 1e-7,
  );
}
