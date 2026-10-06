import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Object3D, PerspectiveCamera } from "three";
import {
  createRingsCourse,
  ringGeometry,
  ringScale,
  ringTubeRadius,
} from "../src/extra/course";
import { RingsPhysics, RingsRun, ringsTime } from "../src/extra/rings";
import { ExtraRecords, type RecordStorage } from "../src/extra/storage";
import { GameCamera } from "../src/camera/camera";
import { Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import { bodies } from "../shared/catalog";
import { RingsLevel } from "../src/extra/rings-view";
import { Matrix4 } from "three";

await RAPIER.init();
const course = createRingsCourse(),
  again = createRingsCourse(),
  n = neutralInput();
assert.equal(course.rings.length, 40);
const earlySteps = course.rings
  .slice(1, 9)
  .map((r, i) => r.center.x - course.rings[i].center.x);
assert.ok(
  earlySteps.some((x) => x > 6) && earlySteps.some((x) => x < -6),
  "Opening rings should require left and right steering",
);
const earlyClimbs = course.rings
  .slice(1, 9)
  .map((r, i) => r.center.y - course.rings[i].center.y);
assert.ok(
  earlyClimbs.some((y) => y > 1.5) && earlyClimbs.some((y) => y < -1),
  "Opening needs noticeable climbs and drops",
);
assert.equal(
  (course.start.width * course.start.length) /
    (P.arena.halfWidth * 2 * P.arena.halfLength * 2),
  0.455,
);
assert.deepEqual(
  course.rings.map((r) => r.center.toArray()),
  again.rings.map((r) => r.center.toArray()),
);
const numbers = (color: string) =>
  course.rings.flatMap((r, i) => (r.difficulty === color ? [i + 1] : []));
assert.equal(numbers("green").length, 27);
assert.deepEqual(numbers("yellow"), [10, 13, 17, 20, 24, 28, 31, 34, 37, 39]);
assert.deepEqual(numbers("red"), [33, 36, 40]);
for (const r of course.rings) {
  assert.equal(r.opening, { green: 6, yellow: 3.2, red: 1.6 }[r.difficulty]);
  assert.ok(
    r.normal.z < -0.7,
    "Ring must face the forward course, not a blind reverse turn",
  );
  for (const body of Object.values(bodies))
    assert.ok(
      r.opening >
        1.8 * Math.hypot(body.halfWidth, body.halfHeight, body.halfLength),
      "Opening needs a generous clearance margin for both chassis shapes",
    );
}
for (let i = 1; i < 40; i++) {
  const prev = course.rings[i - 1],
    ring = course.rings[i];
  assert.ok(
    ring.center.distanceTo(prev.center) >= 12 &&
      ring.center.distanceTo(prev.center) < 19,
  );
  assert.ok(prev.normal.dot(ring.normal) > 0.9, "blind/sharp turn");
  assert.ok(Math.abs(ring.center.y - prev.center.y) < 2.6);
}
assert.ok(
  course.rings[39].opening >= 1.6,
  "final opening requires pixel-perfect car clearance",
);
assert.ok(course.finish.center.distanceTo(course.rings[39].center) > 20);
assert.equal(course.finish.width, 22);
assert.equal(course.finish.length, 28);
assert.ok(
  course.finish.center
    .clone()
    .sub(course.rings[39].center)
    .normalize()
    .dot(course.rings[39].normal) > 0.95,
  "Finish approach must follow the final ring",
);
const save = new Map<string, string>();
const storage: RecordStorage = {
  getItem: (k) => save.get(k) ?? null,
  setItem: (k, v) => {
    save.set(k, v);
  },
};
const p = new RingsPhysics(course),
  records = new ExtraRecords(course.id, storage),
  run = new RingsRun(p, records);
assert.equal(
  p.world.bodies.len(),
  1,
  "Rings must have only the car, with no hidden ball/bot",
);
assert.equal(
  p.world.colliders.len(),
  43,
  "40 torus colliders + two decks + car",
);
for (const col of p.ringColliders) {
  assert.equal(col.shapeType(), RAPIER.ShapeType.TriMesh);
  assert.equal(p.cameraObstacles(col), false);
}
assert.ok(
  p.cameraObstacles(p.startCollider) && p.cameraObstacles(p.finishCollider),
);
assert.equal(p.cameraObstacles(p.car.collider), false);
const g = ringGeometry();
assert.ok(g.index!.count / 3 <= 1000);
g.dispose();
// Empty opening and rounded inner/outer silhouette: query the real world mesh.
for (let i = 0; i < 40; i++) {
  const ring = course.rings[i],
    x = new Vector3(Math.cos(0.17), Math.sin(0.17), 0).applyQuaternion(
      ring.rotation,
    );
  const cast = (radius: number) =>
    p.world.castRayAndGetNormal(
      new RAPIER.Ray(
        ring.center
          .clone()
          .addScaledVector(x, radius)
          .addScaledVector(ring.normal, -2),
        ring.normal,
      ),
      4,
      false,
      undefined,
      undefined,
      p.car.collider,
    );
  assert.equal(cast(0), null, "invisible geometry inside opening");
  const scale = ringScale(ring);
  const inner = cast(scale * (1 - ringTubeRadius * 0.6)),
    outer = cast(scale * (1 + ringTubeRadius * 0.6));
  assert.ok(inner && outer, `ring ${i + 1} inner/outer collider missing`);
  assert.ok(
    new Vector3().copy(inner.normal).dot(x) < -0.2,
    "inner normal is square/flat",
  );
  assert.ok(
    new Vector3().copy(outer.normal).dot(x) > 0.2,
    "outer normal is square/flat",
  );
  // Finite-size sweeps cover the periodic seams too; an infinitely thin ray
  // exactly on a shared triangle edge is susceptible to float roundoff.
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const radial = new Vector3(
      Math.cos(angle),
      Math.sin(angle),
      0,
    ).applyQuaternion(ring.rotation);
    const origin = ring.center
      .clone()
      .addScaledVector(radial, scale)
      .addScaledVector(ring.normal, -2);
    assert.ok(
      p.world.castShape(
        origin,
        { x: 0, y: 0, z: 0, w: 1 },
        ring.normal,
        new RAPIER.Ball(0.05),
        0,
        4,
        true,
        undefined,
        undefined,
        p.car.collider,
      ),
      `ring ${i + 1} finite-size seam sweep missed`,
    );
  }
}
console.log(
  "PASS deterministic 40-ring difficulty curve, 45.5% start deck, open world, 40 rounded trimeshes and all inner/outer collision normals",
);
// Actual rigid cars must hit/deflect from both edges, not just ray detectors.
for (const id of ["ion", "vector"] as const)
  for (const index of [0, 9, 19, 29, 39])
    for (const side of [-1, 1]) {
      const ring = course.rings[index];
      const radial = new Vector3(
        Math.cos(0.5),
        Math.sin(0.5),
        0,
      ).applyQuaternion(ring.rotation);
      const origin = ring.center
        .clone()
        .addScaledVector(
          radial,
          ringScale(ring) * (1 + side * ringTubeRadius * 0.7),
        )
        .addScaledVector(ring.normal, -2);
      p.car.setBody(id);
      p.car.reset(origin.x, origin.z, 0, origin.y);
      p.car.body.setRotation(
        new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), ring.normal),
        true,
      );
      p.car.body.setLinvel(ring.normal.clone().multiplyScalar(23), true);
      let contacts = 0,
        deflection = 0;
      for (let i = 0; i < 40; i++) {
        p.step(n);
        p.world.contactPair(
          p.car.collider,
          p.ringColliders[index],
          (manifold) => {
            contacts += manifold.numContacts();
          },
        );
        const v = new Vector3().copy(p.car.body.linvel());
        assert.ok(v.length() <= P.car.maxSpeed + 0.001);
        deflection = Math.max(deflection, Math.abs(v.dot(radial)));
      }
      assert.ok(
        contacts > 0 && deflection > 0.5,
        `${id} ring ${index + 1} side ${side} did not physically glance/bounce`,
      );
    }
p.car.setBody("ion");
p.reset();
console.log(
  "PASS 20 real high-speed inner/outer torus car impacts across both bodies, with angled deflection and bounded energy",
);
// Loading/idle and a pause before starting must never contribute to the clock.
for (let i = 0; i < 60; i++) run.step(n, 10000 + i * 10);
assert.equal(run.elapsed(20000), 0);
run.pause(20000);
assert.equal(run.elapsed(30000), 0);
run.pause(30000);
run.start(31000);
assert.equal(run.elapsed(32234), 1.234);
run.pause(32234);
assert.equal(run.elapsed(50000), 1.234);
run.pause(51000);
assert.equal(run.elapsed(52000), 2.234);
assert.equal(ringsTime(74.382), "1:14.382");
run.reset();
const cross = (i: number, offset = new Vector3(), now = 60000 + i * 1000) => {
  const ring = course.rings[i],
    center = ring.center.clone().add(offset);
  run.observe(
    center.clone().addScaledVector(ring.normal, -1),
    center.clone().addScaledVector(ring.normal, 1),
    now,
  );
};
cross(0);
assert.equal(run.passed, 1);
// Reverse crossing of the current plane must not award progress.
const r1 = course.rings[1];
run.observe(
  r1.center.clone().addScaledVector(r1.normal, 1),
  r1.center.clone().addScaledVector(r1.normal, -1),
  61500,
);
assert.equal(run.passed, 1);
run.reset();
cross(4);
assert.equal(run.passed, 0, "future ring skipped checkpoint order");
assert.equal(run.reason, "restart", "Flying past future rings must not reset");
run.reset();
const r0 = course.rings[0],
  radial = new Vector3(1, 0, 0)
    .applyQuaternion(r0.rotation)
    .multiplyScalar(r0.opening + 2);
const side = r0.center.clone().add(radial);
const approachSequence = run.resetSequence;
run.observe(
  side.clone().addScaledVector(r0.normal, -2),
  side.clone().addScaledVector(r0.normal, -0.5),
  63000,
);
assert.equal(
  run.resetSequence,
  approachSequence,
  "approaching beside a ring incorrectly resets",
);
run.observe(
  side.clone().addScaledVector(r0.normal, -0.5),
  side.clone().addScaledVector(r0.normal, 2),
  64000,
);
assert.equal(run.reason, "restart", "edge glance immediately resets");
run.observe(
  side.clone().addScaledVector(r0.normal, 2),
  side.clone().addScaledVector(r0.normal, 5),
  65000,
);
assert.equal(run.reason, "restart", "Bypassing a ring must not reset");
assert.equal(run.resetSequence, approachSequence);
assert.equal(run.phase, "running");
assert.equal(run.passed, 0);
// Crossing must be measured at the plane, rather than at the endpoint/sphere.
const target = r0.center.clone(),
  off = new Vector3(1, 0, 0).applyQuaternion(r0.rotation);
run.observe(
  target.clone().addScaledVector(r0.normal, -2).addScaledVector(off, -8),
  target.clone().addScaledVector(r0.normal, 2).addScaledVector(off, 8),
  66000,
);
assert.equal(run.passed, 1);
for (let i = 1; i < 33; i++) cross(i, new Vector3(), 66000 + i * 1000);
assert.equal(run.passed, 33);
assert.equal(records.value.bestRings, 33);
p.car.body.setLinvel({ x: 3, y: 4, z: 5 }, true);
p.car.body.setAngvel({ x: 1, y: 2, z: 3 }, true);
p.car.boost = 3;
run.observe(new Vector3(500, 0, -500), new Vector3(500, -7, -500), 110000);
assert.equal(run.reason, "fall");
assert.equal(run.passed, 0);
assert.equal(run.elapsed(110001), 0);
assert.equal(p.car.boost, 100);
assert.ok(
  new Vector3().copy(p.car.body.translation()).distanceTo(course.spawn) < 1e-5,
);
assert.equal(new Vector3().copy(p.car.body.linvel()).length(), 0);
assert.equal(new Vector3().copy(p.car.body.angvel()).length(), 0);
assert.equal(new ExtraRecords(course.id, storage).value.bestRings, 33);
console.log(
  "PASS timer/pause, ordered swept checkpoints, forgiving bypasses, no future/backward skips, height-only fall reset and saved progress",
);
// A genuine finish landing on wheels is required, not a finish bounding sphere.
const land = () => {
  const f = course.finish;
  p.car.reset(f.center.x, f.center.z, 0, f.center.y + 1.4);
  for (let i = 0; i < 180; i++) p.step(n);
  assert.ok(
    p.landedOnFinish(),
    "wheel contacts did not register finish landing",
  );
};
land();
const pos = new Vector3().copy(p.car.body.translation());
run.observe(pos, pos, 111000);
assert.notEqual(run.phase, "complete", "finish can be skipped");
run.reset();
run.start(120000);
for (let i = 0; i < 40; i++) cross(i, new Vector3(), 121000 + i * 1000);
assert.equal(run.passed, 40);
assert.notEqual(run.phase, "complete", "last ring finished without landing");
land();
const landing = new Vector3().copy(p.car.body.translation());
run.observe(landing, landing, 165382);
assert.equal(run.phase, "complete");
assert.equal(run.elapsed(200000), 45.382);
assert.equal(new ExtraRecords(course.id, storage).value.bestTime, 45.382);
run.reset();
assert.equal(records.value.bestTime, 45.382);
records.complete(55);
assert.equal(records.value.bestTime, 45.382);
records.complete(40);
assert.equal(new ExtraRecords(course.id, storage).value.bestTime, 40);
const unavailable = new ExtraRecords(course.id, {
  getItem: () => {
    throw Error();
  },
  setItem: () => {
    throw Error();
  },
});
unavailable.progress(12);
assert.equal(unavailable.value.bestRings, 12);
console.log(
  "PASS real finish landing, no early completion, frozen completion time, first/better best times, reset and unavailable-storage fallback",
);
// Car controls and camera are the same implementation. Compare a soccer car and
// Rings car in unobstructed midair, where resources/level geometry differ only.
const normal = new Simulation(true);
const a = normal.cars[0],
  b = p.car;
normal.ball.setEnabled(false);
normal.ballCollider.setCollisionGroups(0);
normal.cars[1].body.setEnabled(false);
normal.cars[1].collider.setCollisionGroups(0);
a.reset(0, 0, 0, 10);
b.reset(0, 0, 0, 10);
for (let i = 0; i < 45; i++) {
  const input = { ...n, boost: true, pitch: 0.35, yaw: -0.2, roll: 0.15 };
  a.boost = 100;
  normal.step([input, n]);
  p.step(input);
  assert.ok(
    new Vector3().copy(a.body.translation()).distanceTo(b.body.translation()) <
      1e-5,
    "Rings changed car aerial motion",
  );
  assert.ok(
    new Quaternion()
      .copy(a.body.rotation())
      .normalize()
      .angleTo(new Quaternion().copy(b.body.rotation()).normalize()) < 1e-5,
  );
  assert.equal(b.boost, 100);
}
const camera = new PerspectiveCamera(),
  controller = new GameCamera(camera),
  model = new Object3D();
model.position.copy(b.body.translation());
model.quaternion.copy(b.body.rotation());
controller.ballMode = true;
for (let i = 0; i < 60; i++)
  controller.update(model, null, p, 1 / 60, false, i / 60);
assert.ok(
  [
    camera.position.x,
    camera.position.y,
    camera.position.z,
    camera.quaternion.w,
  ].every(Number.isFinite),
);
assert.equal(controller.debug.mode, "Car Cam");
normal.dispose();
const colliderCount = p.world.colliders.len();
const level = new RingsLevel(course, "stadium");
assert.ok(ringTubeRadius > 0.055 && ringTubeRadius < 0.08);
assert.ok(level.clouds.count > 300);
assert.equal(
  p.world.colliders.len(),
  colliderCount,
  "Clouds add no collision geometry",
);
const matrix = new Matrix4(),
  cloudPosition = new Vector3(),
  cloudScale = new Vector3(),
  cloudRotation = new Quaternion();
for (let i = 0; i < level.clouds.count; i++) {
  level.clouds.getMatrixAt(i, matrix);
  matrix.decompose(cloudPosition, cloudRotation, cloudScale);
  assert.ok(
    cloudPosition.y + cloudScale.y <= course.failHeight - 11.99,
    "Death plane must be above the entire cloud",
  );
  assert.ok(
    Math.abs(cloudScale.x - cloudScale.y) < 1e-5 &&
      Math.abs(cloudScale.y - cloudScale.z) < 1e-5,
    "Cloud puffs remain spheres",
  );
}
level.dispose();
console.log(
  "PASS thicker rings with preserved openings, non-colliding white sphere clouds safely below the death plane",
);
p.dispose();
console.log(
  "PASS identical normal aerial physics/inputs, unlimited boost, existing camera gracefully follows with no ball",
);
