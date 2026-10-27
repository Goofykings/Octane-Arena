import assert from "node:assert/strict";
import * as T from "three";
import { carModel, disposeModel } from "../src/render/models";
import { vectorArt, vectorArch } from "../src/render/vector-model";
import { bodies, inventory } from "../shared/catalog";
import { wheelMount, wheelMountY, wheelRadius } from "../src/car/wheels";

let fullTriangles = 0;
for (const { id } of inventory.wheels) {
  const model = carModel(0x138dba, "vector", id, "crown");
  const shell = model.getObjectByName("body-shell")!;
  const materials = shell.userData.materials;
  assert.equal(shell.children.length, 7, "body batches share seven materials");
  assert.equal(materials.BODY_PAINT.color.getHex(), 0x138dba);
  assert.ok(materials.GLASS.transparent && materials.GLASS.opacity < 1);
  assert.equal(materials.GLASS.color.getHex(), 0x0d1b27);
  assert.equal(materials.GLASS.opacity, 0.97);
  assert.ok(materials.GLASS.envMap, "glass reflections at every quality tier");
  assert.ok(materials.LIGHT.emissiveIntensity > 1);
  let triangles = 0;
  model.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = o.geometry.getAttribute("position"),
      n = o.geometry.getAttribute("normal");
    assert.ok(Array.from(p.array).every(Number.isFinite));
    for (let i = 0; i < n.count; i++) {
      const length = new T.Vector3().fromBufferAttribute(n, i).length();
      assert.ok(
        length > 0.98 && length < 1.02,
        `valid smooth normals: ${o.name} ${i} ${length}`,
      );
    }
  });
  model.traverseVisible((o) => {
    if (o instanceof T.Mesh)
      triangles +=
        (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) /
        3;
  });
  assert.ok(triangles < 30000, `${id}: ${triangles} triangles exceeds budget`);
  if (id === "apex") fullTriangles = triangles;
  const bounds = new T.Box3().setFromObject(shell);
  assert.ok(bounds.max.y <= bodies.vector.hitboxY + bodies.vector.halfHeight);
  assert.ok(bounds.max.x <= bodies.vector.halfWidth);
  assert.ok(bounds.min.z >= -bodies.vector.halfLength - 0.04);
  assert.ok(bounds.max.z <= bodies.vector.halfLength + 0.06);
  const mounts = model.userData.wheelMounts as T.Group[];
  for (const [i, pivot] of mounts.entries()) {
    assert.deepEqual(
      pivot.position.toArray(),
      wheelMount("vector", i).setY(wheelMountY).toArray(),
    );
    const spin = pivot.children[0];
    assert.equal(spin.scale.x, vectorArt.wheelScale);
    assert.equal(spin.position.x, (i % 2 ? -1 : 1) * vectorArt.wheelInset);
    const expectedBottom = wheelMountY - wheelRadius;
    assert.ok(
      Math.abs(
        pivot.position.y +
          spin.position.y -
          wheelRadius * spin.scale.y -
          expectedBottom,
      ) < 1e-9,
    );
    assert.equal(
      (spin.children[0] as T.Mesh).geometry,
      (mounts[0].children[0].children[0] as T.Mesh).geometry,
      "wheel GPU geometry shared",
    );
    for (const steer of i < 2 ? [-0.55, 0, 0.55] : [0]) {
      pivot.rotation.y = steer;
      for (const phase of [0, 1.2]) {
        spin.rotation.x = phase;
        model.updateMatrixWorld(true);
        const tire = spin.children[0] as T.Mesh;
        const positions = tire.geometry.getAttribute("position");
        const center = i < 2 ? -bodies.vector.axle : bodies.vector.axle;
        for (let k = 0; k < positions.count; k++) {
          const p = new T.Vector3()
            .fromBufferAttribute(positions, k)
            .applyMatrix4(tire.matrixWorld);
          assert.ok(
            Math.abs(p.x) > 0.243,
            `${id} wheel ${i}: inner liner clearance`,
          );
          if (Math.abs(p.z) <= bodies.vector.halfLength && p.y > -0.13) {
            assert.ok(
              vectorArch(p.z, center) - p.y > 0.008,
              `${id} wheel ${i}: steering arch clearance`,
            );
          }
        }
      }
    }
    pivot.rotation.y = 0;
    spin.rotation.x = 0;
  }
  model.updateMatrixWorld(true);
  const lod = model.getObjectByName("vector-body-lod") as T.LOD;
  const camera = new T.PerspectiveCamera();
  camera.position.set(0, 1, 24);
  camera.updateMatrixWorld();
  lod.update(camera);
  assert.equal(
    lod.getCurrentLevel(),
    1,
    "distant opponents use simplified shell",
  );
  const far = model.getObjectByName("body-shell-far")!;
  const farBounds = new T.Box3().setFromObject(far);
  assert.ok(
    farBounds.max.y <= bodies.vector.hitboxY + bodies.vector.halfHeight,
  );
  assert.ok(farBounds.max.x <= bodies.vector.halfWidth);
  assert.ok(farBounds.min.z >= -bodies.vector.halfLength - 0.04);
  assert.ok(farBounds.max.z <= bodies.vector.halfLength + 0.06);
  let farTriangles = 0,
    nearTriangles = 0;
  far.traverse((o) => {
    if (o instanceof T.Mesh)
      farTriangles += o.geometry.getAttribute("position").count / 3;
  });
  shell.traverse((o) => {
    if (o instanceof T.Mesh)
      nearTriangles += o.geometry.getAttribute("position").count / 3;
  });
  assert.ok(farTriangles < nearTriangles * 0.4);
  assert.equal(
    (far.children[0] as T.Mesh).material,
    (shell.children[0] as T.Mesh).material,
  );
  camera.position.z = 3;
  camera.updateMatrixWorld();
  lod.update(camera);
  assert.equal(lod.getCurrentLevel(), 0);
  for (const [origin, direction, expected] of [
    [new T.Vector3(0, 0.27, -1), new T.Vector3(0, 0, 1), "GLASS"],
    [new T.Vector3(1, 0.27, 0), new T.Vector3(-1, 0, 0), "GLASS"],
    [new T.Vector3(0.206, 0.015, -1), new T.Vector3(0, 0, 1), "LIGHT"],
  ] as const) {
    const hit = new T.Raycaster(origin, direction).intersectObject(
      shell,
      true,
    )[0];
    assert.equal(
      ((hit?.object as T.Mesh)?.material as T.Material)?.name,
      expected,
      "readable exposed lens/window",
    );
  }
  disposeModel(model);
}
console.log(
  `PASS Vector quality: ${fullTriangles} triangles with crown, seven body batches, smooth finite normals, dark glazing/exposed headlights, paint, shared wheel buffers, inset steering clearance and original contact height/mounts`,
);
