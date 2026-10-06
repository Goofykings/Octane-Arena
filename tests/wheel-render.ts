import assert from "node:assert/strict";
import { Mesh, Raycaster, Vector3 } from "three";
import { carModel } from "../src/render/models";

for (const body of ["ion", "vector"] as const) {
  for (const style of ["apex", "disc"]) {
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
          const hub = spin.children[1] as Mesh;
          const face = new Vector3(0, 0.065, 0).applyMatrix4(spin.matrixWorld);
          const hubRay = new Raycaster(
            face.clone().addScaledVector(outward, 1),
            outward.clone().negate(),
          );
          assert.equal(
            hubRay.intersectObject(spin, true)[0]?.object,
            hub,
            "Equipped rim must remain exposed beside the painted spoke",
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
            hit?.object,
            tire,
            "Rubber must cover the hub from the tread view",
          );
          assert.ok(
            hit.distance < 0.84,
            "Near tire surface must render, not its back face",
          );
        }
      }
    }
    model.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
  }
}
console.log(
  "PASS exposed equipped rims, outward annular tire faces and visible near-side rubber on both bodies/wheel styles, including steering and spin",
);
