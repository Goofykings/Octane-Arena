import assert from "node:assert/strict";
import * as T from "three";
import {
  BoostPlume,
  boostStyles,
  type BoostId,
} from "../src/effects/boost-styles";
import { inventory } from "../shared/catalog";
import { presetSchema } from "../shared/accounts";
import { starter } from "../shared/catalog";
const streamIds = Object.entries(boostStyles)
  .filter(([, s]) => s.stream)
  .map(([id]) => id)
  .sort();
assert.deepEqual(streamIds, ["standard", "thermal"]);
const budgets = new Set<number>(),
  motions = new Set<string>();
for (const { id } of inventory.boost) {
  const p = new BoostPlume(id),
    s = boostStyles[id];
  try {
    let cones = 0;
    p.traverse((o) => {
      if (o instanceof T.Mesh && o.geometry instanceof T.ConeGeometry) cones++;
    });
    assert.equal(
      cones,
      s.stream ? 4 : 0,
      id + ": only stream styles may have continuous cones",
    );
    const layers = p.children.filter(
      (o) => o instanceof T.InstancedMesh,
    ) as T.InstancedMesh[];
    const resources = layers.map((l) => [
      l.geometry,
      l.material,
      l.instanceMatrix,
      l.instanceColor,
    ]);
    const count = layers.reduce((n, l) => n + l.count, 0);
    budgets.add(count);
    assert.ok(count > 0 && count <= 64);
    assert.ok(p.children.length <= 5);
    p.animate(0.13);
    const before = layers[0].instanceMatrix.array.slice();
    p.animate(0.47);
    assert.notDeepEqual(
      layers[0].instanceMatrix.array,
      before,
      id + ": particles must move",
    );
    motions.add(
      JSON.stringify(Array.from(layers[0].instanceMatrix.array.slice(0, 64))),
    );
    for (let frame = 0; frame < 600; frame++) p.animate(frame / 60);
    layers.forEach((l, i) => {
      [l.geometry, l.material, l.instanceMatrix, l.instanceColor].forEach(
        (resource, index) => assert.equal(resource, resources[i][index]),
      );
      assert.ok(Array.from(l.instanceMatrix.array).every(Number.isFinite));
      assert.ok(
        Array.from(l.instanceColor!.array).every(
          (v) => Number.isFinite(v) && v >= 0 && v <= 1,
        ),
      );
    });
    assert.ok(
      presetSchema.safeParse({ ...starter(), boost: id }).success,
      "saved boost ID remains accepted",
    );
  } finally {
    p.dispose();
  }
}
assert.ok(budgets.size >= 6, "particle densities must differ");
assert.equal(
  motions.size,
  inventory.boost.length,
  "styles need different spatial motion",
);
function sample(id: BoostId, layer: string, time: number, index = 0) {
  const p = new BoostPlume(id);
  try {
    p.animate(0);
    p.animate(time);
    const m = p.getObjectByName("boost-" + layer) as T.InstancedMesh;
    assert.ok(m);
    const matrix = new T.Matrix4(),
      position = new T.Vector3(),
      rotation = new T.Quaternion(),
      scale = new T.Vector3(),
      color = new T.Color();
    m.getMatrixAt(index, matrix);
    matrix.decompose(position, rotation, scale);
    m.getColorAt(index, color);
    return {
      position,
      scale,
      color,
      blending: (m.material as T.Material).blending,
    };
  } finally {
    p.dispose();
  }
}
const young = sample("ion", "vapor", 0.05),
  old = sample("ion", "vapor", 0.4);
assert.ok(
  old.position.y > young.position.y && old.scale.x > young.scale.x * 2,
  "vapor rises and expands",
);
assert.equal(
  old.blending,
  T.NormalBlending,
  "smoke is soft and less emissive than energy",
);
const dustA = sample("dust", "sand", 0.05),
  dustB = sample("dust", "sand", 0.4);
assert.ok(
  dustB.position.y < dustA.position.y && dustB.scale.x > dustA.scale.x,
  "sand falls and spreads",
);
assert.ok(
  sample("dust", "grain", 0.4).position.y <
    sample("dust", "grain", 0.1).position.y,
  "grain has downward motion",
);
assert.ok(
  sample("plasma", "blob", 0.3).scale.x > 0.15,
  "plasma uses substantial round blobs",
);
assert.ok(
  sample("lightning", "spark", 0.3).scale.z >
    sample("lightning", "spark", 0.3).scale.x * 4,
  "sparks are long narrow streaks",
);
assert.notDeepEqual(
  sample("sparkles", "glitter", 0.1).color,
  sample("sparkles", "glitter", 0.4).color,
  "glitter twinkles",
);
assert.equal(
  sample("datastream", "bit", 0.01).position.z,
  sample("datastream", "bit", 0.011).position.z,
  "digital packets travel in discrete steps",
);
assert.notEqual(
  sample("datastream", "bit", 0.01).position.z,
  sample("datastream", "bit", 0.2).position.z,
);
assert.ok(
  sample("ember", "smoke", 0.4).position.y > 0,
  "fire has rising smoke",
);
assert.ok(
  boostStyles.dust.glow < boostStyles.plasma.glow / 4,
  "dust remains dimmer than energy effects",
);
console.log(
  "PASS two cone styles only; eight distinct particle styles, different motion/density/brightness, rising vapor/fire smoke, falling sand, round plasma, thin electric sparks, glitter, segmented data, fixed buffers, budget and saved IDs",
);
