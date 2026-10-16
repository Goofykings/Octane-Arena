import assert from "node:assert/strict";
import * as T from "three";
import {
  BoostPlume,
  boostStyles,
  particleBoostTuning,
} from "../src/effects/boost-styles";
import { VehicleEffects } from "../src/effects/vehicle-effects";
import { carModel, disposeModel } from "../src/render/models";
const tuning = particleBoostTuning;
function layers(p: BoostPlume) {
  return p.children.filter(
    (o) => o instanceof T.InstancedMesh,
  ) as T.InstancedMesh[];
}
function samples(p: BoostPlume) {
  const out: { position: T.Vector3; size: number }[] = [];
  const matrix = new T.Matrix4(),
    position = new T.Vector3(),
    scale = new T.Vector3(),
    rotation = new T.Quaternion();
  for (const l of layers(p))
    for (let i = 0; i < l.count; i++) {
      l.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      if (scale.length() > 1e-6)
        out.push({ position: position.clone(), size: scale.length() });
    }
  return out;
}
for (const [id, style] of Object.entries(boostStyles)) {
  const p = new BoostPlume(id);
  try {
    const buffers = layers(p).map((l) => [
      l.geometry,
      l.material,
      l.instanceMatrix,
      l.instanceColor,
    ]);
    p.animate(50, false);
    assert.equal(p.visible, false);
    p.animate(50, true);
    if (style.stream) {
      assert.equal(p.visible, true);
      assert.ok(
        samples(p).some((s) => s.position.z > style.length * 0.7),
        id + " stream remains instant",
      );
      p.animate(50.01, false);
      assert.equal(p.visible, false);
      continue;
    }
    assert.ok(samples(p).length > 0);
    assert.ok(
      Math.max(...samples(p).map((s) => s.position.z)) < 0.13,
      id + " starts at outlet, not full length",
    );
    p.animate(50.1, true);
    const early = samples(p),
      earlyLength = Math.max(...early.map((s) => s.position.z));
    assert.ok(
      early.length < layers(p).reduce((n, l) => n + l.count, 0),
      "pool fills gradually",
    );
    p.animate(50.25, true);
    const middleLength = Math.max(...samples(p).map((s) => s.position.z));
    p.animate(50.49, true);
    const mature = samples(p),
      matureLength = Math.max(...mature.map((s) => s.position.z));
    assert.ok(middleLength > earlyLength * 1.6, id + " grows backward");
    assert.ok(
      matureLength > style.length * 1.1,
      id + " longer than original trail",
    );
    assert.ok(matureLength <= style.length * tuning.rangeMultiplier + 0.15);
    assert.ok(
      mature.length > layers(p).reduce((n, l) => n + l.count, 0) * 0.8,
      "full emission by half a second",
    );
    p.animate(50.51, false);
    assert.ok(p.visible && samples(p).length > 0, "release retains particles");
    const tail = samples(p).length;
    p.animate(50.8, false);
    assert.ok(samples(p).length < tail, "no new particles on release");
    p.animate(51.02, false);
    assert.equal(p.visible, false);
    assert.equal(samples(p).length, 0);
    p.animate(51.1, true);
    assert.ok(
      Math.max(...samples(p).map((s) => s.position.z)) < 0.13,
      "restart emits from outlet again",
    );
    p.resetParticles();
    assert.equal(p.visible, false);
    assert.equal(samples(p).length, 0);
    p.animate(2, true);
    p.animate(2.3, true);
    p.animate(1, true);
    assert.ok(
      Math.max(...samples(p).map((s) => s.position.z)) < 0.13,
      "rewind clears old trail",
    );
    layers(p).forEach((l, i) =>
      [l.geometry, l.material, l.instanceMatrix, l.instanceColor].forEach(
        (v, j) => assert.equal(v, buffers[i][j], "fixed buffers"),
      ),
    );
  } finally {
    p.dispose();
  }
}
// Straight fast travel inherits emitter velocity: particles don't get left detached.
const car = new T.Group(),
  scene = new T.Scene(),
  p = new BoostPlume("ion");
scene.add(car);
car.add(p);
p.animate(0, true);
for (let i = 1; i <= 30; i++) {
  car.position.z = (-23 * i) / 60;
  p.animate(i / 60, true);
}
assert.ok(Math.max(...samples(p).map((s) => s.position.z)) < 3.1);
assert.ok(
  Math.min(...samples(p).map((s) => s.position.z)) < 0.15,
  "fresh particles remain at moving nozzle",
);
// A rendered particle follows its birth trajectory, not a later rotating car frame.
const vapor = layers(p)[0],
  matrix = new T.Matrix4(),
  before = new T.Vector3();
vapor.getMatrixAt(4, matrix);
p.updateWorldMatrix(true, false);
before.setFromMatrixPosition(matrix).applyMatrix4(p.matrixWorld);
car.rotation.y = Math.PI / 2;
p.animate(0.5, false);
vapor.getMatrixAt(4, matrix);
p.updateWorldMatrix(true, false);
const after = new T.Vector3()
  .setFromMatrixPosition(matrix)
  .applyMatrix4(p.matrixWorld);
assert.ok(
  after.distanceTo(before) < 1e-4,
  "turn does not teleport existing particles",
);
car.position.set(100, 0, 0);
p.animate(0.51, true);
assert.ok(
  Math.max(...samples(p).map((s) => s.position.z)) < 0.13,
  "teleport resets trail",
);
p.dispose();
// Shared integration used by Garage and live/replayed car proxies.
for (const preview of [true, false]) {
  const model = carModel(0x66aaff),
    scene = new T.Scene();
  scene.add(model);
  const fx = new VehicleEffects(model, scene, 0x66aaff, "plasma");
  const plume = model.getObjectByName("boost-plume") as BoostPlume;
  const car = {
    boosting: true,
    wheelContact: [false, false, false, false],
    supersonic: false,
    wheelHits: Array.from({ length: 4 }, () => new T.Vector3()),
    normal: new T.Vector3(0, 1, 0),
  } as any;
  const tick = (time: number, on: boolean) => {
    car.boosting = on;
    if (preview) fx.previewBoost(time, on);
    else fx.update(car, 1 / 60, time, true);
  };
  tick(0, true);
  tick(0.3, true);
  tick(0.31, false);
  assert.ok(plume.visible, "shared preview/game/replay release tail");
  tick(0.82, false);
  assert.equal(plume.visible, false);
  tick(0.9, true);
  fx.reset();
  assert.equal(plume.visible, false);
  fx.dispose();
  disposeModel(model);
}
console.log(
  "PASS particle emission at outlets, 0.5s growth/lifetime, 65% longer range, fast travel, continuous/restarted emission, release fade, moving/rotating outlet continuity, teleport/rewind reset, shared Garage/live/replay lifecycle, fixed buffers and unchanged instant streams",
);
