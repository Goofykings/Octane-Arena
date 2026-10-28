import * as T from "three";
/** Small original primitive sculptures. All bases use local Y=0 so the same
 * roof attachment works on every body. No textures, loaders or extra lights. */
export function createTopper(id: string): T.Group {
  const variants: Record<string, [string, number]> = {
    "emerald-hat": ["top-hat", 0x50efb0],
    "solar-halo": ["halo", 0xffcf56],
    "frost-crown": ["crown", 0xa2eaff],
    "violet-ufo": ["ufo", 0xbb8bff],
  };
  if (variants[id]) {
    const [base, color] = variants[id];
    const variant = createTopper(base);
    variant.name = "topper-" + id;
    variant.traverse((o) => {
      if (o instanceof T.Mesh)
        (o.material as T.MeshStandardMaterial).color.setHex(color);
    });
    return variant;
  }
  const root = new T.Group();
  root.name = "topper-" + id;
  const mats = new Map<number, T.MeshStandardMaterial>();
  const add = (
    geo: T.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z = 0,
  ) => {
    let mat = mats.get(color);
    if (!mat) {
      mat = new T.MeshStandardMaterial({
        color,
        roughness: 0.48,
        metalness: 0.15,
      });
      mats.set(color, mat);
    }
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    c: number,
    x: number,
    y: number,
    z = 0,
  ) => add(new T.BoxGeometry(w, h, d), c, x, y, z);
  const cyl = (r: number, h: number, c: number, x: number, y: number, z = 0) =>
    add(new T.CylinderGeometry(r, r, h, 12), c, x, y, z);
  const ball = (r: number, c: number, x: number, y: number, z = 0) =>
    add(new T.SphereGeometry(r, 10, 8), c, x, y, z);
  const cone = (r: number, h: number, c: number, x: number, y: number, z = 0) =>
    add(new T.ConeGeometry(r, h, 12), c, x, y, z);
  switch (id) {
    case "top-hat":
      cyl(0.17, 0.025, 0x171b2b, 0, 0.0125);
      cyl(0.115, 0.22, 0x171b2b, 0, 0.13);
      cyl(0.118, 0.04, 0xe25462, 0, 0.055);
      break;
    case "cat-ears":
      for (const x of [-0.15, 0.15]) {
        const ear = add(new T.ConeGeometry(0.12, 0.2, 3), 0x283443, x, 0.1);
        ear.scale.z = 0.45;
        const inner = add(
          new T.ConeGeometry(0.07, 0.12, 3),
          0xffa5bc,
          x,
          0.105,
          -0.04,
        );
        inner.scale.z = 0.2;
      }
      break;
    case "birthday":
      cone(0.13, 0.32, 0x9b72e9, 0, 0.16);
      ball(0.045, 0xffdc72, 0, 0.34);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ball(
          0.022,
          i % 2 ? 0x75e4db : 0xffda72,
          Math.cos(a) * 0.087,
          0.1,
          Math.sin(a) * 0.087,
        );
      }
      break;
    case "pickle": {
      const p = ball(0.09, 0x4f963d, 0, 0.165);
      p.scale.set(0.9, 1.8, 0.9);
      for (let i = 0; i < 8; i++) {
        const a = i * 2.4;
        ball(
          0.015,
          0x87bc50,
          Math.cos(a) * 0.076,
          0.07 + (i % 4) * 0.055,
          Math.sin(a) * 0.076,
        );
      }
      break;
    }
    case "crown":
      cyl(0.15, 0.08, 0xe6b946, 0, 0.04);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        cone(
          0.045,
          0.12,
          0xf9d77d,
          Math.cos(a) * 0.12,
          0.13,
          Math.sin(a) * 0.12,
        );
        ball(0.022, 0x61d4ed, Math.cos(a) * 0.125, 0.07, Math.sin(a) * 0.125);
      }
      break;
    case "cone":
      box(0.29, 0.025, 0.29, 0x333b45, 0, 0.0125);
      cone(0.105, 0.29, 0xff8836, 0, 0.17);
      cyl(0.069, 0.035, 0xf6efe1, 0, 0.15);
      break;
    case "beanie": {
      add(
        new T.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        0x53bdba,
        0,
        0,
      );
      cyl(0.017, 0.11, 0xc9d9e4, 0, 0.19);
      box(0.39, 0.015, 0.065, 0xf8ca62, 0, 0.25);
      ball(0.028, 0xf37770, 0, 0.26);
      break;
    }
    case "halo": {
      cyl(0.008, 0.16, 0x809aad, 0, 0.08, 0.07);
      const ring = add(
        new T.TorusGeometry(0.17, 0.022, 6, 20),
        0xffe89b,
        0,
        0.18,
      );
      ring.rotation.x = Math.PI / 2;
      break;
    }
    case "ufo": {
      const saucer = ball(0.19, 0xabbac9, 0, 0.08);
      saucer.scale.y = 0.3;
      const dome = ball(0.09, 0x75e5cf, 0, 0.12);
      dome.scale.y = 0.7;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ball(0.02, 0xffd77a, Math.cos(a) * 0.16, 0.08, Math.sin(a) * 0.16);
      }
      break;
    }
    case "pirate": {
      const brim = ball(0.2, 0x262533, 0, 0.05);
      brim.scale.set(1, 0.22, 0.75);
      const cap = add(new T.ConeGeometry(0.18, 0.2, 3), 0x262533, 0, 0.11);
      cap.rotation.y = Math.PI;
      cap.scale.z = 0.6;
      ball(0.034, 0xeee9d7, 0, 0.1, -0.095);
      box(0.08, 0.012, 0.012, 0xeee9d7, 0, 0.065, -0.1);
      break;
    }
  }
  return root;
}
