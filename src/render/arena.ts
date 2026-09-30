import * as T from "three";
import { arenaShell, goalShell } from "../arena/geometry";
import { P } from "../config/physics";
import { box, material } from "./models";
function turfTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#154e47";
  ctx.fillRect(0, 0, 512, 512);
  let seed = 73;
  for (let i = 0; i < 40000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % 512;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = seed % 512;
    ctx.fillStyle = i % 2 ? "#205a4c" : "#103f3e";
    ctx.fillRect(x, y, 1, 3);
  }
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(14, 18);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
export function drawArena(scene: T.Scene) {
  const teamMaterials: { material: T.MeshBasicMaterial | T.LineBasicMaterial; color: number }[] = [];
  const a = P.arena,
    group = new T.Group();
  scene.add(group);
  const floor = new T.Mesh(
    new T.PlaneGeometry(a.halfWidth * 2, a.halfLength * 2 + 2 * a.goalDepth),
    new T.MeshStandardMaterial({ map: turfTexture(), roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const stripe = new T.MeshBasicMaterial({
    color: 0x5ac7ac,
    transparent: true,
    opacity: 0.035,
    depthWrite: false,
  });
  for (let z = -48; z < 50; z += 12) {
    const m = new T.Mesh(new T.PlaneGeometry(77, 6), stripe);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.008, z);
    group.add(m);
  }
  const shell = arenaShell(),
    geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(shell.vertices, 3));
  const lower: number[] = [],
    upper: number[] = [];
  for (let i = 0; i < shell.indices.length; i += 3) {
    const tri = Array.from(shell.indices.slice(i, i + 3));
    (tri.every((v) => shell.vertices[v * 3 + 1] <= a.ramp + 0.01)
      ? lower
      : upper
    ).push(...tri);
  }
  geo.setIndex([...lower, ...upper]);
  geo.addGroup(0, lower.length, 0);
  geo.addGroup(lower.length, upper.length, 1);
  geo.computeVertexNormals();
  const wall = new T.Mesh(geo, [
    new T.MeshStandardMaterial({
      color: 0x78969c,
      roughness: 0.66,
      metalness: 0.25,
      side: T.DoubleSide,
    }),
    new T.MeshStandardMaterial({
      color: 0x3e566b,
      roughness: 0.55,
      metalness: 0.3,
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  ]);
  group.add(wall);
  // Ramp contour bands use the same generated positions as collision geometry.
  const bandPositions: number[] = [];
  const profileLength = shell.profileLength;
  for (const row of [0, 8, 14, 20])
    for (let i = row; i < shell.vertices.length / 3; i += profileLength) {
      const next = (i + profileLength) % (shell.vertices.length / 3);
      const ax = shell.vertices[i * 3],
        az = shell.vertices[i * 3 + 2],
        bx = shell.vertices[next * 3],
        bz = shell.vertices[next * 3 + 2];
      if (
        Math.abs(az) > 47 &&
        Math.abs(bz) > 47 &&
        Math.abs((ax + bx) / 2) < a.goalHalf + a.goalLip
      )
        continue;
      bandPositions.push(
        ax,
        shell.vertices[i * 3 + 1] + 0.025,
        az,
        bx,
        shell.vertices[next * 3 + 1] + 0.025,
        bz,
      );
    }
  const bands = new T.BufferGeometry();
  bands.setAttribute(
    "position",
    new T.Float32BufferAttribute(bandPositions, 3),
  );
  group.add(
    new T.LineSegments(
      bands,
      new T.LineBasicMaterial({
        color: 0xa6eeeb,
        transparent: true,
        opacity: 0.48,
      }),
    ),
  );
  const lines = new T.LineBasicMaterial({
    color: 0xb6ded1,
    transparent: true,
    opacity: 0.65,
  });
  const line = (points: T.Vector3[], mat: T.LineBasicMaterial = lines) => {
    const l = new T.Line(new T.BufferGeometry().setFromPoints(points), mat);
    group.add(l);
  };
  line([new T.Vector3(-37, 0.025, 0), new T.Vector3(37, 0.025, 0)]);
  const circle = (r: number, x: number, z: number, color = 0xb6ded1) => {
    const ps = [];
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      ps.push(new T.Vector3(x + r * Math.cos(t), 0.035, z + r * Math.sin(t)));
    }
    line(ps, new T.LineBasicMaterial({ color }));
  };
  circle(9, 0, 0);
  circle(0.3, 0, 0);
  for (const sign of [-1, 1]) {
    const color = sign > 0 ? 0x41d9f2 : 0xffb44f,
      glow = new T.MeshBasicMaterial({ color }),
      goal = new T.Group();
    group.add(goal);
    const lining = goalShell(sign),
      liningGeo = new T.BufferGeometry();
    liningGeo.setAttribute(
      "position",
      new T.BufferAttribute(lining.vertices, 3),
    );
    liningGeo.setIndex(new T.BufferAttribute(lining.indices, 1));
    liningGeo.computeVertexNormals();
    const liningMesh = new T.Mesh(
      liningGeo,
      new T.MeshStandardMaterial({
        color: 0x456172,
        metalness: 0.3,
        roughness: 0.62,
        side: T.DoubleSide,
      }),
    );
    liningMesh.receiveShadow = true;
    goal.add(liningMesh);
    box(
      goal,
      [0.18, a.goalHeight, 0.18],
      [-a.goalHalf, a.goalHeight / 2, sign * a.halfLength],
      glow,
    );
    box(
      goal,
      [0.18, a.goalHeight, 0.18],
      [a.goalHalf, a.goalHeight / 2, sign * a.halfLength],
      glow,
    );
    box(
      goal,
      [a.goalHalf * 2, 0.18, 0.18],
      [0, a.goalHeight, sign * a.halfLength],
      glow,
    );
    box(
      goal,
      [a.goalHalf * 2, a.goalHeight, 0.1],
      [0, a.goalHeight / 2, sign * (a.halfLength + a.goalDepth)],
      material(0x112a35),
    );
    const net = new T.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.23,
    });
    const marking = new T.LineBasicMaterial({ color });
    for (const material of [glow, net, marking]) teamMaterials.push({ material, color });
    for (let x = -a.goalHalf; x <= a.goalHalf; x += 0.65)
      line(
        [
          new T.Vector3(x, 0, sign * (a.halfLength + a.goalDepth - 0.1)),
          new T.Vector3(
            x,
            a.goalHeight,
            sign * (a.halfLength + a.goalDepth - 0.1),
          ),
          new T.Vector3(x, a.goalHeight, sign * a.halfLength),
        ],
        net,
      );
    for (let y = 0; y <= a.goalHeight; y += 0.65)
      line(
        [
          new T.Vector3(-a.goalHalf, y, sign * a.halfLength),
          new T.Vector3(-a.goalHalf, y, sign * (a.halfLength + a.goalDepth)),
          new T.Vector3(a.goalHalf, y, sign * (a.halfLength + a.goalDepth)),
          new T.Vector3(a.goalHalf, y, sign * a.halfLength),
        ],
        net,
      );
    line(
      [
        new T.Vector3(-17, 0.04, sign * 48),
        new T.Vector3(-17, 0.04, sign * 37),
        new T.Vector3(17, 0.04, sign * 37),
        new T.Vector3(17, 0.04, sign * 48),
      ],
      marking,
    );
    // Original floating light canopy and terraced seating outside the playable shell.
    for (let side of [-1, 1]) {
      box(group, [0.12, 0.12, 44], [side * 40.9, 5, sign * 24], glow);
      box(group, [0.16, 0.16, 48], [side * 41.2, 19, sign * 24], glow);
    }
  }
  const seats = material(0x1d3945);
  for (const side of [-1, 1])
    for (let tier = 0; tier < 7; tier++) {
      box(
        group,
        [3, 0.45, 112],
        [side * (44 + tier * 2.5), 3 + tier * 1.4, 0],
        seats,
      );
    }
  const beacon = new T.MeshBasicMaterial({ color: 0xb7e6ef });
  for (const side of [-1, 1])
    for (let z = -45; z <= 45; z += 15) {
      box(group, [0.3, 20, 0.3], [side * 44, 10, z], material(0x304754));
      box(group, [4, 0.15, 1], [side * 42, 21, z], beacon);
    }
  // Light structural grid makes the enclosed ceiling visible without busy artwork.
  const gridMat = new T.LineBasicMaterial({
    color: 0x6aa0b1,
    transparent: true,
    opacity: 0.12,
  });
  for (let x = -36; x <= 36; x += 6)
    line([new T.Vector3(x, 20.4, -48), new T.Vector3(x, 20.4, 48)], gridMat);
  for (let z = -48; z <= 48; z += 6)
    line([new T.Vector3(-38, 20.4, z), new T.Vector3(38, 20.4, z)], gridMat);
  drawCity(scene);
  return {
    setNeutral(neutral: boolean) {
      for (const entry of teamMaterials)
        entry.material.color.setHex(neutral ? 0xa8a8a8 : entry.color);
    },
  };
}

/** Lumen District: original terraced towers, lit windows and elevated skybridges. */
function drawCity(scene: T.Scene) {
  const city = new T.Group();
  scene.add(city);
  const concrete = material(0x243343, 0.5, 0.7),
    trim = material(0x405469, 0.6, 0.4);
  const windowMat = new T.MeshBasicMaterial({ color: 0xf2cb8b });
  const windows = new T.InstancedMesh(
    new T.BoxGeometry(0.65, 0.9, 0.08),
    windowMat,
    2200,
  );
  let count = 0;
  const dummy = new T.Object3D();
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2,
      x = Math.cos(t) * (82 + (i % 3) * 8),
      z = Math.sin(t) * (97 + (i % 4) * 6),
      height = 18 + ((i * 17) % 39),
      width = 7 + (i % 5);
    box(city, [width, height, 9], [x, height / 2 - 2, z], concrete).castShadow =
      false;
    box(city, [width + 1, 0.7, 10], [x, height - 2, z], trim).castShadow =
      false;
    box(city, [width * 0.6, 5, 6], [x, height + 0.5, z], concrete).castShadow =
      false;
    const strip = box(
      city,
      [0.12, height * 0.75, 0.12],
      [x - width / 2 - 0.1, height * 0.4, z - 4.6],
      new T.MeshBasicMaterial({ color: i % 2 ? 0x79d9df : 0xf6ba77 }),
    );
    strip.castShadow = false;
    for (let level = 2; level < height - 4; level += 2.4)
      for (let col = -width / 2 + 1; col < width / 2; col += 1.6)
        for (const side of [-1, 1]) {
          if (
            (i + Math.floor(level) + Math.floor(col)) % 3 === 0 ||
            count >= 2200
          )
            continue;
          dummy.position.set(x + col, level, z + side * 4.55);
          dummy.updateMatrix();
          windows.setMatrixAt(count++, dummy.matrix);
        }
    if (i % 5 === 0) {
      const mast = box(city, [0.15, 8, 0.15], [x, height + 6, z], trim);
      mast.castShadow = false;
      box(
        city,
        [0.6, 0.3, 0.6],
        [x, height + 10, z],
        new T.MeshBasicMaterial({ color: 0xff8173 }),
      );
    }
  }
  windows.count = count;
  windows.instanceMatrix.needsUpdate = true;
  city.add(windows);
  for (const side of [-1, 1]) {
    box(city, [5, 1.2, 150], [side * 71, 17, 0], concrete).castShadow = false;
    box(
      city,
      [0.12, 0.15, 150],
      [side * 68.5, 17.8, 0],
      new T.MeshBasicMaterial({ color: 0x8be9e2 }),
    );
    for (const z of [-50, 0, 50])
      box(city, [1, 17, 1], [side * 71, 8.5, z], trim).castShadow = false;
  }
  const moon = new T.Mesh(
    new T.SphereGeometry(5, 20, 16),
    new T.MeshBasicMaterial({ color: 0xffdfb0 }),
  );
  moon.position.set(-65, 75, -130);
  scene.add(moon);
}
