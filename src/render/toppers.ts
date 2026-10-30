import * as T from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { selectableTopper } from "../../shared/catalog";
import { reflections } from "./vector-model";
import { polishMaterial } from "./material-polish";
/** Blender-native metres, roof origin Y=0, forward -Z. */
export const TOPPER_ASSETS = {
  birthday: { slug: "birthday-hat", root: "BirthdayHat" },
  "cat-ears": { slug: "cat-ears", root: "CatEars" },
  cone: { slug: "traffic-cone", root: "TrafficCone" },
  halo: { slug: "halo", root: "Halo" },
  beanie: { slug: "propeller-hat", root: "PropellerHat" },
  ufo: { slug: "ufo", root: "UFO" },
  "top-hat": { slug: "top-hat", root: "TopHat" },
  banana: { slug: "banana", root: "Banana" },
  "shark-fin": { slug: "shark-fin", root: "SharkFin" },
  "pixel-sunglasses": { slug: "pixel-sunglasses", root: "PixelSunglasses" },
  "octane-fries": { slug: "octane-fries", root: "OctaneFries" },
  crown: { slug: "royal-crown", root: "RoyalCrown" },
} as const;
export type TopperId = keyof typeof TOPPER_ASSETS;
const assets = new Map<TopperId, T.Object3D>();
let loading: Promise<void> | undefined;
export function topperThumbnail(id: string, base = import.meta.env.BASE_URL) {
  const entry = TOPPER_ASSETS[id as TopperId];
  return entry ? `${base}images/toppers/${entry.slug}.png` : null;
}
export function prepareTopper(gltf: GLTF, id: TopperId) {
  const object = gltf.scene.getObjectByName(TOPPER_ASSETS[id].root);
  if (!object) throw Error(`Missing topper root: ${id}`);
  const bounds = new T.Box3().setFromObject(object);
  if (
    bounds.isEmpty() ||
    bounds.getSize(new T.Vector3()).length() > 0.85 ||
    bounds.min.y < -0.025
  )
    throw Error(
      `Invalid topper dimensions: ${id} (${bounds.min.toArray()} .. ${bounds.max.toArray()})`,
    );
  if (id === "beanie" && !object.getObjectByName("Propeller"))
    throw Error("Missing Propeller node");
  if (
    id === "ufo" &&
    (!object.getObjectByName("Body") || !object.getObjectByName("Beam"))
  )
    throw Error("Missing UFO Body/Beam nodes");
  object.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.userData.shared = true;
      o.castShadow = o.name !== "Beam";
      o.receiveShadow = false;
    }
  });
  return object;
}
export function setTopperAsset(id: TopperId, object: T.Object3D | null) {
  if (object) assets.set(id, object);
  else assets.delete(id);
}
export async function loadToppers(base = import.meta.env.BASE_URL) {
  return (loading ??= (async () => {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    await Promise.all(
      Object.entries(TOPPER_ASSETS).map(async ([key, entry]) => {
        const id = key as TopperId;
        try {
          setTopperAsset(
            id,
            prepareTopper(
              await loader.loadAsync(`${base}models/toppers/${entry.slug}.glb`),
              id,
            ),
          );
        } catch (error) {
          console.warn(
            `Topper ${id} unavailable; using lightweight fallback`,
            error,
          );
        }
      }),
    );
  })());
}
/** Buffers and textures are shared, materials and transforms belong to each instance. */
export function createTopper(raw: string): T.Group {
  const id = selectableTopper(raw) as string;
  const root = new T.Group();
  root.name = "topper-" + id;
  root.userData.topperId = id;
  if (id === "none") return root;
  const template = assets.get(id as TopperId);
  if (template) {
    const object = template.clone(true),
      materials = new Map<T.Material, T.Material>();
    object.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const clone = (source: T.Material) => {
        let mat = materials.get(source);
        if (!mat) {
          mat = source.clone();
          mat.userData.shared = false;
          if (mat instanceof T.MeshStandardMaterial) {
            mat.envMap = reflections();
            mat.envMapIntensity = 0.75;
            if (mat.name !== "UFO beam") polishMaterial(mat, "car");
          }
          materials.set(source, mat);
        }
        return mat;
      };
      o.material = Array.isArray(o.material)
        ? o.material.map(clone)
        : clone(o.material);
    });
    root.add(object);
    root.userData.assetLoaded = true;
    const beam = object.getObjectByName("Beam") as T.Mesh | undefined;
    if (beam) {
      const mat = beam.material as T.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = 0.14;
      mat.depthWrite = false;
      mat.depthTest = true;
      mat.side = T.FrontSide;
      mat.blending = T.AdditiveBlending;
      beam.renderOrder = 2;
      beam.castShadow = false;
    }
  } else {
    addFallback(root, id);
    root.userData.assetLoaded = false;
  }
  const propeller = root.getObjectByName("Propeller");
  root.traverse((o) => {
    if (o instanceof T.Mesh)
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        mat.userData.baseOpacity = mat.opacity;
        mat.userData.baseTransparent = mat.transparent;
      }
  });
  if (propeller) root.userData.rotor = { node: propeller, speed: 0 };
  return root;
}
/** Existing grounded flags drive local, remote and replay animation. No network data. */
export function animateTopper(
  topper: T.Object3D | undefined,
  dt: number,
  grounded: boolean,
) {
  const rotor = topper?.userData.rotor as
    | { node: T.Object3D; speed: number }
    | undefined;
  if (!rotor || !Number.isFinite(dt) || dt <= 0) return;
  const elapsed = Math.min(dt, 0.1),
    target = grounded ? 0 : 15,
    rate = grounded ? 2.6 : 5;
  const decay = Math.exp(-rate * elapsed);
  rotor.node.rotation.y =
    (rotor.node.rotation.y +
      target * elapsed +
      ((rotor.speed - target) * (1 - decay)) / rate) %
    (2 * Math.PI);
  rotor.speed = target + (rotor.speed - target) * decay;
}
/** Emergency silhouettes, used only when a GLB fails to load. */
function addFallback(root: T.Group, id: string) {
  const mats = new Map<number, T.MeshStandardMaterial>();
  const add = (
    geo: T.BufferGeometry,
    x: number,
    y: number,
    z = 0,
    color = 0xe6b949,
  ) => {
    let mat = mats.get(color);
    if (!mat) {
      mat = new T.MeshStandardMaterial({ color, roughness: 0.5 });
      mats.set(color, mat);
    }
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  const disk = (r: number, h: number, y: number, color?: number) =>
    add(new T.CylinderGeometry(r, r, h, 24), 0, y, 0, color);
  switch (id) {
    case "halo": {
      const m = add(new T.TorusGeometry(0.16, 0.017, 8, 32), 0, 0.15);
      m.rotation.x = Math.PI / 2;
      m.material.emissive.setHex(0xffbc30);
      break;
    }
    case "cat-ears":
      for (const x of [-0.11, 0.11]) {
        const m = add(new T.ConeGeometry(0.09, 0.19, 3), x, 0.095);
        m.scale.z = 0.65;
      }
      break;
    case "cone":
      disk(0.145, 0.025, 0.0125, 0xff791f);
      add(new T.ConeGeometry(0.1, 0.29, 24), 0, 0.17, 0, 0xff791f);
      break;
    case "birthday":
      add(new T.ConeGeometry(0.12, 0.31, 24), 0, 0.155, 0, 0x9bd5ff);
      break;
    case "top-hat":
      disk(0.17, 0.024, 0.012, 0x18202b);
      disk(0.115, 0.23, 0.13, 0x18202b);
      break;
    case "beanie": {
      add(
        new T.SphereGeometry(0.14, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        0,
        0,
        0,
        0x328ddd,
      );
      const pivot = new T.Group();
      pivot.name = "Propeller";
      pivot.position.y = 0.21;
      const blade = add(new T.BoxGeometry(0.34, 0.01, 0.034), 0, 0);
      pivot.add(blade);
      root.add(pivot);
      break;
    }
    case "ufo": {
      const m = add(new T.SphereGeometry(0.18, 24, 12), 0, 0.2, 0, 0x34475f);
      m.scale.y = 0.3;
      break;
    }
    case "banana": {
      const m = add(new T.CapsuleGeometry(0.035, 0.23, 6, 12), 0, 0.155);
      m.rotation.z = -0.15;
      break;
    }
    case "shark-fin": {
      const shape = new T.Shape();
      shape.moveTo(-0.1, 0);
      shape.quadraticCurveTo(-0.04, 0.19, 0.12, 0.27);
      shape.quadraticCurveTo(0.04, 0.1, 0.12, 0);
      const m = add(
        new T.ExtrudeGeometry(shape, {
          depth: 0.025,
          bevelEnabled: false,
          curveSegments: 12,
        }),
        0,
        0,
        0,
        0x34516b,
      );
      m.rotation.y = Math.PI / 2;
      break;
    }
    case "pixel-sunglasses":
      add(new T.BoxGeometry(0.32, 0.08, 0.03), 0, 0.06, 0, 0x16202c);
      break;
    case "octane-fries":
      add(new T.BoxGeometry(0.22, 0.15, 0.11), 0, 0.075, 0, 0xc92c3e);
      for (let i = 0; i < 5; i++)
        add(new T.BoxGeometry(0.025, 0.2, 0.025), (i - 2) * 0.04, 0.18);
      break;
    case "crown":
      disk(0.145, 0.08, 0.04);
      add(new T.SphereGeometry(0.13, 20, 12), 0, 0.13, 0, 0xa31c3c);
      break;
  }
}
