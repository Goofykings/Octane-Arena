import { drawDropshotArena } from "./dropshot";
import type { DropshotSnapshot } from "../../shared/dropshot";
import { drawHoopsArena } from "./hoops";
import * as T from "three";
import { addArenaHex, addTeamCircles } from "./arena-markings";
import { arenaShell, goalShell } from "../arena/geometry";
import { goalFrame } from "../arena/posts";
import { goalRoofHeight } from "../arena/goal";
import { P } from "../config/physics";
import { box, material } from "./models";
import { polishMaterial } from "./material-polish";
import { arenaThemes, isArenaId, type ArenaId } from "./arena-themes";
import { drawEnvironment, disposeEnvironment } from "./arena-environments";
import { createFieldArt, rampPaint } from "./field-art";
import {
  registerCameraVisualOcclusion,
  addCameraVisualOccluders,
} from "./camera-occlusion";
function applyArenaLighting(
  scene: T.Scene,
  theme: (typeof arenaThemes)[ArenaId],
) {
  scene.background = new T.Color(theme.sky);
  scene.fog = new T.Fog(theme.sky, theme.fogNear, theme.fogFar);
  scene.children.forEach((o) => {
    if (o instanceof T.HemisphereLight) {
      o.color.setHex(theme.skyLight);
      o.groundColor.setHex(theme.groundLight);
      o.intensity = theme.ambientIntensity;
    }
    if (o instanceof T.DirectionalLight) {
      o.color.setHex(theme.sunlight);
      o.intensity = theme.sunIntensity;
    }
  });
}
function turfTexture(id: ArenaId) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  const palette = arenaThemes[id].turf;
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, 512, 512);
  let seed = 73;
  for (let i = 0; i < 40000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % 512;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = seed % 512;
    ctx.fillStyle = palette[i % 2 ? 1 : 2];
    ctx.fillRect(x, y, id === "beach" ? 2 : 1, id === "beach" ? 1 : 3);
  }
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(14, 18);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
function drawSoccarArena(scene: T.Scene, initial: ArenaId = "city") {
  const teamMaterials: {
    material:
      | T.MeshBasicMaterial
      | T.MeshStandardMaterial
      | T.LineBasicMaterial;
    color: number;
  }[] = [];
  const a = P.arena,
    group = new T.Group();
  group.name = "shared-arena-shell";
  scene.add(group);
  const floor = new T.Mesh(
    new T.PlaneGeometry(a.halfWidth * 2, a.halfLength * 2 + 2 * a.goalDepth),
    polishMaterial(
      new T.MeshStandardMaterial({
        map: turfTexture(initial),
        roughness: 0.95,
      }),
      "ground",
    ),
  );
  floor.name = "stadium-turf";
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
      side: T.FrontSide,
    }),
    new T.MeshStandardMaterial({
      color: 0x3e566b,
      roughness: 0.55,
      metalness: 0.3,
      side: T.FrontSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  ]);
  wall.name = "shared-arena-walls";
  // The shell is wound toward the playable interior. Its back faces are not
  // rendered: an outside view can look inward without a wall in front of it.
  // Interior opacity/art remains exactly as selected by the arena theme.
  wall.userData.cameraCollision = "ARENA_BOUNDARY";
  (wall.material as T.Material[]).forEach((mat) => polishMaterial(mat, "wall"));
  group.add(wall);
  addArenaHex(group, shell);
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
  const bandMaterial = new T.LineBasicMaterial({
    color: 0xa6eeeb,
    transparent: true,
    opacity: 0.48,
  });
  group.add(new T.LineSegments(bands, bandMaterial));
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
  const circle = (r: number, x: number, z: number) => {
    const ps = [];
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      ps.push(new T.Vector3(x + r * Math.cos(t), 0.035, z + r * Math.sin(t)));
    }
    line(ps);
  };
  addTeamCircles(group);
  circle(0.3, 0, 0);
  // Restrained inset lane accents leave the central boost routes unobstructed.
  for (const side of [-1, 1]) {
    line([
      new T.Vector3(side * 24, 0.03, -32),
      new T.Vector3(side * 28, 0.03, -24),
      new T.Vector3(side * 28, 0.03, 24),
      new T.Vector3(side * 24, 0.03, 32),
    ]);
  }
  const linings: T.MeshStandardMaterial[] = [];
  for (const sign of [-1, 1]) {
    const color = sign > 0 ? 0x41d9f2 : 0xffb44f,
      glow = polishMaterial(new T.MeshBasicMaterial({ color }), "goal"),
      goal = new T.Group();
    const trim = polishMaterial(
      new T.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.12,
        metalness: 0.3,
        roughness: 0.45,
        side: T.FrontSide,
      }),
      "goal",
    );
    teamMaterials.push({ material: trim, color });
    group.add(goal);
    const lining = goalShell(sign),
      liningGeo = new T.BufferGeometry();
    liningGeo.setAttribute(
      "position",
      new T.BufferAttribute(lining.vertices, 3),
    );
    liningGeo.setIndex(new T.BufferAttribute(lining.indices, 1));
    // Goal-shell front fascia patches originally relied on DoubleSide. Orient
    // those render-only triangles toward the field; don't alter shared meshes.
    const points = liningGeo.getAttribute("position"),
      ids = liningGeo.index!;
    const pa = new T.Vector3(),
      pb = new T.Vector3(),
      pc = new T.Vector3();
    for (let i = 0; i < ids.count; i += 3) {
      pa.fromBufferAttribute(points, ids.getX(i));
      pb.fromBufferAttribute(points, ids.getX(i + 1));
      pc.fromBufferAttribute(points, ids.getX(i + 2));
      if (
        [pa, pb, pc].every((p) => Math.abs(p.z - sign * a.halfLength) < 1e-4) &&
        pb.sub(pa).cross(pc.sub(pa)).z * sign > 0
      ) {
        const b = ids.getX(i + 1);
        ids.setX(i + 1, ids.getX(i + 2));
        ids.setX(i + 2, b);
      }
    }
    liningGeo.computeVertexNormals();
    // Assign the actual rear wall faces their own backing material. No second
    // inset plane: render and collision agree even when a chassis reaches it.
    const frameFaces = new Set<string>();
    for (const part of goalFrame(sign))
      for (let i = 0; i < part.indices.length; i += 3)
        frameFaces.add(
          Array.from(part.indices.slice(i, i + 3))
            .sort((a, b) => a - b)
            .join(","),
        );
    const interiorIndices: number[] = [],
      rearIndices: number[] = [];
    for (let i = 0; i < ids.count; i += 3) {
      const tri = [ids.getX(i), ids.getX(i + 1), ids.getX(i + 2)];
      if (frameFaces.has([...tri].sort((a, b) => a - b).join(","))) continue;
      (tri.every(
        (v) =>
          Math.abs(points.getZ(v) - sign * (a.halfLength + a.goalDepth)) < 1e-5,
      )
        ? rearIndices
        : interiorIndices
      ).push(...tri);
    }
    const rearGeo = new T.BufferGeometry();
    rearGeo.setAttribute("position", points);
    rearGeo.setAttribute("normal", liningGeo.getAttribute("normal"));
    rearGeo.setIndex(rearIndices);
    liningGeo.setIndex(interiorIndices);
    const liningMesh = new T.Mesh(
      liningGeo,
      new T.MeshStandardMaterial({
        color: 0x456172,
        metalness: 0.3,
        roughness: 0.62,
        side: T.FrontSide,
      }),
    );
    liningMesh.receiveShadow = true;
    liningMesh.name = `goal-interior-${sign}`;
    liningMesh.userData.cameraCollision = "ARENA_BOUNDARY";
    linings.push(liningMesh.material);
    goal.add(liningMesh);
    for (const part of goalFrame(sign)) {
      const frameGeo = new T.BufferGeometry();
      frameGeo.setAttribute("position", points);
      frameGeo.setAttribute("normal", liningGeo.getAttribute("normal"));
      frameGeo.setIndex(new T.BufferAttribute(part.indices, 1));
      const post = new T.Mesh(frameGeo, trim);
      post.name = `goal-frame-${sign}-${part.kind}`;
      post.userData.cameraCollision = "ARENA_BOUNDARY";
      goal.add(post);
    }
    const rear = new T.Mesh(rearGeo, material(0x112a35));
    rear.name = `goal-rear-view-${sign}`;
    rear.userData.cameraCollision = "ARENA_BOUNDARY";
    rear.castShadow = rear.receiveShadow = true;
    goal.add(rear);
    const net = new T.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.23,
    });
    const marking = new T.LineBasicMaterial({ color });
    for (const material of [glow, net, marking])
      teamMaterials.push({ material, color });
    // Net lines occupy the actual flat rear/roof panels, offset into the cavity.
    // Curved shoulders stay clean instead of an oversized rectangular wire cage.
    const netWidth = a.goalHalf - a.goalCurve,
      rearTop = goalRoofHeight(a.goalDepth) - a.goalCurve,
      roofEnd = a.goalDepth - a.goalCurve;
    for (let x = -netWidth; x <= netWidth; x += 0.65) {
      line(
        [
          new T.Vector3(
            x,
            a.goalCurve,
            sign * (a.halfLength + a.goalDepth - 0.08),
          ),
          new T.Vector3(x, rearTop, sign * (a.halfLength + a.goalDepth - 0.08)),
        ],
        net,
      );
      line(
        [
          new T.Vector3(
            x,
            goalRoofHeight(a.goalLip) - 0.035,
            sign * (a.halfLength + a.goalLip),
          ),
          new T.Vector3(
            x,
            goalRoofHeight(roofEnd) - 0.035,
            sign * (a.halfLength + roofEnd),
          ),
        ],
        net,
      );
    }
    for (let y = a.goalCurve; y <= rearTop; y += 0.65)
      line(
        [
          new T.Vector3(
            -netWidth,
            y,
            sign * (a.halfLength + a.goalDepth - 0.08),
          ),
          new T.Vector3(
            netWidth,
            y,
            sign * (a.halfLength + a.goalDepth - 0.08),
          ),
        ],
        net,
      );
    for (let depth = a.goalLip; depth <= roofEnd; depth += 0.65)
      line(
        [
          new T.Vector3(
            -netWidth,
            goalRoofHeight(depth) - 0.035,
            sign * (a.halfLength + depth),
          ),
          new T.Vector3(
            netWidth,
            goalRoofHeight(depth) - 0.035,
            sign * (a.halfLength + depth),
          ),
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
  const citySeating = new T.Group();
  group.add(citySeating);
  const seats = material(0x1d3945);
  const viewOccluders: T.Mesh[] = [];
  for (const side of [-1, 1])
    for (let tier = 0; tier < 7; tier++) {
      const seat = box(
        citySeating,
        [3, 0.45, 112],
        [side * (44 + tier * 2.5), 3 + tier * 1.4, 0],
        seats,
      );
      seat.userData.cameraCollision = "FADE";
      viewOccluders.push(seat);
    }
  const beacon = new T.MeshBasicMaterial({ color: 0xb7e6ef });
  for (const side of [-1, 1])
    for (let z = -45; z <= 45; z += 15) {
      const pillar = box(
        group,
        [0.3, 20, 0.3],
        [side * 44, 10, z],
        material(0x304754),
      );
      pillar.name = `arena-exterior-pillar-${side}-${z}`;
      pillar.userData.cameraCollision = "FADE";
      viewOccluders.push(pillar);
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
  let selected: ArenaId | null = null;
  let environment: T.Group | null = null;
  let fieldArt: ReturnType<typeof createFieldArt> | null = null;
  const setMap = (id: ArenaId) => {
    if (!isArenaId(id) || id === selected) return;
    const theme = arenaThemes[id];
    if (environment) disposeEnvironment(environment);
    environment = id === "city" ? drawCity() : drawEnvironment(id);
    scene.add(environment);
    if (id !== initial || selected !== null) {
      floor.material.map?.dispose();
      floor.material.map = turfTexture(id);
    }
    selected = id;
    group.userData.arenaId = id;
    if (id === "circuit" && !fieldArt) {
      fieldArt = createFieldArt();
      group.add(fieldArt);
      geo.setAttribute(
        "color",
        new T.BufferAttribute(rampPaint(shell.vertices, theme.lowerWall), 3),
      );
    }
    if (fieldArt) fieldArt.visible = id === "circuit";
    if (wall.material[0].vertexColors !== (id === "circuit")) {
      wall.material[0].vertexColors = id === "circuit";
      wall.material[0].needsUpdate = true;
    }
    citySeating.visible = id === "city";
    stripe.color.setHex(theme.stripe);
    stripe.opacity = theme.stripeOpacity;
    lines.color.setHex(theme.marking);
    bandMaterial.color.setHex(id === "beach" ? 0x4e6975 : 0xa6eeeb);
    wall.material[0].color.setHex(
      id === "circuit" ? 0xffffff : theme.lowerWall,
    );
    wall.material[1].color.setHex(theme.upperWall);
    wall.material[1].opacity = theme.wallOpacity;
    linings.forEach((mat) => mat.color.setHex(theme.lining));
    beacon.color.setHex(theme.canopy);
    gridMat.color.setHex(theme.grid);
    applyArenaLighting(scene, theme);
  };
  setMap(initial);
  registerCameraVisualOcclusion(scene, viewOccluders);
  return {
    group,
    floor,
    wall,
    get mapId() {
      return selected!;
    },
    get environment() {
      return environment!;
    },
    setMap,
    setNeutral(neutral: boolean) {
      for (const entry of teamMaterials) {
        entry.material.color.setHex(neutral ? 0xa8a8a8 : entry.color);
        if (entry.material instanceof T.MeshStandardMaterial)
          entry.material.emissive.setHex(neutral ? 0xa8a8a8 : entry.color);
      }
    },
  };
}

/** Lumen District: original terraced towers, lit windows and elevated skybridges. */
function drawCity() {
  const city = new T.Group();
  city.name = "environment-city";
  const concrete = material(0x243343, 0.5, 0.7),
    trim = material(0x405469, 0.6, 0.4);
  const windowMat = polishMaterial(
    new T.MeshBasicMaterial({ color: 0xf2cb8b }),
    "light",
  );
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
  city.add(moon);
  return city;
}

export function drawArena(scene: T.Scene, initial: ArenaId = "city") {
  const soccer = drawSoccarArena(
      scene,
      ["hoops", "dropshot"].includes(initial) ? "city" : initial,
    ),
    group = new T.Group();
  scene.add(group);
  group.add(soccer.group);
  let dropshot: ReturnType<typeof drawDropshotArena> | null = null;
  let hoops: ReturnType<typeof drawHoopsArena> | null = null,
    selected: ArenaId | null = null,
    neutral = false;
  const setMap = (id: ArenaId) => {
    if (id === selected) return;
    selected = id;
    if (id === "hoops" && !hoops) {
      hoops = drawHoopsArena(scene);
      group.add(hoops.group);
      hoops.setNeutral(neutral);
      addCameraVisualOccluders(scene, hoops.occluders);
    }
    if (id === "dropshot" && !dropshot) {
      dropshot = drawDropshotArena(scene);
      group.add(dropshot.group);
    }
    if (dropshot) dropshot.group.visible = id === "dropshot";
    soccer.group.visible = id !== "hoops" && id !== "dropshot";
    if (hoops) hoops.group.visible = id === "hoops";
    if (id !== "hoops" && id !== "dropshot") soccer.setMap(id);
    applyArenaLighting(scene, arenaThemes[id]);
    soccer.environment.visible = id !== "hoops" && id !== "dropshot";
  };
  setMap(initial);
  return {
    ...soccer,
    group,
    get mapId() {
      return selected!;
    },
    get environment() {
      return soccer.environment;
    },
    setMap,
    updateDropshot(
      state: DropshotSnapshot | null | undefined,
      dt: number,
      onImpact?: (open: boolean) => void,
    ) {
      if (selected === "dropshot") dropshot?.update(state, dt, onImpact);
    },
    get dropshotTiles() {
      return dropshot?.tiles;
    },

    setNeutral(value: boolean) {
      neutral = value;
      soccer.setNeutral(value);
      hoops?.setNeutral(value);
    },
  };
}
