import assert from "node:assert/strict";
import { Mesh, Raycaster, Vector3 } from "three";
import { bodies, inventory, type BodyId } from "../shared/catalog";
import { carModel, disposeModel } from "../src/render/models";

for (const body of Object.keys(bodies) as BodyId[]) {
  for (const { id: style } of inventory.wheels) {
    const model = carModel(0x22aacc, body, style);
    for (const pivot of model.userData.wheelMounts) {
      const spin = pivot.children[0];
      const tire = spin.children[0] as Mesh;
      const positions = tire.geometry.getAttribute("position");
      const normals = tire.geometry.getAttribute("normal");
      for (let i = 0; i < positions.count; i++) {
        const position = new Vector3().fromBufferAttribute(positions, i);
        const normal = new Vector3().fromBufferAttribute(normals, i);
        const radial = Math.hypot(position.x, position.z);
        const sectionCenter = new Vector3(
          (position.x / radial) * 0.15,
          0,
          (position.z / radial) * 0.15,
        );
        assert.ok(
          normal.dot(position.sub(sectionCenter)) >= -1e-7,
          "Tire normals must face out of the annular rubber cross-section",
        );
      }
      for (const steering of [0, -0.4, 0.4]) {
        pivot.rotation.y = steering;
        spin.rotation.x = 1.2;
        model.updateMatrixWorld(true);
        for (const side of [-1, 1]) {
          const center = spin.getWorldPosition(new Vector3());
          const outward = new Vector3(side, 0, 0).transformDirection(
            spin.matrixWorld,
          );
          const ray = new Raycaster(
            center.clone().addScaledVector(outward, 1),
            outward.clone().negate(),
          );
          const hit = ray.intersectObject(spin, true)[0];
          assert.ok(hit, "Wheel face must be visible from either side");
          assert.notEqual(
            hit.object,
            tire,
            "Rubber must not cover the equipped hub face",
          );
          // Real spoked rims have gaps; check their exposed metal lip rather
          // than expecting the old solid cylinder to fill the entire face.
          const face = new Vector3(0, 0.127, 0).applyMatrix4(spin.matrixWorld);
          const rimRay = new Raycaster(
            face.clone().addScaledVector(outward, 1),
            outward.clone().negate(),
          );
          const rimHit = rimRay.intersectObject(spin, true)[0];
          assert.equal(
            (rimHit?.object as Mesh)?.material &&
              ((rimHit!.object as Mesh).material as import("three").Material)
                .userData.wheelPart,
            "rim",
            body + "/" + style + ": exposed rim lip",
          );
        }
        // Sample exposed tread from front, rear and above, away from the hub.
        for (const radial of [
          new Vector3(0, 0, -1),
          new Vector3(0, 0, 1),
          new Vector3(0, 1, 0),
        ]) {
          const center = spin.getWorldPosition(new Vector3());
          const direction = radial.clone().transformDirection(spin.matrixWorld);
          const ray = new Raycaster(
            center.clone().addScaledVector(direction, 1),
            direction.clone().negate(),
          );
          const hit = ray.intersectObject(spin, true)[0];
          assert.equal(
            ((hit?.object as Mesh)?.material as import("three").Material)
              ?.userData.wheelPart,
            "tire",
            "Rubber must cover the hub from the tread view",
          );
          assert.ok(
            hit.distance < 0.84,
            "Near tire surface must render, not its back face",
          );
        }
      }
    }
    disposeModel(model);
  }
}
console.log(
  "PASS exposed equipped rims, outward annular tire faces and visible near-side rubber on all five bodies/ten wheel styles, including steering and spin",
);
