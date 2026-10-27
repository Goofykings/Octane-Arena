import * as T from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { bodies, type BodyId } from "../game/inventory";
import { wheelMountY, wheelRadius } from "../car/wheels";
import { polishMaterial } from "./material-polish";
import { reflections } from "./vector-model";

/** Visual-only GLB shells (art/blender/build_octane_arena_cars.py), keyed by body.
 * Each file holds a root "Car_<Name>" whose parts are named "Car_<Name>_<Part>".
 * Physics, hitbox, suspension, wheel rays, steering and networking keep using the
 * body's existing tuned values. */
export const ARENA_CARS = {
  vector: { url: "models/cars/car-default.glb", root: "Car_Default" },
  lowflat: { url: "models/cars/car-lowflat.glb", root: "Car_LowFlat" },
  boxy: { url: "models/cars/car-boxy.glb", root: "Car_Boxy" },
  wedge: { url: "models/cars/car-wedge.glb", root: "Car_Wedge" },
} as const satisfies Partial<Record<BodyId, { url: string; root: string }>>;
export type ArenaCarBody = keyof typeof ARENA_CARS;
export const ARENA_CAR_BODY: ArenaCarBody = "vector";
export const isArenaCarBody = (id: BodyId): id is ArenaCarBody =>
  id in ARENA_CARS;
/** GLB wheel node for each physics wheel index (0 FL, 1 FR, 2 RL, 3 RR; forward is -Z). */
export const ARENA_CAR_WHEELS = [
  "Wheel_FL",
  "Wheel_FR",
  "Wheel_RL",
  "Wheel_RR",
] as const;
const BODY_PARTS = [
  "Body",
  "Glass",
  "Trim",
  "Headlights",
  "Taillights",
  "Spoiler",
] as const;
export interface ArenaCarAsset {
  parts: T.Object3D[];
  wheels: T.Object3D[];
  paint: T.MeshStandardMaterial;
  /** Uniform scale that fits the model's length to the body's hitbox length. */
  scale: number;
  /** Car-space Z shift that centres the model on the hitbox. */
  offsetZ: number;
  /** Car-local wheel centres at rest (static ride height). */
  wheelCenters: T.Vector3[];
  wheelRadius: number;
  roofY: number;
  roofZ: number;
  exhaust: T.Vector3;
}
const loaded = new Map<BodyId, ArenaCarAsset>();
export const arenaCarAsset = (body: BodyId = ARENA_CAR_BODY) =>
  loaded.get(body) ?? null;
export function setArenaCarAsset(
  asset: ArenaCarAsset | null,
  body: BodyId = ARENA_CAR_BODY,
) {
  if (asset) loaded.set(body, asset);
  else loaded.delete(body);
}
const shared = (o: T.Object3D) =>
  o.traverse((m) => {
    if (!(m instanceof T.Mesh)) return;
    m.geometry.userData.shared = true;
    for (const mat of [m.material].flat()) mat.userData.shared = true;
  });
/** Validates the exported hierarchy and derives car-space anchors from its geometry. */
export function prepareArenaCar(
  gltf: Pick<GLTF, "scene">,
  body: ArenaCarBody = ARENA_CAR_BODY,
): ArenaCarAsset {
  const key = ARENA_CARS[body].root;
  const root = gltf.scene.getObjectByName(key);
  if (!root) throw new Error("Car model is missing " + key);
  root.updateMatrixWorld(true);
  const find = (name: string) => {
    const o = root.getObjectByName(`${key}_${name}`);
    if (!o) throw new Error(`Car model is missing ${key}_${name}`);
    return o;
  };
  const parts = BODY_PARTS.map(find),
    wheels = ARENA_CAR_WHEELS.map(find);
  const bounds = new T.Box3();
  parts.forEach((p) => bounds.expandByObject(p));
  const d = bodies[body],
    scale = (2 * d.halfLength) / (bounds.max.z - bounds.min.z),
    // The GLB's ground (y = 0) sits where the physics contact patch rests.
    ground = wheelMountY - wheelRadius,
    offsetZ = (-(bounds.max.z + bounds.min.z) / 2) * scale;
  const toCar = (v: T.Vector3) => {
    v.multiplyScalar(scale);
    v.y += ground;
    v.z += offsetZ;
    return v;
  };
  const wheelBounds = new T.Box3().setFromObject(wheels[0]);
  const visualRadius = ((wheelBounds.max.y - wheelBounds.min.y) / 2) * scale;
  const bodyMesh = find("Body"),
    bodyBox = new T.Box3().setFromObject(bodyMesh);
  // Roof anchor: the centre of the highest band of body vertices (topper seat).
  let roofZ = 0,
    count = 0;
  const v = new T.Vector3();
  bodyMesh.traverse((m) => {
    if (!(m instanceof T.Mesh)) return;
    const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.y > bodyBox.max.y - 0.004) {
        roofZ += v.z;
        count++;
      }
    }
  });
  // Boost outlet: between the exhaust tips (Trim's Metal primitive), just behind them.
  let exhaust = new T.Vector3(0, 0.2, bounds.max.z + 0.01);
  find("Trim").traverse((m) => {
    if (m instanceof T.Mesh && [m.material].flat()[0].name === "Metal") {
      const b = new T.Box3().setFromObject(m);
      exhaust = new T.Vector3(0, (b.min.y + b.max.y) / 2, b.max.z + 0.01);
    }
  });
  let paint: T.MeshStandardMaterial | undefined;
  const env = reflections();
  root.traverse((m) => {
    if (!(m instanceof T.Mesh)) return;
    m.castShadow = true;
    m.receiveShadow = true;
    for (const mat of [m.material].flat() as T.MeshStandardMaterial[]) {
      if (mat.name === "BodyPaint") paint = mat;
      if (["BodyPaint", "Glass", "Metal"].includes(mat.name)) {
        mat.envMap = env;
        mat.envMapIntensity = mat.name === "Glass" ? 0.6 : 0.45;
      }
      polishMaterial(mat, "car");
    }
  });
  if (!paint) throw new Error("Car model is missing the BodyPaint material");
  [...parts, ...wheels].forEach(shared);
  return {
    parts,
    wheels,
    paint,
    scale,
    offsetZ,
    wheelCenters: wheels.map((w) => toCar(w.getWorldPosition(new T.Vector3()))),
    wheelRadius: visualRadius,
    roofY: bodyBox.max.y * scale + ground,
    roofZ: (count ? (roofZ / count) * scale : 0) + offsetZ,
    exhaust: toCar(exhaust),
  };
}
/** Per-car shell: geometry and fixed materials are shared; only paint is per car (team colour). */
export function arenaCarShell(asset: ArenaCarAsset, color: number) {
  const shell = new T.Group();
  shell.name = "body-shell";
  const paint = asset.paint.clone();
  paint.color.setHex(color);
  paint.userData = { ...paint.userData, shared: false };
  polishMaterial(paint, "car");
  for (const part of asset.parts) {
    const copy = part.clone();
    copy.traverse((m) => {
      if (!(m instanceof T.Mesh)) return;
      m.material = Array.isArray(m.material)
        ? m.material.map((x) => (x.name === "BodyPaint" ? paint : x))
        : m.material.name === "BodyPaint"
          ? paint
          : m.material;
    });
    shell.add(copy);
  }
  shell.scale.setScalar(asset.scale);
  shell.position.set(0, wheelMountY - wheelRadius, asset.offsetZ);
  shell.userData.materials = { BODY_PAINT: paint };
  return shell;
}
/** One GLB wheel, centred on its own axle, sized for the car (spins about local X). */
export function arenaCarWheel(asset: ArenaCarAsset, index: number) {
  const wheel = asset.wheels[index].clone();
  wheel.position.set(0, 0, 0);
  wheel.scale.setScalar(asset.scale);
  wheel.name = "arena-wheel";
  return wheel;
}
/** Loads every GLB body once at boot, in parallel; any failure falls back to that
 * body's procedural shell. */
export async function loadArenaCars(base = import.meta.env.BASE_URL) {
  let loader: InstanceType<
    typeof import("three/addons/loaders/GLTFLoader.js").GLTFLoader
  >;
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    loader = new GLTFLoader();
  } catch (error) {
    console.warn(
      "[Octane Arena] glTF loader unavailable; using the procedural bodies.",
      error,
    );
    return loaded;
  }
  await Promise.all(
    (Object.keys(ARENA_CARS) as ArenaCarBody[]).map(async (body) => {
      try {
        const gltf = await loader.loadAsync(base + ARENA_CARS[body].url);
        loaded.set(body, prepareArenaCar(gltf, body));
      } catch (error) {
        console.warn(
          `[Octane Arena] ${body} car model failed to load; using the procedural body.`,
          error,
        );
        loaded.delete(body);
      }
    }),
  );
  return loaded;
}
