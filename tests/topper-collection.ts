import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  TOPPER_ASSETS,
  prepareTopper,
  setTopperAsset,
  createTopper,
  animateTopper,
  type TopperId,
} from "../src/render/toppers";
import {
  ARENA_CARS,
  prepareArenaCar,
  setArenaCarAsset,
} from "../src/render/arena-car-model";
import { carModel, animateWheels, disposeModel } from "../src/render/models";
import {
  Garage,
  inventory,
  starter,
  retiredToppers,
} from "../src/game/inventory";
import { presetSchema } from "../shared/accounts";
import { progressionAt, xpAtLevel } from "../shared/progression";
import { P } from "../src/config/physics";

// Decode the embedded image in browsers; Node only needs its dimensions to test
// GLTF's geometry/material/UV path (actual image decoding is covered in Chromium).
Object.assign(globalThis, {
  self: globalThis,
  createImageBitmap: async () => ({ width: 256, height: 64, close() {} }),
});
const parse = async (path: string) => {
  const bytes = readFileSync(path);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
};
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  },
});
const physicsBefore = JSON.stringify(P);
assert.deepEqual(
  new Set(inventory.topper.filter((x) => x.id !== "none").map((x) => x.id)),
  new Set(Object.keys(TOPPER_ASSETS)),
);
const manifest = JSON.parse(
  readFileSync("art/blender/topper-manifest.json", "utf8"),
) as { id: string; triangles: number }[];
for (const [key, entry] of Object.entries(TOPPER_ASSETS)) {
  const id = key as TopperId;
  assert.ok(
    statSync(`public/images/toppers/${entry.slug}.png`).size < 150_000,
    "lightweight static thumbnail",
  );
  setTopperAsset(id, null);
  const fallback = createTopper(id);
  assert.ok(
    fallback.children.length > 0,
    "asset failure remains usable: " + id,
  );
  assert.equal(fallback.userData.assetLoaded, false);
  disposeModel(fallback);
  const gltf = await parse(`public/models/toppers/${entry.slug}.glb`);
  const asset = prepareTopper(gltf, id);
  setTopperAsset(id, asset);
  let triangles = 0,
    draws = 0;
  asset.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    triangles +=
      (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) /
      3;
    draws += Math.max(1, o.geometry.groups.length);
    assert.ok(
      Array.from(o.geometry.getAttribute("position").array).every(
        Number.isFinite,
      ),
    );
  });
  assert.equal(triangles, manifest.find((x) => x.id === id)?.triangles);
  assert.ok(
    triangles < (id === "crown" ? 6000 : id === "ufo" ? 4500 : 3000),
    "bounded geometry: " + id,
  );
  assert.ok(draws <= 9, "material batches: " + id + " " + draws);
  const a = createTopper(id),
    b = createTopper(id);
  const meshes = (root: T.Object3D) => {
    const list: T.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof T.Mesh) list.push(o);
    });
    return list;
  };
  assert.equal(meshes(a)[0].geometry, meshes(b)[0].geometry, "shared geometry");
  assert.notEqual(
    meshes(a)[0].material,
    meshes(b)[0].material,
    "independent fade/materials",
  );
  let freed = false;
  meshes(a)[0].geometry.addEventListener("dispose", () => (freed = true));
  disposeModel(a);
  assert.equal(freed, false, "disposing one car keeps shared assets");
  disposeModel(b);
  if (id === "cat-ears")
    assert.ok(
      new T.Box3().setFromObject(asset).getSize(new T.Vector3()).z > 0.06,
      "sculpted ear depth",
    );
  if (id === "octane-fries") {
    const label =
      asset.getObjectByName("Octane_Fries_front_label") ??
      asset.getObjectByName("Octane Fries front label");
    assert.ok(label instanceof T.Mesh, "separate baked label");
    assert.ok(
      (label.material as T.MeshStandardMaterial).map,
      "embedded text texture",
    );
    assert.ok(label.geometry.getAttribute("uv"));
  }
}

// All 48 combinations use the real GLB body roof attachment rather than fallback cars.
const offsets: Record<string, number[]> = {};
for (const [body, entry] of Object.entries(ARENA_CARS)) {
  const bodyId = body as keyof typeof ARENA_CARS;
  const asset = prepareArenaCar(await parse("public/" + entry.url), bodyId);
  setArenaCarAsset(asset, bodyId);
  offsets[body] = [asset.roofY + 0.008, asset.roofZ];
  for (const id of Object.keys(TOPPER_ASSETS) as TopperId[]) {
    const car = carModel(0x36cedd, bodyId, "apex", id),
      topper = car.userData.topper as T.Group;
    assert.ok(topper.userData.assetLoaded, body + "/" + id);
    assert.deepEqual(topper.position.toArray(), [
      0,
      asset.roofY + 0.008,
      asset.roofZ,
    ]);
    const bounds = new T.Box3().setFromObject(topper);
    assert.ok(
      bounds.min.y >= asset.roofY - 0.006,
      "roof intersection: " + body + "/" + id,
    );
    assert.ok(bounds.max.y < 1, "scale: " + body + "/" + id);
    assert.ok(bounds.min.x > -0.25 && bounds.max.x < 0.25, "roof width");
    if (id === "ufo") {
      const beam = topper.getObjectByName("Beam") as T.Mesh,
        mat = beam.material as T.MeshStandardMaterial;
      assert.ok(mat.transparent && mat.opacity <= 0.18 && !mat.depthWrite);
      assert.equal(mat.side, T.FrontSide);
      assert.equal(beam.castShadow, false);
      assert.equal(
        mat.userData.baseOpacity,
        0.14,
        "home-lobby fading preserves beam alpha",
      );
      assert.equal(mat.userData.baseTransparent, true);
      const bb = new T.Box3().setFromObject(beam);
      assert.ok(bb.min.y - asset.roofY < 0.02, "beam reaches roof");
    }
    disposeModel(car);
  }
}
const prop = createTopper("beanie"),
  other = createTopper("beanie");
assert.notEqual(prop.userData.rotor.node, other.userData.rotor.node);
animateTopper(prop, 1 / 60, false);
assert.ok(prop.userData.rotor.speed > 0 && prop.userData.rotor.speed < 2);
for (let i = 0; i < 120; i++) animateTopper(prop, 1 / 60, false);
assert.ok(prop.userData.rotor.speed > 14 && prop.userData.rotor.speed <= 15);
const angle = prop.userData.rotor.node.rotation.y;
animateTopper(prop, 1 / 60, true);
assert.ok(
  prop.userData.rotor.speed > 13,
  "landing coasts rather than stopping",
);
assert.notEqual(prop.userData.rotor.node.rotation.y, angle);
for (let i = 0; i < 240; i++) animateTopper(prop, 1 / 60, true);
assert.ok(prop.userData.rotor.speed < 0.001);
assert.equal(
  other.userData.rotor.speed,
  0,
  "instance animation is independent",
);
const remote = carModel(0xffffff, "vector", "apex", "beanie");
animateWheels(remote, 0, 0, 1 / 60, { grounded: false } as never, undefined, {
  angle: 0,
  steer: 0,
});
assert.ok(
  remote.userData.topper.userData.rotor.speed > 0,
  "recorded/remote branch animates",
);
const p30 = createTopper("beanie"),
  p120 = createTopper("beanie");
for (let i = 0; i < 30; i++) animateTopper(p30, 1 / 30, false);
for (let i = 0; i < 120; i++) animateTopper(p120, 1 / 120, false);
assert.ok(
  Math.abs(
    p30.userData.rotor.node.rotation.y - p120.userData.rotor.node.rotation.y,
  ) < 1e-10,
);
assert.equal(
  JSON.stringify(P),
  physicsBefore,
  "cosmetics cannot alter physics tuning",
);

// Retired choices migrate in both ownership and every preset, with receipts intact.
for (const [oldId, newId] of Object.entries(retiredToppers)) {
  store.clear();
  store.set(
    "octane-arena-garage",
    JSON.stringify({
      inventoryVersion: 3,
      owned: { topper: [oldId] },
      presets: [{ ...starter(), topper: oldId }],
      claimedRocketPass: { "season-1": [22, 23, 24, 25] },
    }),
  );
  const garage = new Garage();
  assert.equal(garage.current.topper, newId);
  assert.ok(garage.owns("topper", newId));
  assert.equal(new Garage().current.topper, newId);
  assert.deepEqual(garage.claimedRocketPass["season-1"], [22, 23, 24, 25]);
  for (const id of [
    "top-hat",
    "halo",
    "crown",
    "ufo",
    "pixel-sunglasses",
    "octane-fries",
  ])
    assert.ok(garage.owns("topper", id));
  assert.equal(
    await garage.claimRocketPass(25, progressionAt(xpAtLevel(25))),
    false,
  );
  assert.equal(
    presetSchema.parse({ ...starter(), topper: oldId }).topper,
    newId,
  );
}
store.clear();
const garage = new Garage();
for (const id of Object.keys(TOPPER_ASSETS))
  assert.equal(
    garage.equip("topper", id),
    false,
    "locked preview cannot equip",
  );
assert.equal(
  presetSchema.safeParse({ ...starter(), topper: "unknown-item" }).success,
  false,
);
store.set(
  "octane-arena-garage",
  JSON.stringify({
    inventoryVersion: 3,
    claimedRocketPass: { "season-1": ["__proto__", "constructor", "25", null] },
  }),
);
assert.deepEqual(
  new Garage().owned.topper,
  [],
  "malformed receipts cannot grant non-item values",
);
console.log(
  "PASS twelve real GLBs + thumbnails, 48 real-car mounts, fallback assets, bounded triangles/draw calls, material/geometry lifecycle, embedded label UVs, transparent beam, airborne/coasting/remote/frame-rate animation, unchanged physics, ownership and receipt migrations",
  offsets,
);
