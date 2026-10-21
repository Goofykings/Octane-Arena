import { TrainingPowerArrow } from "../src/extra/training/power-arrow";
import { P } from "../src/config/physics";
import assert from "node:assert/strict";
import { TrainingDraft } from "../src/game/custom-training-editor";
import {
  CustomTrainingLibrary,
  LocalTrainingPackStorage,
} from "../src/game/custom-training";
import {
  customTrainingPackSchema,
  validatePlayablePack,
} from "../shared/custom-training";
const values = new Map<string, string>();
const adapter = new LocalTrainingPackStorage(
  {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
  },
  "cleanup-test",
);
const library = new CustomTrainingLibrary(adapter);
const draft = new TrainingDraft(library.create("Cleanup pack"));
draft.add();
draft.add();
const ids = draft.pack.shots.map((s) => s.id);
draft.pack.shots[1].ballLaunchSpeed = 32;
draft.changed();
draft.save(library, "Guest");
assert.equal(draft.dirty, false);
const old = JSON.parse(JSON.stringify(draft.pack));
for (const shot of old.shots) delete shot.enabled;
assert.ok(customTrainingPackSchema.parse(old).shots.every((s) => s.enabled));
draft.setEnabled(ids[1], false);
assert.equal(draft.pack.shots.length, 3);
assert.equal(draft.pack.shots[1].ballLaunchSpeed, 32);
assert.equal(draft.dirty, true);
const playable = validatePlayablePack(draft.pack);
assert.deepEqual(
  playable.shots.map((s) => s.id),
  [ids[0], ids[2]],
);
assert.equal(draft.pack.shots.length, 3);
draft.save(library, "Guest");
const restored = new TrainingDraft(
  new CustomTrainingLibrary(adapter).get(draft.pack.id)!,
);
assert.equal(restored.pack.shots[1].enabled, false);
assert.equal(restored.pack.shots[1].ballLaunchSpeed, 32);
restored.setEnabled(ids[1], true);
assert.equal(validatePlayablePack(restored.pack).shots.length, 3);
restored.select(1);
restored.setEnabled(ids[1], false);
restored.add(true);
assert.equal(restored.index, 2);
assert.equal(restored.shot.enabled, true);
assert.equal(restored.shot.ballLaunchSpeed, 32);
assert.notEqual(restored.shot.id, ids[1]);
assert.equal(restored.pack.shots[1].id, ids[1]);
restored.undo();
assert.equal(restored.pack.shots.length, 3);
restored.redo();
assert.equal(restored.pack.shots.length, 4);
const history = new TrainingDraft(library.get(draft.pack.id)!);
history.select(0);
history.save(library, "Guest");
const start = history.shot.ballPosition.x;
history.beginChange();
for (let i = 1; i <= 12; i++) {
  history.shot.ballPosition.x = start + i / 10;
  history.changed();
}
history.endChange();
assert.equal(history.canUndo, true);
history.undo();
assert.equal(history.shot.ballPosition.x, start);
assert.equal(history.dirty, false);
history.redo();
assert.equal(history.shot.ballPosition.x, start + 1.2);
assert.equal(history.dirty, true);
history.save(library, "Guest");
history.undo();
assert.equal(history.dirty, true);
history.redo();
assert.equal(history.dirty, false);
const count = history.pack.shots.length;
history.delete();
assert.equal(history.pack.shots.length, count - 1);
history.undo();
assert.equal(history.pack.shots.length, count);
history.redo();
assert.equal(history.pack.shots.length, count - 1);
for (const shot of history.pack.shots) history.setEnabled(shot.id, false);
assert.throws(() => validatePlayablePack(history.pack), /Enable at least one/);
console.log(
  "PASS cleanup: legacy enabled defaults, three-shot persistence, enabled-only nonmutating exports, reversible disable, adjacent enabled duplicate, grouped drag undo/redo, dirty save baseline and deletion history.",
);

for (const [limit, base, range, color] of [
  [P.ball.maxSpeed, 2.8, 15.2, 0x51eaff],
  [P.car.maxSpeed, 1.1, 11.9, 0x87aaff],
]) {
  const arrow = new TrainingPowerArrow(limit, base, range, color);
  assert.equal(arrow.shaft.geometry.type, "CylinderGeometry");
  arrow.setPower(limit * 0.5);
  assert.ok(Math.abs(arrow.speedAtLength(arrow.length) - limit * 0.5) < 1e-8);
  const low = arrow.shaft.material.color.clone();
  arrow.setPower(limit * 0.8);
  const mid = arrow.shaft.material.color.clone();
  assert.ok(mid.r > low.r && mid.g < low.g, "Power color blends toward red");
  arrow.setPower(limit * 2);
  assert.equal(arrow.length, base + range);
  assert.equal(arrow.shaft.material.color.getHex(), 0xff3030);
  assert.equal(arrow.speedAtLength(1000), limit);
  assert.equal(arrow.speedAtLength(0), 0);
}
console.log(
  "PASS larger solid power arrows: inverse speed/length mapping, continuous near-limit color gradient and hard visual/physical caps.",
);
