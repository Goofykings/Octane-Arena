import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { wheelRadius, wheelHalfWidth } from "../car/wheels";
import { polishMaterial } from "./material-polish";
export const wheelDesigns = {
  apex: { name: "Apex", family: "five-spoke" },
  filament: { name: "Filament", family: "multi-spoke" },
  dish: { name: "Recess", family: "deep-dish" },
  offroad: { name: "Badland", family: "off-road" },
  turbine: { name: "Vortex", family: "turbine" },
  glow: { name: "Pulse", family: "glowing" },
  disc: { name: "Orbit", family: "disc" },
  star: { name: "Aster", family: "star" },
  steel: { name: "Heritage", family: "steel" },
  experimental: { name: "Gyro", family: "experimental" },
} as const;
/** Visual-only parts inside the existing rigid tire envelope. Local rim Z is
 * the axle; outer faces are mirrored so every wheel reads on both car sides.
 * Components are merged by material on equip, not submitted as separate spokes. */
export function addWheelDesign(
  spin: T.Group,
  id: string,
  side: number,
  coupe = false,
  palette?: Record<"RUBBER" | "METAL" | "DARK_TRIM", T.MeshStandardMaterial>,
) {
  const style = id in wheelDesigns ? (id as keyof typeof wheelDesigns) : "apex";
  spin.userData.designId = style;
  const rubber =
    palette?.RUBBER ??
    new T.MeshStandardMaterial({
      color: coupe ? 0x20262c : 0x111318,
      roughness: 0.9,
      metalness: 0,
    });
  rubber.userData.wheelPart = "tire";
  const tyre = new T.Mesh(
    new T.LatheGeometry(
      [
        [0.12, -wheelHalfWidth * 0.85],
        [0.15, -wheelHalfWidth],
        [wheelRadius * 0.97, -wheelHalfWidth * 0.72],
        [wheelRadius, -wheelHalfWidth * 0.4],
        [wheelRadius, wheelHalfWidth * 0.4],
        [wheelRadius * 0.97, wheelHalfWidth * 0.72],
        [0.15, wheelHalfWidth],
        [0.12, wheelHalfWidth * 0.85],
        [0.12, -wheelHalfWidth * 0.85],
      ].map(
        ([r, y]) =>
          new T.Vector2(style === "offroad" && r > 0.16 ? r * 0.955 : r, y),
      ),
      coupe ? 32 : 20,
    ),
    rubber,
  );
  tyre.name = "wheel-tire";
  if (coupe) tyre.geometry.normalizeNormals();
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  spin.add(tyre);
  const rim = new T.Group();
  rim.name = "wheel-rim";
  rim.rotation.y = (side * Math.PI) / 2;
  spin.add(rim);
  const alloy =
    palette?.METAL ??
    new T.MeshStandardMaterial({
      color: 0xb6cbd2,
      metalness: 0.45,
      roughness: 0.36,
    });
  const dark =
    palette?.DARK_TRIM ??
    new T.MeshStandardMaterial({
      color: 0x26343e,
      metalness: 0.25,
      roughness: 0.58,
    });
  const accent = new T.MeshStandardMaterial({
    color:
      style === "dish" ? 0xc88b59 : style === "offroad" ? 0xabb2a0 : 0x658ca3,
    metalness: 0.35,
    roughness: 0.42,
  });
  const glow = new T.MeshStandardMaterial({
    color: 0x68e9ff,
    emissive: 0x2fcce8,
    emissiveIntensity: 0.9,
    metalness: 0.1,
    roughness: 0.3,
  });
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const put = (
    geo: T.BufferGeometry,
    mat: T.Material,
    x = 0,
    y = 0,
    z = 0,
    rz = 0,
    rx = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ) => {
    const matrix = new T.Matrix4().compose(
      new T.Vector3(x, y, z),
      new T.Quaternion().setFromEuler(new T.Euler(rx, 0, rz)),
      new T.Vector3(sx, sy, sz),
    );
    const vertices = (
      geo.index ? geo.toNonIndexed() : geo.clone()
    ).applyMatrix4(matrix);
    geo.dispose();
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat)!.push(vertices);
  };
  const ring = (
    radius: number,
    tube: number,
    z: number,
    mat: T.Material = alloy,
    arc = Math.PI * 2,
    angle = 0,
  ) => put(new T.TorusGeometry(radius, tube, 5, 24, arc), mat, 0, 0, z, angle);
  const bar = (
    angle: number,
    r0: number,
    r1: number,
    width: number,
    z: number,
    mat = alloy,
  ) =>
    put(
      new T.BoxGeometry(r1 - r0, width, 0.009),
      mat,
      (Math.cos(angle) * (r0 + r1)) / 2,
      (Math.sin(angle) * (r0 + r1)) / 2,
      z,
      angle,
    );
  const blade = (
    angle: number,
    z: number,
    sweep: number,
    innerWidth: number,
    outerWidth: number,
    mat = alloy,
  ) => {
    const shape = new T.Shape();
    const point = (r: number, a: number, w: number) => [
      Math.cos(a) * r - Math.sin(a) * w,
      Math.sin(a) * r + Math.cos(a) * w,
    ];
    const points = [
      point(0.026, angle, innerWidth / 2),
      point(0.12, angle + sweep, outerWidth / 2),
      point(0.12, angle + sweep, -outerWidth / 2),
      point(0.026, angle, -innerWidth / 2),
    ];
    shape.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
    shape.closePath();
    put(
      new T.ExtrudeGeometry(shape, {
        depth: 0.008,
        bevelEnabled: false,
        steps: 1,
      }),
      mat,
      0,
      0,
      z - 0.004,
    );
  };
  // Open barrel, rim lips and a small brake/hub do not seal the spoke openings.
  put(
    new T.CylinderGeometry(0.124, 0.124, 0.078, 24, 1, true),
    dark,
    0,
    0,
    0,
    0,
    Math.PI / 2,
  );
  put(
    new T.CylinderGeometry(0.026, 0.026, 0.105, 12),
    alloy,
    0,
    0,
    0,
    0,
    Math.PI / 2,
  );
  for (const face of [-1, 1]) {
    const z = face * 0.046;
    ring(0.127, 0.009, z);
    put(
      new T.CylinderGeometry(0.066, 0.066, 0.004, 16),
      dark,
      0,
      0,
      face * 0.014,
      0,
      Math.PI / 2,
    );
    if (style === "apex") {
      for (let i = 0; i < 5; i++)
        if (coupe) {
          for (const split of [-0.075, 0.075])
            blade((i * Math.PI * 2) / 5 + split, z, 0.05, 0.007, 0.011);
        } else blade((i * Math.PI * 2) / 5, z, 0.035, 0.018, 0.025);
    } else if (style === "filament") {
      for (let i = 0; i < 16; i++)
        bar((i * Math.PI) / 8, 0.026, 0.121, 0.007, z);
    } else if (style === "dish") {
      ring(0.116, 0.012, z, accent);
      for (let i = 0; i < 3; i++)
        for (const shift of [-0.12, 0.12])
          blade(
            (i * Math.PI * 2) / 3 + shift,
            face * 0.022,
            0.1,
            0.01,
            0.016,
            accent,
          );
    } else if (style === "offroad") {
      for (let i = 0; i < 6; i++)
        blade((i * Math.PI) / 3, z, 0, 0.026, 0.037, accent);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        put(
          new T.CylinderGeometry(0.006, 0.006, 0.006, 5),
          alloy,
          Math.cos(a) * 0.115,
          Math.sin(a) * 0.115,
          face * 0.053,
          0,
          Math.PI / 2,
        );
      }
    } else if (style === "turbine") {
      for (let i = 0; i < 7; i++)
        blade((i * Math.PI * 2) / 7, z, 0.48, 0.012, 0.035);
    } else if (style === "glow") {
      for (let i = 0; i < 3; i++) {
        ring(0.103, 0.011, z, glow, Math.PI * 0.51, (i * Math.PI * 2) / 3);
        blade((i * Math.PI * 2) / 3, z, -0.18, 0.022, 0.013, dark);
      }
      ring(0.044, 0.007, z, glow);
    } else if (style === "disc") {
      put(
        new T.CylinderGeometry(0.119, 0.119, 0.009, 24),
        alloy,
        0,
        0,
        z,
        0,
        Math.PI / 2,
      );
      for (let i = 0; i < 3; i++)
        ring(
          0.088,
          0.006,
          face * 0.051,
          accent,
          Math.PI * 0.38,
          (i * Math.PI * 2) / 3,
        );
    } else if (style === "star") {
      const shape = new T.Shape();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 + Math.PI / 2,
          r = i % 2 ? 0.047 : 0.121;
        if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      shape.closePath();
      put(
        new T.ExtrudeGeometry(shape, {
          depth: 0.008,
          bevelEnabled: false,
          steps: 1,
        }),
        accent,
        0,
        0,
        z - 0.004,
      );
    } else if (style === "steel") {
      const shape = new T.Shape();
      shape.absarc(0, 0, 0.12, 0, Math.PI * 2, false);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4,
          hole = new T.Path();
        hole.absarc(
          Math.cos(a) * 0.087,
          Math.sin(a) * 0.087,
          0.019,
          0,
          Math.PI * 2,
          true,
        );
        shape.holes.push(hole);
      }
      put(
        new T.ExtrudeGeometry(shape, {
          depth: 0.008,
          bevelEnabled: false,
          steps: 1,
          curveSegments: 10,
        }),
        dark,
        0,
        0,
        z - 0.004,
      );
      ring(0.038, 0.008, face * 0.047, alloy);
    } else {
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        put(
          new T.TorusGeometry(0.083, 0.007, 5, 20),
          accent,
          0,
          0,
          z,
          a,
          0,
          1,
          0.52,
          1,
        );
        bar(a * 2, 0.028, 0.12, 0.009, z);
      }
    }
  }
  if (style === "offroad")
    for (let i = 0; i < 20; i++) {
      const a = (i * Math.PI) / 10;
      put(
        new T.BoxGeometry(0.014, 0.045, 0.09),
        rubber,
        Math.cos(a) * 0.171,
        Math.sin(a) * 0.171,
        0,
        a,
      );
    }
  if (coupe && style !== "offroad")
    for (let i = 0; i < 28; i++) {
      const a = (i * Math.PI * 2) / 28;
      for (const face of [-1, 1])
        put(
          new T.BoxGeometry(0.004, 0.018, 0.039),
          rubber,
          Math.cos(a) * 0.176,
          Math.sin(a) * 0.176,
          face * 0.021,
          a + face * 0.18,
        );
    }
  const used = new Set<T.Material>();
  for (const [mat, geos] of batches) {
    const geo = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    const mesh = new T.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.name = mat === rubber ? "wheel-tread-blocks" : "wheel-rim-part";
    mat.userData.wheelPart = mat === rubber ? "tire" : "rim";
    rim.add(mesh);
    used.add(mat);
  }
  for (const mat of [alloy, dark, accent, glow]) {
    if (used.has(mat)) polishMaterial(mat, "car");
    else mat.dispose();
  }
}
