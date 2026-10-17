import { drawHoopsNeighborhood } from "./hoops-neighborhood";
import * as T from "three";
import { HOOPS_CONFIG as H, hoopsRimPath } from "../../shared/hoops";
import { hoopsShell, hoopsNet } from "../arena/hoops";
import type { ArenaMesh } from "../arena/geometry";
const geometry = (m: ArenaMesh) => {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(m.vertices, 3));
  g.setIndex(new T.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  return g;
};
export function drawHoopsArena(scene: T.Scene) {
  const group = new T.Group();
  group.name = "hoops-court";
  scene.add(group);
  const shell = hoopsShell(),
    g = geometry(shell),
    lower: number[] = [],
    upper: number[] = [],
    roof: number[] = [];
  for (let i = 0; i < shell.indices.length; i += 3) {
    const tri = Array.from(shell.indices.slice(i, i + 3)),
      ys = tri.map((v) => shell.vertices[v * 3 + 1]);
    (ys.every((y) => y >= H.ceilingHeight - 0.02)
      ? roof
      : ys.every((y) => y <= H.rampRadius + 0.01)
        ? lower
        : upper
    ).push(...tri);
  }
  g.setIndex([...lower, ...upper, ...roof]);
  g.addGroup(0, lower.length, 0);
  g.addGroup(lower.length, upper.length, 1);
  g.addGroup(lower.length + upper.length, roof.length, 2);
  const wall = new T.Mesh(g, [
    new T.MeshStandardMaterial({
      color: 0x657584,
      roughness: 0.7,
      side: T.FrontSide,
    }),
    new T.MeshStandardMaterial({
      color: 0x8bb2c5,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: T.FrontSide,
    }),
    new T.MeshBasicMaterial({
      color: 0xb4d4e5,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      side: T.FrontSide,
    }),
  ]);
  wall.name = "hoops-continuous-shell";
  wall.userData.cameraCollision = "ARENA_BOUNDARY";
  group.add(wall);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#b77b45";
  ctx.fillRect(0, 0, 1024, 1024);
  for (let row = 0; row < 64; row++) {
    ctx.fillStyle =
      row % 3 === 0 ? "#b27a47" : row % 3 === 1 ? "#c18b56" : "#cb955e";
    ctx.fillRect(0, row * 16, 1024, 15);
    ctx.strokeStyle = "rgba(67,35,18,.2)";
    ctx.lineWidth = 1;
    for (let col = 0; col < 12; col++) {
      ctx.beginPath();
      ctx.moveTo(col * 96 + (row % 3) * 32, row * 16);
      ctx.lineTo(col * 96 + (row % 3) * 32, row * 16 + 15);
      ctx.stroke();
    }
  }
  const sx = 1024 / H.arenaWidth,
    sz = 1024 / H.arenaLength;
  const line = (points: number[][], color = "#f6e9ce", width = 3) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(512 + x * sx, 512 + z * sz);
      else ctx.lineTo(512 + x * sx, 512 + z * sz);
    });
    ctx.stroke();
  };
  const circle = (x: number, z: number, r: number, color = "#f6e9ce") =>
    line(
      Array.from({ length: 129 }, (_, i) => [
        x + Math.cos((i / 128) * Math.PI * 2) * r,
        z + Math.sin((i / 128) * Math.PI * 2) * r,
      ]),
      color,
    );
  line([
    [-27, 0],
    [27, 0],
  ]);
  circle(0, 0, 6);
  circle(0, 0, 0.9);
  line(
    [
      [-27, -32],
      [-27, 32],
      [27, 32],
      [27, -32],
      [-27, -32],
    ],
    "#fff0d0",
    4,
  );
  for (const sign of [-1, 1]) {
    const c = sign > 0 ? "#4f9ee0" : "#eea052";
    line(
      [
        [-25, sign * 1.4],
        [-25, sign * 30],
        [25, sign * 30],
        [25, sign * 1.4],
      ],
      c,
      7,
    );
    line(
      [
        [-4, sign * 2],
        [-2, sign * 4],
        [2, sign * 4],
        [4, sign * 2],
      ],
      c,
      4,
    );
  }

  for (const sign of [-1, 1]) {
    ctx.fillStyle =
      sign === 1 ? "rgba(30,110,205,.45)" : "rgba(228,103,24,.45)";
    ctx.fillRect(
      512 - 7 * sx,
      512 + (sign > 0 ? 20 : -34) * sz,
      14 * sx,
      14 * sz,
    );
    line([
      [-7, sign * 34],
      [-7, sign * 20],
      [7, sign * 20],
      [7, sign * 34],
    ]);
    circle(0, sign * 20, 4);
    line(
      hoopsRimPath(sign).map((p) => [p.x, p.z]),
      sign === 1 ? "#479eee" : "#ffac53",
    );
  }
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  const floor = new T.Mesh(
    new T.PlaneGeometry(
      H.arenaWidth - 2 * H.rampRadius,
      H.arenaLength - 2 * H.rampRadius,
    ),
    new T.MeshStandardMaterial({ map: tex, roughness: 0.56 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.009;
  floor.receiveShadow = true;
  group.add(floor);
  const teamMaterials: { material: T.MeshStandardMaterial; color: number }[] =
    [];
  for (const sign of [-1, 1]) {
    const color = sign === 1 ? 0x398deb : 0xf09b42,
      mat = new T.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.22,
        metalness: 0.5,
        roughness: 0.36,
      });
    teamMaterials.push({ material: mat, color });
    const path = hoopsRimPath(sign),
      curve = new T.CurvePath<T.Vector3>();
    for (let i = 0; i < path.length - 1; i++)
      curve.add(
        new T.LineCurve3(
          new T.Vector3().copy(path[i]),
          new T.Vector3().copy(path[i + 1]),
        ),
      );
    const rim = new T.Mesh(
      new T.TubeGeometry(curve, 128, H.rimThickness / 2, 8, false),
      mat,
    );
    rim.name = "hoops-solid-rim";
    rim.castShadow = true;
    group.add(rim);
    const netData = hoopsNet(sign),
      netGeo = geometry(netData),
      cols = netData.vertices.length / 3 / netData.profileLength,
      grid: T.Vector3[] = [];
    for (let row = 0; row < netData.profileLength; row++)
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col,
          p = new T.Vector3().fromArray(netData.vertices, i * 3);
        if (col + 1 < cols)
          grid.push(
            p,
            new T.Vector3().fromArray(netData.vertices, (i + 1) * 3),
          );
        if (row + 1 < netData.profileLength)
          grid.push(
            p,
            new T.Vector3().fromArray(netData.vertices, (i + cols) * 3),
          );
      }
    const net = new T.LineSegments(
      new T.BufferGeometry().setFromPoints(grid),
      new T.LineBasicMaterial({
        color: 0xcbdce4,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    net.name = "hoops-car-pass-through-net";
    group.add(net);
    const veil = new T.Mesh(
      netGeo,
      new T.MeshBasicMaterial({
        color: 0x91b3c5,
        transparent: true,
        opacity: 0.035,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    veil.name = "hoops-net-surface";
    group.add(veil);
    // Painted board is flush with the wall, adding no collision lip.
    const board = new T.Mesh(
      new T.PlaneGeometry(18, 7),
      new T.MeshStandardMaterial({
        color: 0xadc5d5,
        transparent: true,
        opacity: 0.45,
        side: T.DoubleSide,
      }),
    );
    board.position.set(0, 7, sign * (H.arenaLength / 2 - 0.025));
    if (sign > 0) board.rotation.y = Math.PI;
    group.add(board);
    const marks = new T.LineLoop(
      new T.BufferGeometry().setFromPoints([
        new T.Vector3(-4, 4.2, 0),
        new T.Vector3(4, 4.2, 0),
        new T.Vector3(4, 8, 0),
        new T.Vector3(-4, 8, 0),
      ]),
      new T.LineBasicMaterial({ color }),
    );
    marks.position.z = sign * (H.arenaLength / 2 - 0.05);
    group.add(marks);
  }
  const neighborhood = drawHoopsNeighborhood(group);
  // Thin perimeter strips clearly identify team territory without repainting the court.
  for (const sign of [-1, 1])
    for (const side of [-1, 1])
      for (const z of [7, 15, 23]) {
        const color = sign > 0 ? 0x358de0 : 0xee9342,
          m = new T.MeshBasicMaterial({ color });
        const strip = new T.Mesh(new T.BoxGeometry(0.06, 0.12, 6), m);
        strip.position.set(side * (H.arenaWidth / 2 - 0.04), 2.1, sign * z);
        strip.name = "hoops-team-edge";
        group.add(strip);
        const panel = new T.Mesh(
          new T.BoxGeometry(0.04, 0.65, 3.5),
          new T.MeshStandardMaterial({ color, roughness: 0.6 }),
        );
        panel.position.set(side * (H.arenaWidth / 2 - 0.05), 1.6, sign * z);
        group.add(panel);
      }
  const fence: T.Vector3[] = [];
  for (const side of [-1, 1])
    for (let z = -28; z <= 28; z += 2)
      fence.push(
        new T.Vector3(side * (H.arenaWidth / 2 - 0.02), 2, z),
        new T.Vector3(side * (H.arenaWidth / 2 - 0.02), 7, z),
      );
  const fenceMesh = new T.LineSegments(
    new T.BufferGeometry().setFromPoints(fence),
    new T.LineBasicMaterial({
      color: 0x688494,
      transparent: true,
      opacity: 0.25,
    }),
  );
  group.add(fenceMesh);
  group.visible = false;
  return {
    group,
    occluders: neighborhood,
    setNeutral(neutral: boolean) {
      for (const { material, color } of teamMaterials) {
        material.color.setHex(neutral ? 0xaaaaaa : color);
        material.emissive.setHex(neutral ? 0xaaaaaa : color);
      }
    },
  };
}
/** Original basketball seam bands, no external assets; visual only. */
export function hoopsBall(ball: T.Group, enabled: boolean) {
  let skin = ball.getObjectByName("hoops-basketball") as T.Group | undefined;
  if (!skin && enabled) {
    skin = new T.Group();
    skin.name = "hoops-basketball";
    const r = 0.95;
    const sphere = new T.Mesh(
      new T.SphereGeometry(r, 32, 20),
      new T.MeshStandardMaterial({ color: 0xd67c2f, roughness: 0.86 }),
    );
    skin.add(sphere);
    const seam = new T.MeshBasicMaterial({ color: 0x34251d });
    for (const axis of [0, 1, 2]) {
      const ring = new T.Mesh(
        new T.TorusGeometry(r + 0.004, 0.013, 4, 64),
        seam,
      );
      if (axis === 1) ring.rotation.x = Math.PI / 2;
      if (axis === 2) ring.rotation.y = Math.PI / 2;
      skin.add(ring);
    }
    ball.add(skin);
  }
  for (const child of ball.children) {
    if (child === skin) child.visible = enabled;
    else child.visible = !enabled;
  }
  ball.userData.hoops = enabled;
}
