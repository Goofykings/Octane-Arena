import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { polishMaterial } from "./material-polish";
import { wheelMountY, wheelRadius } from "../car/wheels";
import { bodies } from "../../shared/catalog";

/** Original Vector coupe. All dimensions are art coordinates in the existing
 * Vector chassis frame (-Z forward). Never consumed by the contact solver. */
export const vectorArt = {
  wheelScale: 0.94,
  wheelInset: 0.058,
  roofY: 0.368,
  roofZ: 0.04,
} as const;

const axle = bodies.vector.axle;
const wheelY = wheelMountY - wheelRadius * (1 - vectorArt.wheelScale);
const bump = (z: number, center: number, spread: number) =>
  Math.exp(-Math.pow((z - center) / spread, 2));
const shellWidth = (z: number) =>
  Math.min(
    0.421,
    0.36 -
      0.1 * Math.pow(Math.abs(z) / 0.66, 6) +
      0.084 * bump(z, -axle, 0.17) +
      0.085 * bump(z, axle, 0.18),
  );
const hoodCrown = (z: number) =>
  0.145 - 0.103 * bump(z, -0.68, 0.23) + 0.005 * bump(z, 0.4, 0.23);
const shoulderLift = (z: number) =>
  0.095 * bump(z, -axle + 0.018, 0.16) + 0.065 * bump(z, axle - 0.014, 0.17);
/** Shared paint profile, also used to seat seams and sculpted fender caps. */
function shellTop(x: number, z: number) {
  const t = T.MathUtils.clamp(x / shellWidth(z), -1, 1);
  return (
    hoodCrown(z) - 0.05 * (1 - Math.sqrt(1 - t * t)) + shoulderLift(z) * t ** 4
  );
}
/** Swept, broad-shouldered wheel opening; front and rear have different rake.
 * The opening includes the steering sweep of the inset visual front wheels. */
export function vectorArch(z: number, center: number) {
  const front = center < 0;
  const dz = z - center;
  const radius = front ? (dz < 0 ? 0.222 : 0.244) : dz < 0 ? 0.231 : 0.218;
  const t = Math.min(1, Math.abs(dz) / radius);
  return wheelY + (front ? 0.194 : 0.195) * Math.pow(1 - t ** 2.65, 1 / 2.65);
}

let studio: T.DataTexture | undefined;
// One small, immutable reflection source for every Vector, including the garage
// which has direct lights but no scene.environment. No per-frame capture/pass.
export function reflections() {
  if (studio) return studio;
  const w = 128,
    h = 64,
    data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sky = Math.max(0, 1 - y / (h * 0.7));
      const band =
        Math.exp(-Math.pow((y / h - 0.29) / 0.045, 2)) *
        (0.3 + 0.7 * Math.sin((x / w) * Math.PI * 3) ** 8);
      const i = (y * w + x) * 4;
      data[i] = 22 + sky * 70 + band * 130;
      data[i + 1] = 31 + sky * 83 + band * 125;
      data[i + 2] = 42 + sky * 95 + band * 110;
      data[i + 3] = 255;
    }
  studio = new T.DataTexture(data, w, h);
  studio.mapping = T.EquirectangularReflectionMapping;
  studio.colorSpace = T.SRGBColorSpace;
  studio.needsUpdate = true;
  return studio;
}

type Surface = (u: number, v: number) => T.Vector3;
/** Indexed smooth patches; the hint fixes winding after mirroring a side. */
function surface(fn: Surface, nx: number, ny: number, hint: T.Vector3) {
  const p: number[] = [],
    indices: number[] = [];
  const mid = fn(0.5, 0.5);
  const reverse =
    fn(0.501, 0.5).sub(mid).cross(fn(0.5, 0.501).sub(mid)).dot(hint) < 0;
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) p.push(...fn(i / nx, j / ny).toArray());
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i,
        b = a + 1,
        c = a + nx + 1,
        d = c + 1;
      indices.push(...(reverse ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(p, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createVectorBody(
  color: number,
  low = false,
  shared?: Record<string, T.Material>,
) {
  const shell = new T.Group();
  shell.name = "body-shell";
  const env = reflections();
  const paint =
    shared?.BODY_PAINT ??
    new T.MeshPhysicalMaterial({
      color,
      metalness: 0.28,
      roughness: 0.33,
      clearcoat: 0.45,
      clearcoatRoughness: 0.28,
      envMap: env,
      envMapIntensity: 0.48,
    });
  const glass =
    shared?.GLASS ??
    new T.MeshPhysicalMaterial({
      color: 0x0d1b27,
      metalness: 0.18,
      roughness: 0.17,
      transparent: true,
      opacity: 0.97,
      depthWrite: false,
      envMap: env,
      envMapIntensity: 0.55,
      clearcoat: 0.7,
      side: T.DoubleSide,
    });
  const rubber =
    shared?.RUBBER ??
    new T.MeshStandardMaterial({
      color: 0x242b31,
      roughness: 0.87,
    });
  const metal =
    shared?.METAL ??
    new T.MeshStandardMaterial({
      color: 0x82929b,
      metalness: 0.55,
      roughness: 0.4,
      envMap: env,
      envMapIntensity: 0.4,
    });
  const trim =
    shared?.DARK_TRIM ??
    new T.MeshStandardMaterial({
      color: 0x182831,
      roughness: 0.58,
      metalness: 0.12,
    });
  const light =
    shared?.LIGHT ??
    new T.MeshStandardMaterial({
      color: 0xd8f4ff,
      emissive: 0xa5ddff,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });
  const tail =
    shared?.TAIL_LIGHT ??
    new T.MeshStandardMaterial({
      color: 0xf34437,
      emissive: 0xef2417,
      emissiveIntensity: 0.85,
      roughness: 0.25,
    });
  const mats = {
    BODY_PAINT: paint,
    GLASS: glass,
    RUBBER: rubber,
    METAL: metal,
    DARK_TRIM: trim,
    LIGHT: light,
    TAIL_LIGHT: tail,
  };
  for (const [name, mat] of Object.entries(mats)) {
    mat.name = name;
    mat.userData.baseOpacity = mat.opacity;
    mat.userData.baseTransparent = mat.transparent;
    polishMaterial(mat, "car");
  }
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const add = (
    geo: T.BufferGeometry,
    mat: T.Material,
    pos = new T.Vector3(),
    rotation = new T.Euler(),
  ) => {
    geo.applyMatrix4(
      new T.Matrix4().compose(
        pos,
        new T.Quaternion().setFromEuler(rotation),
        new T.Vector3(1, 1, 1),
      ),
    );
    const vertices = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const key of Object.keys(vertices.attributes))
      if (key !== "position" && key !== "normal") vertices.deleteAttribute(key);
    geo.dispose();
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat)!.push(vertices);
  };
  const rounded = (
    size: [number, number, number],
    pos: [number, number, number],
    mat: T.Material,
    radius = 0.012,
    rotation = new T.Euler(),
  ) =>
    add(
      low && Math.min(...size) < 0.05
        ? new T.BoxGeometry(...size)
        : new RoundedBoxGeometry(...size, 1, radius),
      mat,
      new T.Vector3(...pos),
      rotation,
    );
  const tube = (
    points: T.Vector3[],
    radius: number,
    mat: T.Material,
    segments = 24,
  ) =>
    add(
      new T.TubeGeometry(
        new T.CatmullRomCurve3(points),
        low ? Math.min(segments, 10) : segments,
        radius,
        low ? 3 : 5,
        false,
      ),
      mat,
    );
  const up = new T.Vector3(0, 1, 0);
  const archFloor = (z: number) => {
    const center = z < 0 ? -axle : axle;
    const y = vectorArch(z, center);
    return y > wheelY ? y : -0.135;
  };
  // A curved hood/deck blends into rolled shoulders; the bottom edge rises over
  // real wheel openings. There is no solid box behind the tires.
  add(
    surface(
      (u, v) => {
        const z = -0.66 + v * 1.32,
          t = ((u * 2 - 1) * Math.PI) / 2;
        const x = shellWidth(z) * Math.sin(t);
        return new T.Vector3(x, shellTop(x, z), z);
      },
      low ? 10 : 24,
      low ? 20 : 48,
      up,
    ),
    paint,
  );
  for (const s of [-1, 1]) {
    add(
      surface(
        (u, v) => {
          const z = -0.66 + v * 1.32;
          const top = shellTop(shellWidth(z), z);
          return new T.Vector3(
            s * (shellWidth(z) - 0.014 * u * u),
            T.MathUtils.lerp(top, archFloor(z), u),
            z,
          );
        },
        low ? 2 : 4,
        low ? 40 : 80,
        new T.Vector3(s, 0, 0),
      ),
      paint,
    );
    for (const z0 of [-axle, axle]) {
      // Swept lips and crowned shoulders form a cover rather than a circular
      // cutout in a flat side. The two axle covers intentionally differ.
      const points: T.Vector3[] = [];
      const start = Math.max(-0.66, z0 - (z0 < 0 ? 0.222 : 0.231));
      const end = Math.min(0.66, z0 + (z0 < 0 ? 0.244 : 0.218));
      for (let i = 0; i <= 32; i++) {
        const z = T.MathUtils.lerp(start, end, i / 32);
        points.push(
          new T.Vector3(s * (shellWidth(z) - 0.012), vectorArch(z, z0), z),
        );
      }
      tube(points, 0.0065, rubber, low ? 10 : 28);
      // A recessed wheel-well wall prevents sky showing through the upper gap.
      // It sits inboard of the front tire's full steering sweep, not at the lip.
      add(
        surface(
          (u, v) => {
            const z = T.MathUtils.lerp(start, end, v);
            return new T.Vector3(
              s * 0.235,
              T.MathUtils.lerp(
                -0.14 + 0.085 * bump(z, z0 < 0 ? -0.66 : 0.66, 0.07),
                vectorArch(z, z0) + 0.008,
                u,
              ),
              z,
            );
          },
          1,
          low ? 6 : 12,
          new T.Vector3(s, 0, 0),
        ),
        rubber,
      );
      add(
        surface(
          (u, v) => {
            const z = T.MathUtils.lerp(start, end, v);
            const outer = shellWidth(z) - 0.004;
            const inner = outer - (0.018 + 0.087 * Math.sin(v * Math.PI));
            const x = T.MathUtils.lerp(inner, outer, u);
            const crest =
              (z0 < 0 ? 0.008 : 0.012) *
              Math.sin(v * Math.PI) ** 2 *
              Math.sin(u * Math.PI);
            return new T.Vector3(s * x, shellTop(x, z) + 0.0015 + crest, z);
          },
          low ? 3 : 6,
          low ? 6 : 12,
          up,
        ),
        paint,
      );
    }
    rounded([0.027, 0.037, 0.39], [s * 0.337, -0.115, 0], trim, 0.012);
    // Door cut line, recessed side intake, compact handle.
    const sideX = (z: number, y: number) => {
      const top = shellTop(shellWidth(z), z);
      const depth = T.MathUtils.clamp(
        (top - y) / Math.max(0.01, top - archFloor(z)),
        0,
        1,
      );
      return shellWidth(z) - 0.014 * depth * depth + 0.0015;
    };
    const door = new T.CatmullRomCurve3([
      new T.Vector3(0, 0.105, -0.18),
      new T.Vector3(0, -0.059, -0.145),
      new T.Vector3(0, -0.079, 0.095),
      new T.Vector3(0, 0.112, 0.195),
    ]);
    tube(
      Array.from({ length: 33 }, (_, i) => {
        const p = door.getPoint(i / 32);
        return new T.Vector3(s * sideX(p.z, p.y), p.y, p.z);
      }),
      0.0013,
      trim,
      24,
    );
    rounded(
      [0.016, 0.048, 0.107],
      [s * 0.37, 0.031, 0.217],
      trim,
      0.007,
      new T.Euler(0.1, 0, 0),
    );
    rounded(
      [0.012, 0.009, 0.043],
      [s * sideX(0.12, 0.091), 0.091, 0.12],
      metal,
      0.004,
    );
  }
  // Rolled fasciae follow the hood/quarter profiles instead of standing above
  // the tapered nose as a full-width slab.
  for (const end of [-1, 1])
    add(
      surface(
        (u, v) => {
          const q = u * 2 - 1,
            z = end * 0.66;
          const x = q * shellWidth(z) * (0.96 + 0.04 * v);
          const bottom = -0.083 + 0.04 * q * q;
          return new T.Vector3(
            x,
            T.MathUtils.lerp(
              bottom,
              shellTop(q * shellWidth(z), z),
              Math.sin((v * Math.PI) / 2),
            ),
            end * (0.656 + 0.012 * Math.sin(v * Math.PI) + 0.004 * v),
          );
        },
        low ? 10 : 24,
        low ? 3 : 8,
        new T.Vector3(0, 0, end),
      ),
      paint,
    );
  rounded([0.285, 0.055, 0.016], [0, -0.029, -0.674], trim, 0.02);
  for (const y of [-0.045, -0.029, -0.013])
    rounded([0.245, 0.003, 0.005], [0, y, -0.684], metal, 0.0015);
  tube(
    [
      new T.Vector3(-0.245, -0.046, -0.642),
      new T.Vector3(-0.185, -0.073, -0.675),
      new T.Vector3(0, -0.084, -0.685),
      new T.Vector3(0.185, -0.073, -0.675),
      new T.Vector3(0.245, -0.046, -0.642),
    ],
    0.012,
    trim,
  );
  rounded([0.26, 0.018, 0.062], [0, -0.099, -0.612], metal, 0.008);
  for (const s of [-1, 1]) {
    rounded(
      [0.135, 0.044, 0.038],
      [s * 0.206, 0.013, -0.653],
      trim,
      0.02,
      new T.Euler(0, s * 0.13, s * 0.07),
    );
    rounded(
      [0.109, 0.028, 0.013],
      [s * 0.206, 0.015, -0.676],
      light,
      0.013,
      new T.Euler(0, s * 0.13, s * 0.07),
    );
    rounded([0.142, 0.032, 0.019], [s * 0.22, 0.073, 0.675], tail, 0.012);
    rounded([0.093, 0.059, 0.055], [s * 0.21, -0.025, 0.675], trim, 0.018);
    // Subtle hood shut line follows the crowned surface.
    tube(
      [-0.58, -0.49, -0.4, -0.31].map((z) => {
        const x = 0.15 + (z + 0.58) * 0.13;
        return new T.Vector3(s * x, shellTop(x, z) + 0.0018, z);
      }),
      0.0015,
      trim,
      18,
    );
  }
  rounded([0.48, 0.05, 0.064], [0, -0.096, 0.613], trim, 0.014);
  rounded([0.54, 0.026, 1.17], [0, -0.126, 0], trim, 0.01);
  for (const x of [-0.15, -0.05, 0.05, 0.15])
    rounded([0.009, 0.032, 0.074], [x, -0.112, 0.615], trim, 0.004);

  // Blend the compact greenhouse into the existing hood and side loft rather
  // than leaving a slit below the window surround when the waist narrows.
  for (const s of [-1, 1])
    add(
      surface(
        (u, v) => {
          const z = T.MathUtils.lerp(-0.29, 0.365, u);
          const x = T.MathUtils.lerp(0.292, 0.294, u) + 0.012 * (1 - v);
          return new T.Vector3(
            s * x,
            T.MathUtils.lerp(shellTop(x, z), 0.151 + 0.004 * u, v),
            z,
          );
        },
        low ? 8 : 20,
        3,
        new T.Vector3(s, 0.5, 0),
      ),
      paint,
    );
  for (const end of [-1, 1])
    add(
      surface(
        (u, v) => {
          const q = u * 2 - 1;
          const x = q * (end < 0 ? 0.292 : 0.294);
          const z = (end < 0 ? -0.29 : 0.365) + end * 0.018 * (1 - v);
          return new T.Vector3(
            x,
            T.MathUtils.lerp(
              shellTop(x, z),
              (end < 0 ? 0.151 : 0.155) + 0.012 * (1 - q * q),
              v,
            ),
            z,
          );
        },
        low ? 8 : 20,
        3,
        new T.Vector3(0, 1, end * 0.5),
      ),
      paint,
    );

  // The greenhouse is assembled around actual glazed openings. Window lenses
  // sit 3 mm inside their surround; no painted solid cabin behind the glass.
  const window = (fn: Surface, hint: T.Vector3) => {
    // Sample the surround along the same curved surface as the roof. A flat
    // triangulated ring leaves a crack across the crowned windshield header.
    for (const [u0, u1, v0, v1] of [
      [0, 1, 0, 0.057],
      [0, 1, 0.943, 1],
      [0, 0.057, 0.057, 0.943],
      [0.943, 1, 0.057, 0.943],
    ]) {
      const horizontal = u1 - u0 > v1 - v0;
      add(
        surface(
          (u, v) =>
            fn(T.MathUtils.lerp(u0, u1, u), T.MathUtils.lerp(v0, v1, v)),
          horizontal ? (low ? 6 : 12) : 2,
          horizontal ? 2 : low ? 4 : 8,
          hint,
        ),
        paint,
      );
    }
    add(
      surface(
        (u, v) => {
          const r = 0.05,
            y = 0.052 + v * 0.896;
          const edge = Math.max(0, r - Math.min(y - 0.052, 0.948 - y));
          const margin = r - Math.sqrt(Math.max(0, r * r - edge * edge));
          return fn(
            0.052 + margin + u * (0.896 - margin * 2),
            y,
          ).addScaledVector(hint, -0.003);
        },
        low ? 6 : 16,
        low ? 3 : 8,
        hint,
      ),
      glass,
    );
  };
  window(
    (u, v) => {
      const x = u * 2 - 1;
      return new T.Vector3(
        x * T.MathUtils.lerp(0.292, 0.246, v),
        T.MathUtils.lerp(0.151, 0.35, v) + 0.012 * (1 - x * x),
        T.MathUtils.lerp(-0.29, -0.08, v) -
          0.014 * (1 - x * x) * Math.sin(v * Math.PI),
      );
    },
    new T.Vector3(0, 0.65, -0.76).normalize(),
  );
  window(
    (u, v) => {
      const x = u * 2 - 1;
      return new T.Vector3(
        x * T.MathUtils.lerp(0.246, 0.294, v),
        T.MathUtils.lerp(0.344, 0.155, v) + 0.012 * (1 - x * x),
        T.MathUtils.lerp(0.16, 0.365, v),
      );
    },
    new T.Vector3(0, 0.7, 0.71).normalize(),
  );
  for (const s of [-1, 1])
    window(
      (u, v) => {
        const z = T.MathUtils.lerp(-0.29 + 0.21 * v, 0.365 - 0.205 * v, u);
        return new T.Vector3(
          s *
            (T.MathUtils.lerp(0.292, 0.294, u) -
              T.MathUtils.lerp(0.046, 0.048, u) * v +
              0.004 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI)),
          T.MathUtils.lerp(0.151 + 0.004 * u, 0.35 - 0.006 * u, v),
          z,
        );
      },
      new T.Vector3(s, 0.2, 0).normalize(),
    );
  add(
    surface(
      (u, v) => {
        const x = u * 2 - 1,
          z = -0.08 + v * 0.24;
        return new T.Vector3(
          x * 0.246,
          0.35 -
            0.006 * v +
            0.012 * (1 - x * x) +
            0.009 * Math.cos((x * Math.PI) / 2) * Math.sin(v * Math.PI),
          z,
        );
      },
      low ? 8 : 16,
      low ? 6 : 14,
      up,
    ),
    paint,
  );
  // Inexpensive interior silhouettes visible through tinted lenses.
  rounded([0.49, 0.022, 0.45], [0, 0.143, 0.036], trim, 0.01);
  for (const s of [-1, 1]) {
    rounded(
      [0.135, 0.118, 0.055],
      [s * 0.124, 0.204, 0.16],
      trim,
      0.023,
      new T.Euler(-0.15, 0, 0),
    );
    tube(
      [
        new T.Vector3(s * 0.284, 0.154, 0.055),
        new T.Vector3(s * 0.266, 0.248, 0.055),
        new T.Vector3(s * 0.246, 0.345, 0.055),
      ],
      0.006,
      trim,
      8,
    );
    // Rounded wing pedestals and restrained airfoil/end caps.
    rounded(
      [0.023, 0.15, 0.04],
      [s * 0.237, 0.216, 0.535],
      trim,
      0.009,
      new T.Euler(-0.2, 0, 0),
    );
    rounded([0.014, 0.043, 0.106], [s * 0.365, 0.306, 0.538], paint, 0.006);
  }
  rounded(
    [0.73, 0.025, 0.108],
    [0, 0.299, 0.538],
    paint,
    0.012,
    new T.Euler(0.06, 0, 0),
  );
  for (const [mat, geos] of batches) {
    const geo = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    const mesh = new T.Mesh(geo, mat);
    mesh.name = `vector-${mat.name.toLowerCase()}`;
    mesh.castShadow = mat !== glass && mat !== light && mat !== tail;
    mesh.receiveShadow = mat !== glass;
    shell.add(mesh);
  }
  shell.userData.materials = mats;
  return shell;
}
