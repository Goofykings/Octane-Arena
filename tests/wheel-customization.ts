import assert from "node:assert/strict";
import * as T from "three";
import { bodies, inventory, starter, type BodyId } from "../shared/catalog";
import { presetSchema } from "../shared/accounts";
import { Garage } from "../src/game/inventory";
import { carModel, animateWheels, disposeModel } from "../src/render/models";
import { wheelDesigns } from "../src/render/wheel-model";
import {
  wheelMount,
  wheelMountY,
  wheelRadius,
  wheelHalfWidth,
} from "../src/car/wheels";
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  },
});
const garage = new Garage();
assert.equal(inventory.wheels.length, 10);
assert.equal(
  new Set(Object.values(wheelDesigns).map((x) => x.family)).size,
  10,
);
const silhouettes = new Set<string>();
for (const body of Object.keys(bodies) as BodyId[])
  for (const { id } of inventory.wheels) {
    const model = carModel(0x23cada, body, id);
    try {
      assert.ok(
        presetSchema.safeParse({ ...starter(), body, wheels: id }).success,
      );
      garage.current.body = body;
      garage.current.wheels = id;
      garage.save();
      assert.equal(new Garage().current.wheels, id);
      assert.equal(new Garage().current.body, body);
      for (const [i, pivot] of (
        model.userData.wheelMounts as T.Group[]
      ).entries()) {
        assert.deepEqual(
          pivot.position.toArray(),
          wheelMount(body, i).setY(wheelMountY).toArray(),
          "no physical mount offset",
        );
        const spin = (model.userData.wheels as T.Group[])[i];
        assert.equal(spin.userData.designId, id);
        spin.updateMatrixWorld(true);
        const inverse = spin.matrixWorld.clone().invert();
        let drawCalls = 0;
        spin.traverse((o) => {
          if (o instanceof T.Mesh) {
            drawCalls++;
            const pos = o.geometry.getAttribute("position");
            for (let k = 0; k < pos.count; k++) {
              const v = new T.Vector3()
                .fromBufferAttribute(pos, k)
                .applyMatrix4(o.matrixWorld)
                .applyMatrix4(inverse);
              assert.ok(
                Number.isFinite(v.x) &&
                  Number.isFinite(v.y) &&
                  Number.isFinite(v.z),
              );
              assert.ok(
                Math.hypot(v.y, v.z) <= wheelRadius + 1e-5,
                body + "/" + id + ": radius exceeds rigid wheel envelope",
              );
              assert.ok(
                Math.abs(v.x) <= wheelHalfWidth + 1e-5,
                body + "/" + id + ": protruding axial wheel part",
              );
            }
          }
        });
        assert.ok(drawCalls <= 5, "batch small rim parts by material");
      }
      // The rim's actual geometry, not just its name/color, distinguishes each style.
      const wheel = (model.userData.wheels as T.Group[])[0];
      const meshData: number[] = [];
      wheel.traverse((o) => {
        if (o instanceof T.Mesh) {
          meshData.push(o.geometry.getAttribute("position").count);
        }
      });
      if (body === "ion") silhouettes.add(JSON.stringify(meshData));
      const start = wheel.rotation.x;
      animateWheels(model, 9, 0.4, 1 / 60);
      assert.ok(
        Math.abs(wheel.rotation.x - start + 9 / 0.18 / 60) < 1e-9,
        "unchanged motion-driven spin",
      );
      const fronts = model.userData.frontWheels as T.Group[];
      assert.ok(fronts.every((w) => w.rotation.y > 0));
      assert.ok(
        (model.userData.wheelMounts as T.Group[])
          .slice(2)
          .every((w) => w.rotation.y === 0),
      );
      animateWheels(model, 0, 0, 0, undefined, undefined, {
        angle: 1.3,
        steer: -0.25,
      });
      assert.ok(
        (model.userData.wheels as T.Group[]).every((w) => w.rotation.x === 1.3),
        "recorded replay spin",
      );
      assert.ok(
        fronts.every((w) => w.rotation.y === -0.25),
        "recorded front steering",
      );
    } finally {
      disposeModel(model);
    }
  }
assert.equal(silhouettes.size, 10, "ten structurally different designs");
console.log(
  "PASS 50 body/wheel combinations, ten distinct meshes, physical size/mount bounds, material batching, visible selection IDs, preset/schema persistence, unchanged spin/front steering and replay poses",
);
