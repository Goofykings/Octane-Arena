import * as T from "three";
import { HOOPS_CONFIG as H } from "../../shared/hoops";
/** Decorative neighborhood only; no physics bodies. Nearby camera space stays open. */
export function drawHoopsNeighborhood(parent: T.Group) {
  const scene = new T.Group();
  scene.name = "hoops-neighborhood";
  parent.add(scene);
  const boxGeo = new T.BoxGeometry(1, 1, 1),
    materials = new Map<number, T.MeshStandardMaterial>(),
    windows: { p: T.Vector3; s: T.Vector3; c: number }[] = [],
    occluders: T.Mesh[] = [];
  const material = (color: number) => {
    if (!materials.has(color))
      materials.set(
        color,
        new T.MeshStandardMaterial({ color, roughness: 0.82 }),
      );
    return materials.get(color)!;
  };
  const box = (
    size: number[],
    pos: number[],
    color: number,
    name = "neighborhood-detail",
  ) => {
    const m = new T.Mesh(boxGeo, material(color));
    m.scale.set(size[0], size[1], size[2]);
    m.position.set(pos[0], pos[1], pos[2]);
    m.name = name;
    m.castShadow = false;
    scene.add(m);
    return m;
  };
  box([180, 0.1, 190], [0, -0.4, 0], 0x6d7b71, "neighborhood-ground");
  const facade = [0xa9a397, 0x968c83, 0x81939b, 0xb4a18a, 0x737b83];
  for (const side of [-1, 1]) {
    box(
      [8, 0.2, 105],
      [side * (H.arenaWidth / 2 + 11), -0.15, 0],
      0x858b8a,
      "sidewalk",
    );
    box(
      [8, 0.08, 105],
      [side * (H.arenaWidth / 2 + 19), -0.2, 0],
      0x343d43,
      "neighborhood-street",
    );
    for (let i = 0; i < 7; i++) {
      const z = -43 + i * 14,
        team = z > 0 ? 0x3d8bb5 : 0xb57442,
        height = 8 + ((i * 7) % 4) * 2.2,
        width = 10 + (i % 2) * 2,
        x = side * (H.arenaWidth / 2 + 30 + (i % 3) * 2);
      const building = box(
        [10, height, width],
        [x, height / 2 - 0.2, z],
        facade[(i + (side > 0 ? 1 : 0)) % facade.length],
        "neighborhood-building",
      );
      occluders.push(building);
      box([10.8, 0.35, width + 0.6], [x, height, z], 0x505b62, "roof-trim");
      box(
        [2.5, 1.5, 2],
        [x + side * 1.5, height + 0.7, z + 2],
        0x6b7478,
        "rooftop-vent",
      );
      for (let y = 3; y < height - 1; y += 2.7)
        for (const dz of [-3, 0, 3])
          windows.push({
            p: new T.Vector3(x - side * 5.03, y, z + dz),
            s: new T.Vector3(0.05, 1.15, 1.3),
            c: 0xd7caa3,
          });
      if (i % 2 === 0) {
        box(
          [2.5, 0.18, width - 1],
          [x - side * 5.6, 2.8, z],
          team,
          "shop-awning",
        );
        box(
          [0.06, 1.2, width - 2],
          [x - side * 5.05, 3.7, z],
          0x263b48,
          "shop-sign",
        );
        for (const dz of [-2, 0, 2])
          box(
            [0.08, 0.16, 0.7],
            [x - side * 5.1, 3.7, z + dz],
            team,
            "shop-sign-letter",
          );
        box([0.08, 2.1, 2.6], [x - side * 5.06, 1, z], 0x364e58, "storefront");
      } else {
        const roof = new T.Mesh(
          new T.ConeGeometry(7, 2.5, 4),
          material(0x5b666a),
        );
        roof.rotation.y = Math.PI / 4;
        roof.position.set(x, height + 1, z);
        roof.scale.z = width / 10;
        roof.name = "house-roof";
        scene.add(roof);
        occluders.push(roof);
      }
    }
    for (const z of [-35, -15, 5, 25, 42]) {
      const x = side * (H.arenaWidth / 2 + 9);
      box([0.12, 7, 0.12], [x, 3.5, z], 0x3a4953, "streetlight");
      box([2, 0.1, 0.2], [x - side * 0.8, 7, z], 0x425563);
      const lamp = new T.Mesh(
        new T.BoxGeometry(0.8, 0.08, 0.35),
        new T.MeshBasicMaterial({ color: z > 0 ? 0xa8dfff : 0xffd2a0 }),
      );
      lamp.position.set(x - side * 1.5, 6.92, z);
      scene.add(lamp);
      box([2, 0.55, 2], [x + side * 2, 0.2, z + 3], 0x667368, "planter");
      box([0.32, 3, 0.32], [x + side * 2, 1.6, z + 3], 0x716252);
      const tree = new T.Mesh(
        new T.IcosahedronGeometry(1.7, 0),
        material(0x466e58),
      );
      tree.position.set(x + side * 2, 3.7, z + 3);
      scene.add(tree);
    }
    for (const z of [-24, 17]) {
      const x = side * (H.arenaWidth / 2 + 18);
      box(
        [1.8, 0.75, 3.8],
        [x, 0.5, z],
        z > 0 ? 0x536e89 : 0x97765d,
        "parked-car",
      );
      box([1.55, 0.6, 1.8], [x, 1.1, z + 0.1], 0x344952);
    }
  }
  for (const sign of [-1, 1]) {
    const team = sign > 0 ? 0x3f8cbe : 0xbf804a;
    box(
      [100, 0.2, 7],
      [0, -0.15, sign * (H.arenaLength / 2 + 10)],
      0x858b8a,
      "end-sidewalk",
    );
    box(
      [100, 0.08, 8],
      [0, -0.2, sign * (H.arenaLength / 2 + 17)],
      0x343d43,
      "end-street",
    );
    for (const x of [-24, -8, 8, 24]) {
      const height = 9 + (Math.abs(x) % 3) * 2;
      const b = box(
        [12, height, 8],
        [x, height / 2, sign * (H.arenaLength / 2 + 25)],
        0x8d9696,
        "end-street-building",
      );
      occluders.push(b);
      box(
        [12.4, 0.3, 8.4],
        [x, height + 0.1, sign * (H.arenaLength / 2 + 25)],
        0x56636b,
      );
      box(
        [6, 0.9, 0.12],
        [x, 3.6, sign * (H.arenaLength / 2 + 20.9)],
        team,
        "end-shop-sign",
      );
      for (const dx of [-3, 0, 3])
        for (let y = 5; y < height - 1; y += 2.5)
          windows.push({
            p: new T.Vector3(x + dx, y, sign * (H.arenaLength / 2 + 20.98)),
            s: new T.Vector3(1.3, 1.05, 0.04),
            c: 0xd7caa3,
          });
    }
  }
  const win = new T.InstancedMesh(
      boxGeo,
      new T.MeshBasicMaterial({ color: 0xd7caa3 }),
      windows.length,
    ),
    dummy = new T.Object3D();
  windows.forEach((w, i) => {
    dummy.position.copy(w.p);
    dummy.scale.copy(w.s);
    dummy.updateMatrix();
    win.setMatrixAt(i, dummy.matrix);
  });
  win.name = "instanced-neighborhood-windows";
  scene.add(win);
  return occluders;
}
