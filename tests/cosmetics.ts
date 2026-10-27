import assert from "node:assert/strict";
import * as T from "three";
import { bodies, inventory, starter, type BodyId } from "../shared/catalog";
import { presetSchema } from "../shared/accounts";
import { Garage } from "../src/game/inventory";
import { carModel, disposeModel } from "../src/render/models";
import { boostStyles, BoostPlume } from "../src/effects/boost-styles";
import { VehicleEffects } from "../src/effects/vehicle-effects";
import { wheelMount, wheelMountY } from "../src/car/wheels";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  },
});
// Ion survives only as a physics fixture; the garage offers the four GLB bodies.
assert.equal(Object.keys(bodies).length, 5);
assert.deepEqual(
  inventory.body.map((b) => b.id),
  ["vector", "lowflat", "boxy", "wedge"],
);
assert.equal(inventory.topper.length, 11); // Ten sculptures plus None.
assert.equal(inventory.boost.length, 10);
assert.equal(starter().body, "vector");
const garage = new Garage();
for (const { id: body } of inventory.body) {
  for (const topper of inventory.topper) {
    const preset = {
      ...starter(),
      body,
      topper: topper.id,
      boost:
        inventory.boost[
          inventory.topper.indexOf(topper) % inventory.boost.length
        ].id,
    };
    assert.ok(presetSchema.safeParse(preset).success);
    Object.assign(garage.current, preset);
    garage.save();
    const loaded = new Garage().current;
    assert.equal(loaded.body, body);
    assert.equal(loaded.topper, topper.id);
    assert.equal(loaded.boost, preset.boost);
    const model = carModel(0x36cedd, body, "apex", topper.id);
    const mounts = model.userData.wheelMounts as T.Group[];
    assert.equal(mounts.length, 4);
    mounts.forEach((m, i) =>
      assert.deepEqual(
        m.position.toArray(),
        wheelMount(body, i).setY(wheelMountY).toArray(),
      ),
    );
    const shell = model.getObjectByName("body-shell")!;
    const bounds = new T.Box3().setFromObject(shell);
    assert.ok(
      bounds.max.y <= bodies[body].hitboxY + bodies[body].halfHeight + 0.015,
      body + " shell exceeds chassis roof",
    );
    assert.ok(bounds.max.x <= bodies[body].halfWidth + 0.01);
    assert.ok(bounds.max.z <= bodies[body].halfLength + 0.06);
    assert.ok(bounds.min.z >= -bodies[body].halfLength - 0.04);
    const accessory = model.userData.topper as T.Group;
    if (topper.id !== "none") {
      const b = new T.Box3().setFromObject(accessory);
      assert.ok(
        b.min.y >= model.userData.roofY - 0.005,
        body + "/" + topper.id + " sinks into roof",
      );
      assert.ok(b.max.y < 1, "oversized topper");
    }
    let triangles = 0;
    model.traverse((o) => {
      if (o instanceof T.Mesh) {
        const pos = o.geometry.getAttribute("position");
        assert.ok(Array.from(pos.array).every(Number.isFinite));
      }
    });
    model.traverseVisible((o) => {
      if (o instanceof T.Mesh)
        triangles +=
          (o.geometry.index?.count ??
            o.geometry.getAttribute("position").count) / 3;
    });
    assert.ok(
      triangles < (body === "vector" ? 30000 : 12000),
      "model should remain lightweight",
    );
    disposeModel(model);
  }
}
// All boost styles remain valid when persisted and on every body's exhaust.
const signatures = new Set<string>();
for (const boost of inventory.boost) {
  const plume = new BoostPlume(boost.id);
  signatures.add(JSON.stringify(boostStyles[boost.id]));
  const detail = plume.children.find(
    (o) => o instanceof T.InstancedMesh,
  ) as T.InstancedMesh;
  const geometry = detail.geometry,
    matrixBuffer = detail.instanceMatrix;
  for (let i = 0; i < 120; i++) plume.animate(i / 60);
  assert.equal(detail.geometry, geometry);
  assert.equal(detail.instanceMatrix, matrixBuffer);
  assert.ok(Array.from(detail.instanceMatrix.array).every(Number.isFinite));
  const layers = plume.children.filter(
    (o) => o instanceof T.InstancedMesh,
  ) as T.InstancedMesh[];
  assert.ok(
    layers.reduce((n, m) => n + m.count, 0) <= 64,
    "bounded particle budget",
  );
  assert.ok(plume.children.length <= 5, "bounded draw calls");
  for (const layer of layers) {
    assert.ok(Array.from(layer.instanceMatrix.array).every(Number.isFinite));
    assert.ok(Array.from(layer.instanceColor!.array).every(Number.isFinite));
  }
  plume.dispose();
  for (const body of Object.keys(bodies) as BodyId[]) {
    const model = carModel(0x36cedd, body),
      scene = new T.Scene();
    scene.add(model);
    const fx = new VehicleEffects(model, scene, 0xff0000, boost.id);
    fx.previewBoost(1, true);
    const flame = model.getObjectByName("boost-plume")!;
    assert.ok(flame.visible);
    assert.deepEqual(
      flame.position.toArray(),
      model.userData.exhaust.toArray(),
    );
    fx.previewBoost(2, true);
    assert.ok(flame.visible, "boost preview must stay on");
    fx.previewBoost(3, false);
    assert.equal(flame.visible, false);
    fx.dispose();
    disposeModel(model);
  }
  garage.current.boost = boost.id;
  garage.save();
  assert.equal(new Garage().current.boost, boost.id);
}
assert.equal(signatures.size, inventory.boost.length);
// Saved presets on Ion or a retired shell migrate to the default Vector.
for (const legacy of ["ion", "cargo", "slicer", "wraith"]) {
  (garage.current as { body: string }).body = legacy;
  garage.save();
  assert.equal(new Garage().current.body, "vector");
  const parsed = presetSchema.safeParse({ ...starter(), body: legacy });
  assert.ok(parsed.success && parsed.data.body === "vector");
}
await initializeSimulation();
for (const body of ["lowflat", "boxy", "wedge"] as const) {
  const a = new Simulation(true),
    b = new Simulation(true);
  try {
    a.cars[0].setBody("vector");
    b.cars[0].setBody(body);
    a.cars[1].body.setEnabled(false);
    b.cars[1].body.setEnabled(false);
    a.ball.setEnabled(false);
    b.ball.setEnabled(false);
    assert.equal(a.cars[0].body.mass(), b.cars[0].body.mass());
    for (let i = 0; i < 300; i++) {
      const input = {
        ...neutralInput(),
        throttle: 1,
        steer: i > 100 ? 0.25 : 0,
        boost: i > 180,
      };
      a.step([input, neutralInput()]);
      b.step([input, neutralInput()]);
      assert.deepEqual(
        a.cars[0].body.translation(),
        b.cars[0].body.translation(),
      );
      assert.deepEqual(a.cars[0].body.rotation(), b.cars[0].body.rotation());
    }
  } finally {
    a.dispose();
    b.dispose();
  }
}
console.log(
  "PASS four selectable bodies, 44 roof/topper combinations, rigid wheel alignment/bounds, ten fixed-buffer boost styles on all bodies, continuous preview, schema/preset persistence, legacy saves and unchanged shared-chassis driving",
);
