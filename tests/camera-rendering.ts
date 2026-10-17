import assert from "node:assert/strict";
import * as T from "three";
import { drawArena } from "../src/render/arena";
import { P } from "../src/config/physics";
import {
  registerCameraVisualOcclusion,
  addCameraVisualOccluders,
  updateCameraVisualOcclusion,
} from "../src/render/camera-occlusion";
// Ray/geometry tests don't need WebGL. Only the base turf bitmap needs a canvas;
// actual pixels and material shaders are checked separately in production Chrome.
(globalThis as any).document = {
  createElement: (tag: string) => {
    assert.equal(tag, "canvas");
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        fillStyle: "",
        scale() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        strokeStyle: "",
        lineWidth: 1,
      }),
    };
  },
};
const scene = new T.Scene(),
  arena = drawArena(scene, "city");
scene.updateMatrixWorld(true);
const cast = (object: T.Object3D, from: T.Vector3, to: T.Vector3) => {
  const ray = new T.Raycaster(
    from,
    to.clone().sub(from).normalize(),
    0,
    from.distanceTo(to) + 0.01,
  );
  return ray.intersectObject(object, true);
};
for (const sign of [-1, 1]) {
  const inside = new T.Vector3(sign * 20, 8, 0),
    outside = new T.Vector3(sign * 48, 8, 0),
    wallPoint = new T.Vector3(sign * P.arena.halfWidth, 8, 0);
  assert.ok(
    cast(arena.wall, inside, wallPoint).length > 0,
    "Wall is visible from field interior",
  );
  assert.equal(
    cast(arena.wall, outside, wallPoint).length,
    0,
    "Outside camera looks through the near wall back face",
  );
  const lining = scene.getObjectByName(`goal-interior-${sign}`)!;
  const center = new T.Vector3(0, 3, sign * (P.arena.halfLength + 3));
  const side = new T.Vector3(P.arena.goalHalf, 3, center.z);
  assert.ok(
    cast(lining, center, side).length > 0,
    "Goal lining remains visible from its interior",
  );
  const fascia = new T.Vector3(
    P.arena.goalHalf + 0.2,
    4,
    sign * (P.arena.halfLength + P.arena.goalLip),
  );
  assert.ok(
    cast(
      scene.getObjectByName(`goal-frame-${sign}-right`)!,
      new T.Vector3(fascia.x, 4, sign * (P.arena.halfLength - 4)),
      fascia,
    ).length > 0,
    "Goal fascia remains field-facing",
  );
  const rear = scene.getObjectByName(`goal-rear-view-${sign}`)!;
  const rearPoint = new T.Vector3(
    0,
    3,
    sign * (P.arena.halfLength + P.arena.goalDepth),
  );
  assert.ok(
    cast(rear, center, rearPoint).length > 0,
    "Rear backing remains visible inside goal",
  );
  assert.equal(
    cast(
      rear,
      new T.Vector3(0, 3, sign * (P.arena.halfLength + P.arena.goalDepth + 4)),
      rearPoint,
    ).length,
    0,
    "Outside view passes rear backing",
  );
}
assert.equal(
  arena.wall.material[0].opacity,
  1,
  "Lower walls remain opaque from the interior",
);
// Fade only an individual decorative obstruction, smoothly; preserve shared
// materials on unoccluded objects and restore opacity when camera mode changes.
const fadeScene = new T.Scene(),
  base = new T.MeshBasicMaterial(),
  blocked = new T.Mesh(new T.BoxGeometry(1, 3, 1), base),
  clear = new T.Mesh(new T.BoxGeometry(1, 3, 1), base),
  camera = new T.PerspectiveCamera();
blocked.position.set(0, 1, 4);
clear.position.set(6, 1, 4);
fadeScene.add(blocked, clear);
registerCameraVisualOcclusion(fadeScene, [blocked, clear]);
camera.position.set(0, 1, 8);
camera.lookAt(0, 1, 0);
camera.userData.cameraView = {
  car: new T.Vector3(0, 1, 0),
  ball: new T.Vector3(),
  ballEnabled: false,
  position: camera.position.clone(),
  rotation: camera.quaternion.clone(),
};
updateCameraVisualOcclusion(fadeScene, camera, 0);
assert.ok(
  blocked.material.opacity > 0.8 && blocked.material.opacity < 1,
  "Fade starts gradually rather than popping invisible",
);
for (let i = 1; i <= 60; i++)
  updateCameraVisualOcclusion(fadeScene, camera, i / 60);
assert.ok(blocked.material.opacity < 0.1, "Actual occluder fades");
assert.equal(clear.material, base);
assert.equal(clear.material.opacity, 1, "Unoccluded mesh is unchanged");
// Lazy Hoops scenery must preserve the existing controller's original opacity.
const added = new T.Mesh(new T.BoxGeometry(1, 3, 1), base);
added.position.set(9, 1, 4);
fadeScene.add(added);
addCameraVisualOccluders(fadeScene, [added]);
camera.position.x = 3; // Replay/home camera no longer matches gameplay framing.
for (let i = 61; i <= 120; i++)
  updateCameraVisualOcclusion(fadeScene, camera, i / 60);
assert.equal(
  blocked.material.opacity,
  1,
  "Normal material opacity is restored",
);
const citySky = (scene.background as T.Color).getHex();
arena.setMap("hoops");
assert.ok(arena.group.getObjectByName("hoops-neighborhood")?.visible);
const hoopsSky = (scene.background as T.Color).getHex();
assert.notEqual(hoopsSky, citySky);
const fog = scene.fog;
arena.setMap("hoops");
assert.equal(
  scene.fog,
  fog,
  "Unchanged party arena does not rebuild lighting/fog every frame",
);
arena.setMap("city");
assert.equal(
  (scene.background as T.Color).getHex(),
  citySky,
  "Soccar lighting restored after Hoops",
);
assert.equal(arena.group.getObjectByName("hoops-court")?.visible, false);
console.log(
  "PASS inward walls/goal sides/fascia/backing, outside boundary visibility, unchanged opaque ramp material, local smooth decorative fade/restoration and shared-material isolation",
);
