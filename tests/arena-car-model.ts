import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  ARENA_CARS,
  ARENA_CAR_WHEELS,
  prepareArenaCar,
  setArenaCarAsset,
  type ArenaCarBody,
} from "../src/render/arena-car-model";
import { animateWheels, carModel, disposeModel } from "../src/render/models";
import { bodies } from "../shared/catalog";
import { wheelMount, wheelMountY, wheelRadius } from "../src/car/wheels";
import { P } from "../src/config/physics";

const report: string[] = [];
for (const ARENA_CAR_BODY of Object.keys(ARENA_CARS) as ArenaCarBody[]) {
  const file = readFileSync("public/" + ARENA_CARS[ARENA_CAR_BODY].url);
  const gltf = await new GLTFLoader().parseAsync(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    "",
  );
  const asset = prepareArenaCar(gltf, ARENA_CAR_BODY);
  const key = ARENA_CARS[ARENA_CAR_BODY].root;
  const d = bodies[ARENA_CAR_BODY];
  const physicsBefore = JSON.stringify({
    d,
    car: P.car,
    suspension: P.suspension,
  });

  // Without the asset (e.g. load failure) the default body stays procedural.
  setArenaCarAsset(null, ARENA_CAR_BODY);
  const fallback = carModel(0x112233, ARENA_CAR_BODY);
  assert.ok(
    ARENA_CAR_BODY === "vector"
      ? fallback.getObjectByName("vector-body-lod")
      : !fallback.getObjectByName(`${key}_Body`),
    "procedural fallback",
  );

  setArenaCarAsset(asset, ARENA_CAR_BODY);
  const blue = carModel(0x36cedd, ARENA_CAR_BODY, "apex", "crown"),
    orange = carModel(0xf89a49, ARENA_CAR_BODY);
  const shell = blue.getObjectByName("body-shell")!;
  assert.ok(
    shell && !blue.getObjectByName("vector-body-lod"),
    "GLB shell used",
  );
  for (const name of [
    "Body",
    "Glass",
    "Trim",
    "Headlights",
    "Taillights",
    "Spoiler",
  ])
    assert.ok(shell.getObjectByName(`${key}_${name}`), name + " present");

  // Team colour: per-car paint, everything else shared.
  const paintOf = (m: T.Object3D) =>
    m.getObjectByName("body-shell")!.userData.materials
      .BODY_PAINT as T.MeshStandardMaterial;
  assert.equal(paintOf(blue).color.getHex(), 0x36cedd);
  assert.equal(paintOf(orange).color.getHex(), 0xf89a49);
  assert.notEqual(paintOf(blue), paintOf(orange));
  const meshes = (m: T.Object3D) => {
    const out: T.Mesh[] = [];
    m.traverse((o) => o instanceof T.Mesh && out.push(o));
    return out;
  };
  const paintMeshes = meshes(shell).filter((m) => m.material === paintOf(blue));
  assert.ok(paintMeshes.length >= 2, "body and wing use the team paint");
  assert.equal(
    meshes(blue)[0].geometry,
    meshes(orange)[0].geometry,
    "GPU geometry shared between cars",
  );
  assert.ok(paintOf(blue).envMap, "paint reflections");

  // Bounds: the visual fits the body's hitbox length and width.
  blue.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(shell);
  assert.ok(Math.abs(bounds.max.z - bounds.min.z - 2 * d.halfLength) < 0.01);
  assert.ok(
    bounds.max.z <= d.halfLength + 0.01 && bounds.min.z >= -d.halfLength - 0.01,
  );
  assert.ok(bounds.max.x <= d.halfWidth, "within hitbox width");
  assert.ok(bounds.max.y <= d.hitboxY + d.halfHeight, "below hitbox top");
  // Forward is -Z: headlights at the front, taillights at the rear.
  const zOf = (name: string) =>
    new T.Box3()
      .setFromObject(shell.getObjectByName(`${key}_${name}`)!)
      .getCenter(new T.Vector3()).z;
  assert.ok(zOf("Headlights") < 0 && zOf("Taillights") > 0);

  // Wheels: the four GLB wheels sit in the existing pivot/spin hierarchy.
  const mounts = blue.userData.wheelMounts as T.Group[],
    spins = blue.userData.wheels as T.Group[],
    front = blue.userData.frontWheels as T.Group[];
  assert.equal(mounts.length, 4);
  assert.deepEqual(front, [mounts[0], mounts[1]], "front pair steers");
  for (let i = 0; i < 4; i++) {
    const pivot = mounts[i],
      spin = spins[i],
      wheel = spin.getObjectByName("arena-wheel")!;
    assert.equal(spin.parent, pivot);
    assert.ok(wheel, ARENA_CAR_WHEELS[i] + " mapped");
    assert.equal(
      wheel.children.length ? wheel.name : wheel.name,
      "arena-wheel",
    );
    // Same side/end as the physics wheel it represents.
    const physics = wheelMount(ARENA_CAR_BODY, i);
    assert.equal(Math.sign(pivot.position.x), Math.sign(physics.x));
    assert.equal(Math.sign(pivot.position.z), Math.sign(physics.z));
    assert.equal(
      pivot.position.y,
      wheelMountY,
      "suspension height untouched at rest",
    );
    // Drawn tire bottom == physics wheel bottom (contact patch preserved).
    assert.ok(
      Math.abs(
        pivot.position.y +
          spin.position.y -
          asset.wheelRadius -
          (wheelMountY - wheelRadius),
      ) < 1e-9,
    );
    // Tire stays inside the GLB arch when straight: never beyond the body's outer width.
    const wb = new T.Box3().setFromObject(wheel);
    assert.ok(Math.abs(i % 2 ? wb.max.x : wb.min.x) <= bounds.max.x + 0.001);
    // The wheel's centre is the pivot (steering turns it in place, not around an offset).
    pivot.rotation.y = i < 2 ? 0.5 : 0;
    blue.updateMatrixWorld(true);
    const c = new T.Box3().setFromObject(wheel).getCenter(new T.Vector3());
    const p = pivot.getWorldPosition(new T.Vector3());
    assert.ok(
      Math.hypot(c.x - p.x, c.z - p.z) < 0.005,
      "steer about wheel centre",
    );
    pivot.rotation.y = 0;
    blue.updateMatrixWorld(true);
  }
  // Rolling uses the drawn radius so the tread does not appear to slip.
  const before = spins[2].rotation.x;
  animateWheels(blue, 10, 0, 0.1);
  assert.ok(
    Math.abs(before - spins[2].rotation.x - (10 * 0.1) / asset.wheelRadius) <
      1e-9,
  );
  // Other wheel cosmetics still apply, sized to the arches.
  const custom = carModel(0x36cedd, ARENA_CAR_BODY, "disc");
  const customSpin = (custom.userData.wheels as T.Group[])[0];
  assert.ok(!customSpin.getObjectByName("arena-wheel"));
  assert.ok(
    Math.abs(customSpin.scale.x - asset.wheelRadius / wheelRadius) < 1e-9,
  );

  // Topper and boost anchors follow the GLB. The roof is the Body's top; a wing may sit higher.
  const topper = blue.userData.topper as T.Object3D;
  const roofTop = new T.Box3().setFromObject(
    shell.getObjectByName(`${key}_Body`)!,
  ).max.y;
  assert.ok(
    Math.abs(topper.position.y - (roofTop + 0.008)) < 0.02,
    ARENA_CAR_BODY + ": topper on the roof",
  );
  assert.ok(Math.abs(topper.position.z) < d.halfLength * 0.4);
  const exhaust = blue.userData.exhaust as T.Vector3;
  assert.ok(exhaust.z > d.halfLength - 0.02 && exhaust.y < blue.userData.roofY);

  // Triangle budget and valid data.
  let triangles = 0;
  blue.traverseVisible((o) => {
    if (!(o instanceof T.Mesh)) return;
    triangles +=
      (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) /
      3;
    assert.ok(
      Array.from(o.geometry.getAttribute("position").array).every(
        Number.isFinite,
      ),
    );
    assert.ok(o.geometry.getAttribute("normal"), "normals present");
  });
  assert.ok(triangles < 30000, `${ARENA_CAR_BODY}: ${triangles} triangles`);

  // Disposing one car never frees buffers other cars still draw.
  let disposed = 0;
  const sharedGeometry = meshes(orange)[0].geometry;
  sharedGeometry.addEventListener("dispose", () => disposed++);
  let paintDisposed = 0;
  paintOf(blue).addEventListener("dispose", () => paintDisposed++);
  disposeModel(blue);
  assert.equal(disposed, 0, "shared GLB geometry kept");
  assert.equal(paintDisposed, 1, "per-car paint released");

  // Physics configuration untouched by the visual swap.
  assert.equal(
    JSON.stringify({ d, car: P.car, suspension: P.suspension }),
    physicsBefore,
  );
  setArenaCarAsset(null, ARENA_CAR_BODY);
  report.push(`${ARENA_CAR_BODY} ${triangles}`);
}
console.log(
  `PASS GLB cars (${report.join(", ")} triangles): 4 wheels mapped to steer/spin/suspension pivots, contact patch preserved, team paint per car, shared buffers, topper/boost anchors, physics unchanged.`,
);
