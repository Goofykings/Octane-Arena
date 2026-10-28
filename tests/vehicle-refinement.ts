import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { bodies, type BodyId } from "../shared/catalog";
import { P, curvature } from "../src/config/physics";
import { VEHICLE_VISUALS as V } from "../src/config/vehicle-visuals";
import {
  wheelMount,
  wheelMountY,
  wheelRadius,
  wheelHalfWidth,
} from "../src/car/wheels";
import { animateWheels, carModel, disposeModel } from "../src/render/models";
import {
  ARENA_CARS,
  prepareArenaCar,
  setArenaCarAsset,
  type ArenaCarBody,
} from "../src/render/arena-car-model";
await initializeSimulation();
const n = neutralInput();
function fixture() {
  const s = new Simulation(true);
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  return s;
}
const geometry: any[] = [];
for (const id of Object.keys(bodies) as BodyId[])
  for (const imported of [false, true]) {
    if (imported && !(id in ARENA_CARS)) continue;
    if (imported) {
      const b = id as ArenaCarBody,
        file = readFileSync("public/" + ARENA_CARS[b].url);
      const gltf = await new GLTFLoader().parseAsync(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
        "",
      );
      setArenaCarAsset(prepareArenaCar(gltf, b), b);
    }
    const s = fixture(),
      c = s.cars[0],
      model = carModel(0x5588cc, id),
      pose = new T.Group();
    c.setBody(id);
    c.grounded = true;
    c.wheelContact.fill(true);
    pose.position.set(0, 0.31, 0);
    c.wheelHits.forEach((v, i) =>
      v.copy(wheelMount(id, i)).setY(-0.31).add(pose.position),
    );
    // Abrupt maximum compression requests stay tightly bounded; root/hitbox never lean.
    c.wheelHits.forEach((v) => (v.y = 1));
    for (let i = 0; i < 60; i++)
      animateWheels(model, 0, 0, 1 / 60, c, pose, { angle: 0, steer: 0 });
    for (const mount of model.userData.wheelMounts as T.Group[])
      assert.ok(
        mount.position.y <=
          wheelMountY + wheelRadius * V.compressionRadius + 1e-8,
      );
    const chassis = model.userData.visualChassis as T.Group;
    const visualState = model.userData.suspensionVisual;
    visualState.longitudinal = 1;
    visualState.lateral = 1;
    animateWheels(model, 0, 0, 0, c, pose, { angle: 0, steer: 0 });
    model.updateMatrixWorld(true);
    const sides = new Map<T.Material, T.Side>();
    chassis.traverse((o) => {
      if (o instanceof T.Mesh)
        for (const m of [o.material].flat()) {
          sides.set(m, m.side);
          m.side = T.DoubleSide;
        }
    });
    const cast = new T.Raycaster(),
      up = new T.Vector3(0, 1, 0);
    const spins = model.userData.wheels as T.Group[];
    function archClearance() {
      let clearance = Infinity,
        hits = 0;
      for (let i = 0; i < 4; i++) {
        const spin = spins[i],
          center = spin.getWorldPosition(new T.Vector3());
        const radius =
          (spin.userData.visualRadius as number) ?? wheelRadius * spin.scale.y;
        // Only the visible outer tread; skirts intentionally cover the inner sidewall.
        for (const side of [0.4, 0.7, 1])
          for (const longitudinal of [-0.8, -0.4, 0, 0.4, 0.8]) {
            const origin = center.clone();
            origin.x += (i % 2 ? 1 : -1) * side * wheelHalfWidth * spin.scale.x;
            origin.z += longitudinal * radius;
            cast.set(origin, up);
            const hit = cast.intersectObject(chassis, true)[0];
            if (hit) {
              hits++;
              clearance = Math.min(
                clearance,
                hit.distance -
                  Math.sqrt(1 - longitudinal * longitudinal) * radius,
              );
            }
          }
      }
      return { clearance, hits };
    }
    const compressed = archClearance();
    // Compare the mesh to its authored fit: some fender trim already covers the
    // tread at rest. Allow at most 1 cm of overlap beyond the authored fit
    // (or 1 cm total where the authored fit is clear), even at maximum combined lean.
    for (const mount of model.userData.wheelMounts as T.Group[])
      mount.position.y = wheelMountY;
    chassis.rotation.set(0, 0, 0);
    chassis.position.y = 0;
    model.updateMatrixWorld(true);
    const baseline = archClearance();
    for (const [m, side] of sides) m.side = side;
    geometry.push({ body: id, imported, baseline, compressed });
    if (Number.isFinite(baseline.clearance))
      assert.ok(
        compressed.clearance >= Math.min(0, baseline.clearance) - 0.01,
        id + " " + imported + " excessive additional fender overlap " + JSON.stringify({baseline, compressed}),
      );
    assert.deepEqual(model.quaternion.toArray(), [0, 0, 0, 1]);
    disposeModel(model);
    s.dispose();
    if (imported) setArenaCarAsset(null, id as ArenaCarBody);
  }
console.log(
  "PASS bounded compression against procedural/GLB wheel arches",
  geometry,
);
// Weight transfer follows motion, not input; compare equal elapsed time at three render rates.
const weights: any[] = [];
for (const fps of [30, 60, 144])
  for (const kind of ["accelerate", "brake", "left", "right", "air"]) {
    const s = fixture(),
      c = s.cars[0],
      model = carModel(0xffffff),
      pose = new T.Group();
    c.setBody("vector");
    c.grounded = kind !== "air";
    c.wheelContact.fill(kind !== "air");
    pose.position.set(0, 0.31, 0);
    c.wheelHits.forEach((v, i) =>
      v.copy(wheelMount("vector", i)).setY(-0.31).add(pose.position),
    );
    for (let i = 0; i < fps; i++) {
      const t = i / fps;
      const velocity = new T.Vector3(
        kind === "left" ? -20 * t : kind === "right" ? 20 * t : 0,
        0,
        kind === "brake" ? -20 + 18 * t : -18 * t,
      );
      c.body.setLinvel(velocity, true);
      const before = JSON.stringify({
        p: c.body.translation(),
        q: c.body.rotation(),
        v: c.body.linvel(),
        w: c.body.angvel(),
      });
      animateWheels(model, 0, 0, 1 / fps, c, pose, { angle: 0, steer: 0 });
      assert.equal(
        JSON.stringify({
          p: c.body.translation(),
          q: c.body.rotation(),
          v: c.body.linvel(),
          w: c.body.angvel(),
        }),
        before,
      );
    }
    const state = model.userData.suspensionVisual,
      offsets = state.offsets;
    assert.ok(
      Math.abs(state.pitch) <= V.maxPitch && Math.abs(state.roll) <= V.maxRoll,
    );
    if (kind === "accelerate") {
      assert.ok(state.pitch > 0);
      assert.ok(offsets[2] > offsets[0]);
    }
    if (kind === "brake") {
      assert.ok(state.pitch < 0);
      assert.ok(offsets[0] > offsets[2]);
    }
    if (kind === "left") {
      assert.ok(state.roll < 0);
      assert.ok(offsets[1] > offsets[0]);
    }
    if (kind === "right") {
      assert.ok(state.roll > 0);
      assert.ok(offsets[0] > offsets[1]);
    }
    if (kind === "air") assert.equal(state.pitch, 0);
    weights.push({ fps, kind, pitch: state.pitch, roll: state.roll });
    c.grounded = false;
    c.wheelContact.fill(false);
    for (let i = 0; i < fps; i++)
      animateWheels(model, 0, 0, 1 / fps, c, pose, { angle: 0, steer: 0 });
    assert.ok(
      Math.abs(state.pitch) < V.maxPitch * 1e-5 &&
        Math.abs(state.roll) < V.maxRoll * 1e-5,
      "smooth neutral return in air",
    );
    disposeModel(model);
    s.dispose();
  }
for (const kind of ["accelerate", "brake", "left", "right"]) {
  const a = weights.filter((w) => w.kind === kind);
  assert.ok(
    Math.max(...a.map((w) => w.pitch)) - Math.min(...a.map((w) => w.pitch)) <
      1e-6,
  );
  assert.ok(
    Math.max(...a.map((w) => w.roll)) - Math.min(...a.map((w) => w.roll)) <
      1e-6,
  );
}
console.log(
  "PASS motion-driven weight transfer, correct axle/side signs, no airborne squat, cosmetic isolation, smoothing and recorded-wheel path",
  weights,
);
// Real wall slide: throttle must not erase existing slip on its first tick.
const wallSamples: any[] = [];
for (const speed of [0, 5, 15, 23]) {
  const s = fixture(),
    c = s.cars[0];
  c.setBody("vector");
  const R = (await import("@dimforge/rapier3d-compat")).default;
  s.world.createCollider(
    R.ColliderDesc.cuboid(0.2, 15, 15).setTranslation(6.2, 18, 0),
  );
  const up = new T.Vector3(-1, 0, 0),
    forward = new T.Vector3(0, 0, -1);
  c.reset(5.69, 0, 0, 18);
  c.body.setRotation(
    new T.Quaternion().setFromRotationMatrix(
      new T.Matrix4().makeBasis(
        forward.clone().cross(up),
        up,
        forward.clone().negate(),
      ),
    ),
    true,
  );
  c.body.setLinvel({ x: 0, y: -3, z: -speed }, true);
  for (let i = 0; i < 12; i++) s.step([n, n]);
  const before = c.wheels[0].longitudinalFriction,
    down = c.body.linvel().y;
  s.step([{ ...n, throttle: 1 }, n]);
  const first = c.wallGrip;
  assert.ok(first - before < 0.03);
  assert.ok(
    c.body.linvel().y < down * 0.9,
    "sliding persists on throttle press",
  );
  const checkpoint = c.capturePrediction();
  c.wallTraction = 0;
  c.restorePrediction(checkpoint);
  assert.ok(c.wallTraction > 0);
  for (let i = 0; i < 47; i++) s.step([{ ...n, throttle: 1 }, n]);
  assert.ok(c.wallGrip < 0.85 && c.wallGrip >= first);
  wallSamples.push({ speed, first, grip: c.wallGrip, slip: c.wallSlip });
  s.dispose();
}
assert.ok(
  wallSamples[3].grip > wallSamples[1].grip &&
    wallSamples[1].grip > wallSamples[0].grip,
);
console.log(
  "PASS progressive slip/speed-dependent wall friction and prediction checkpoint",
  wallSamples,
);
