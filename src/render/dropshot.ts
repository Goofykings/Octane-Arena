import { DropshotDepth, FallingTiles } from "./dropshot-depth";
import { tileMaterial, extensionMaterial } from "./dropshot-material";
import { DropshotChargeFX } from "./dropshot-charge";
import * as T from "three";
import {
  DROPSHOT_CONFIG as D,
  dropshotTiles,
  tileRadius,
  hexVertices,
  DropshotView,
  type DropshotSnapshot,
} from "../../shared/dropshot";
import {
  dropshotShell,
  dropshotFloor,
  dropshotPerimeter,
} from "../arena/dropshot";
import type { ArenaMesh } from "../arena/geometry";
const geometry = (m: ArenaMesh) => {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(m.vertices, 3));
  g.setIndex(new T.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  return g;
};
export function drawDropshotArena(scene: T.Scene) {
  const group = new T.Group();
  group.name = "dropshot-reactor";
  scene.add(group);
  // The existing clipped filler carries an extension of the same hex lattice.
  // No extra floor physics or bespoke edge tile meshes are introduced.
  const floor = new T.Mesh(geometry(dropshotFloor()), extensionMaterial());
  floor.name = "dropshot-clipped-hex-extensions";
  floor.receiveShadow = true;
  group.add(floor);
  const shell = dropshotShell(),
    g = geometry(shell),
    lower: number[] = [],
    upper: number[] = [];
  for (let i = 0; i < shell.indices.length; i += 3) {
    const ids = Array.from(shell.indices.slice(i, i + 3));
    (ids.every((id) => shell.vertices[id * 3 + 1] < 3) ? lower : upper).push(
      ...ids,
    );
  }
  const low = g.clone();
  low.setIndex(lower);
  const high = g.clone();
  high.setIndex(upper);
  g.dispose();
  group.add(
    new T.Mesh(
      low,
      new T.MeshStandardMaterial({
        color: 0x344b61,
        metalness: 0.45,
        roughness: 0.6,
        side: T.DoubleSide,
      }),
    ),
    new T.Mesh(
      high,
      new T.MeshBasicMaterial({
        color: 0x7192b1,
        transparent: true,
        opacity: 0.1,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  const tileGeometry = new T.CylinderGeometry(
      tileRadius,
      tileRadius,
      D.tileThickness,
      6,
    ),
    tileMat = tileMaterial();
  const tiles = new T.InstancedMesh(tileGeometry, tileMat, 140);
  tiles.name = "dropshot-tiles";
  tiles.receiveShadow = true;
  tiles.instanceMatrix.setUsage(T.DynamicDrawUsage);
  group.add(tiles);
  const edgePositions = new Float32Array(140 * 6 * 2 * 3 * 2),
    edgeColors = new Float32Array(edgePositions.length);
  const edgeGeometry = new T.BufferGeometry();
  edgeGeometry.setAttribute(
    "position",
    new T.BufferAttribute(edgePositions, 3),
  );
  edgeGeometry.setAttribute("color", new T.BufferAttribute(edgeColors, 3));
  const edges = new T.LineSegments(
    edgeGeometry,
    new T.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    }),
  );
  edges.name = "dropshot-exposed-rims";
  edges.frustumCulled = false;
  group.add(edges);
  const cracksBuffer = new Float32Array(140 * 6 * 6),
    cracksGeometry = new T.BufferGeometry();
  cracksGeometry.setAttribute(
    "position",
    new T.BufferAttribute(cracksBuffer, 3),
  );
  const cracks = new T.LineSegments(
    cracksGeometry,
    new T.LineBasicMaterial({ color: 0xe2faff }),
  );
  cracks.name = "dropshot-damage-cracks";
  cracks.frustumCulled = false;
  group.add(cracks);
  const depth = new DropshotDepth(),
    falling = new FallingTiles(tileGeometry);
  group.add(depth.mesh, falling.mesh);
  // Single clipped outer border and single center divider; no blank metal strips.
  const perimeter = dropshotPerimeter(D.rampRadius);
  for (const y of [0.025, D.arenaHeight - 0.25]) {
    const path = perimeter.map((p) => new T.Vector3(p.x, y, p.y));
    const geo = new T.BufferGeometry().setFromPoints(path);
    geo.setAttribute(
      "color",
      new T.Float32BufferAttribute(
        perimeter.flatMap((p) =>
          new T.Color(
            Math.abs(p.y) < 2 ? 0xd7e7ed : p.y > 0 ? 0x429cd4 : 0xe39552,
          ).toArray(),
        ),
        3,
      ),
    );
    const border = new T.LineLoop(
      geo,
      new T.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
      }),
    );
    border.name =
      y < 1 ? "dropshot-outer-border" : "dropshot-ceiling-light-strip";
    group.add(border);
  }
  const middle = new T.Line(
    new T.BufferGeometry().setFromPoints([
      new T.Vector3(-D.arenaRadius + 4, 0.03, 0),
      new T.Vector3(D.arenaRadius - 4, 0.03, 0),
    ]),
    new T.LineBasicMaterial({
      color: 0xd4e0e6,
      transparent: true,
      opacity: 0.75,
    }),
  );
  middle.name = "dropshot-center-line";
  group.add(middle);
  const beamGeo = new T.BoxGeometry(0.65, 24, 0.65),
    beamMat = new T.MeshStandardMaterial({
      color: 0x182b40,
      metalness: 0.65,
      roughness: 0.45,
    }),
    lampGeo = new T.BoxGeometry(2.8, 0.38, 1.1);
  for (let i = 0; i < 18; i++) {
    const p = perimeter[i * 4],
      pole = new T.Mesh(beamGeo, beamMat),
      tint = Math.abs(p.y) < 2 ? 0xdae6ed : p.y > 0 ? 0x70c7ff : 0xffb16c;
    pole.position.set(p.x * 1.07, 11, p.y * 1.07);
    pole.name = "dropshot-light-pole";
    group.add(pole);
    const lamp = new T.Mesh(
      lampGeo,
      new T.MeshBasicMaterial({ color: tint, toneMapped: false }),
    );
    lamp.position.copy(pole.position).setY(20.7);
    lamp.lookAt(0, 15, 0);
    lamp.name = "dropshot-floodlight";
    group.add(lamp);
    const strip = new T.Mesh(
      new T.BoxGeometry(0.12, 15, 0.12),
      new T.MeshBasicMaterial({ color: tint }),
    );
    strip.position.copy(pole.position).setY(12);
    group.add(strip);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3,
      bar = new T.Mesh(new T.BoxGeometry(37, 0.18, 0.3), beamMat);
    bar.position.set(Math.cos(a) * 21, D.arenaHeight - 0.3, Math.sin(a) * 21);
    bar.rotation.y = -a + Math.PI / 2;
    group.add(bar);
    const strip = new T.Mesh(
      new T.BoxGeometry(34, 0.05, 0.07),
      new T.MeshBasicMaterial({
        color:
          Math.abs(bar.position.z) < 2
            ? 0x9baebd
            : bar.position.z > 0
              ? 0x497caa
              : 0xa27448,
      }),
    );
    strip.position.copy(bar.position).setY(D.arenaHeight - 0.42);
    strip.rotation.copy(bar.rotation);
    strip.name = "dropshot-ceiling-beam-light";
    group.add(strip);
  }
  for (const side of [-1, 1]) {
    const light = new T.PointLight(side > 0 ? 0x7ac7ff : 0xffbd82, 80, 65, 2);
    light.position.set(0, 16, side * 23);
    group.add(light);
  }
  const particles = new T.InstancedMesh(
    new T.OctahedronGeometry(0.13),
    new T.MeshBasicMaterial({
      color: 0xd2faff,
      transparent: true,
      opacity: 0.8,
    }),
    48,
  );
  particles.instanceMatrix.setUsage(T.DynamicDrawUsage);
  particles.frustumCulled = false;
  group.add(particles);
  const pulses = new Float32Array(140);
  const ages = new Float32Array(48).fill(10),
    origins = new Float32Array(48 * 3),
    dummy = new T.Object3D(),
    color = new T.Color(),
    flashColor = new T.Color(0xffffff);
  let slot = 0,
    view = new DropshotView(),
    signature = "",
    lastEvent = 0;
  const update = (
    state: DropshotSnapshot | null | undefined,
    dt: number,
    onImpact?: (open: boolean) => void,
  ) => {
    if (!state) return;
    if (
      state.epoch !== view.epoch ||
      (state.tiles && state.revision < view.revision)
    ) {
      view = new DropshotView();
      lastEvent = 0;
      falling.reset();
      ages.fill(10);
      pulses.fill(0);
    }
    const beforeTiles = view.tiles,
      wasInitialized = signature !== "" && state.epoch === view.epoch;
    view.apply(state);
    const key = view.epoch + ":" + view.revision;
    if (key !== signature) {
      signature = key;
      if (wasInitialized)
        for (let i = 0; i < 140; i++)
          if (beforeTiles[i] !== "2" && view.tiles[i] === "2") falling.start(i);
      for (const t of dropshotTiles) {
        const status = Number(view.tiles[t.id]);
        dummy.position.set(t.x, -D.tileThickness / 2, t.z);
        dummy.scale.setScalar(status === 2 ? 0 : 1);
        dummy.updateMatrix();
        tiles.setMatrixAt(t.id, dummy.matrix);
        color.setHex(
          status === 1
            ? t.team === 0
              ? 0x46baff
              : 0xffab4f
            : t.team === 0
              ? 0x071422
              : 0x21130a,
        );
        tiles.setColorAt(t.id, color);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3,
            offset = (t.id * 6 + i) * 6;
          cracksBuffer.set(
            status === 1
              ? [
                  t.x,
                  0.025,
                  t.z,
                  t.x + Math.sin(a) * tileRadius * 0.8,
                  0.025,
                  t.z + Math.cos(a) * tileRadius * 0.8,
                ]
              : [0, 0, 0, 0, 0, 0],
            offset,
          );
        }
      }
      let edgeCount = 0;
      for (const t of dropshotTiles)
        if (Number(view.tiles[t.id]) !== 2) {
          const vs = hexVertices(t.x, t.z),
            tint = new T.Color(t.team === 0 ? 0x55c7ff : 0xffac51);
          for (let i = 0; i < 6; i++) {
            const a = vs[i],
              b = vs[(i + 1) % 6],
              mx = (a.x + b.x) / 2,
              mz = (a.z + b.z) / 2;
            const hole = t.neighbors.some(
              (j) =>
                Number(view.tiles[j]) === 2 &&
                Math.hypot(
                  (t.x + dropshotTiles[j].x) / 2 - mx,
                  (t.z + dropshotTiles[j].z) / 2 - mz,
                ) < 0.05,
            );
            if (!hole) continue;
            for (const y of [0.018, -D.tileThickness + 0.02])
              for (const p of [a, b]) {
                edgePositions.set([p.x, y, p.z], edgeCount * 3);
                edgeColors.set(tint.toArray(), edgeCount * 3);
                edgeCount++;
              }
          }
        }
      edgeGeometry.setDrawRange(0, edgeCount);
      edgeGeometry.attributes.position.needsUpdate = true;
      edgeGeometry.attributes.color.needsUpdate = true;
      depth.update(view.tiles);
      tiles.instanceMatrix.needsUpdate = true;
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
      cracksGeometry.attributes.position.needsUpdate = true;
    }
    falling.update(dt);
    for (const e of state.events)
      if (e.id > lastEvent) {
        lastEvent = e.id;
        for (const [id, status] of e.changes)
          if (status === 1) pulses[id] = 0.3;
        const t = dropshotTiles[e.tileId];
        onImpact?.(e.changes.some((c) => c[1] === 2));
        for (let n = 0; n < Math.min(24, e.changes.length * 4); n++) {
          const i = slot++ % 48;
          ages[i] = 0;
          origins.set([t.x, 0.1, t.z], i * 3);
        }
      }
    let pulsing = false;
    for (let i = 0; i < 140; i++)
      if (pulses[i] > 0) {
        pulsing = true;
        pulses[i] = Math.max(0, pulses[i] - dt);
        color
          .setHex(dropshotTiles[i].team === 0 ? 0x46baff : 0xffab4f)
          .lerpColors(color, flashColor, pulses[i] / 0.3);
        tiles.setColorAt(i, color);
      }
    if (pulsing && tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    for (let i = 0; i < 48; i++) {
      ages[i] += dt;
      const age = ages[i],
        a = i * 2.399;
      dummy.position.set(
        origins[i * 3] + Math.cos(a) * age * 6,
        origins[i * 3 + 1] + age * 4 - age * age * 8,
        origins[i * 3 + 2] + Math.sin(a) * age * 6,
      );
      dummy.scale.setScalar(Math.max(0, 1 - age / 0.65));
      dummy.updateMatrix();
      particles.setMatrixAt(i, dummy.matrix);
    }
    particles.instanceMatrix.needsUpdate = true;
  };
  update(
    {
      epoch: 0,
      revision: 0,
      energy: 0,
      chargeLevel: 0,
      lastTouchTeam: null,
      lastTouchPlayerId: null,
      recentAbsorbedForce: 0,
      tiles: "0".repeat(140),
      events: [],
    },
    0,
  );
  return {
    group,
    update,
    get tiles() {
      return view.tiles;
    },
    setNeutral(_value: boolean) {
      /* Ownership remains readable in Dropshot Free Play. */
    },
  };
}
/** Reused original reactor shell and electrical orbit arcs, separate from Soccar skin. */
export function dropshotBall(
  ball: T.Group,
  state: DropshotSnapshot | null | undefined,
  time: number,
) {
  let skin = ball.getObjectByName("dropshot-ball") as T.Group | undefined;
  if (!state) {
    (ball.userData.dropshotFX as DropshotChargeFX | undefined)?.reset();
    if (ball.userData.dropshot) {
      for (const child of ball.children)
        child.visible =
          child === skin || child.name === "dropshot-charge-fx"
            ? false
            : child.name === "hoops-basketball"
              ? !!ball.userData.hoops
              : !ball.userData.hoops;
      ball.userData.dropshot = false;
    }
    return;
  }
  if (!skin) {
    skin = new T.Group();
    skin.name = "dropshot-ball";
    skin.add(
      new T.Mesh(
        new T.IcosahedronGeometry(0.96, 1),
        new T.MeshStandardMaterial({
          color: 0x17223d,
          metalness: 0.8,
          roughness: 0.3,
          emissive: 0x30446a,
          emissiveIntensity: 0.3,
        }),
      ),
    );
    const core = new T.Mesh(
      new T.IcosahedronGeometry(0.98, 1),
      new T.MeshBasicMaterial({ color: 0x8cbed4, wireframe: true }),
    );
    core.name = "charge-core";
    skin.add(core);
    for (let i = 0; i < 5; i++) {
      const arc = new T.Mesh(
        new T.TorusGeometry(1.02 + i * 0.018, 0.012, 3, 32, Math.PI * 1.5),
        new T.MeshBasicMaterial({
          color: 0x8cbed4,
          transparent: true,
          opacity: 0.3,
        }),
      );
      arc.rotation.set(i * 0.8, i * 0.5, i);
      skin.add(arc);
    }
    ball.add(skin);
  }
  for (const child of ball.children)
    child.visible = child === skin || child.name === "dropshot-charge-fx";
  ball.userData.dropshot = true;
  const level = state.chargeLevel,
    color =
      state.lastTouchTeam === 0
        ? 0x4dc9ff
        : state.lastTouchTeam === 1
          ? 0xffa13b
          : 0x94b5cb;
  const fx = (ball.userData.dropshotFX ??=
    new DropshotChargeFX()) as DropshotChargeFX;
  fx.update(ball, level, state.epoch, color, time);
  skin.children.forEach((child, i) => {
    if (!(child instanceof T.Mesh)) return;
    const mat = child.material as T.MeshBasicMaterial;
    if (i > 0) {
      mat.color.setHex(color);
      if (i > 1) {
        mat.opacity = level === 0 ? 0.22 : level === 1 ? 0.65 : 0.96;
        child.rotation.z = time * (level === 2 ? 5 : 0.7 * (level + 1)) + i;
        child.scale.setScalar(
          1 + (level === 2 ? 0.18 : 0) * Math.sin(time * 18 + i),
        );
      }
    } else {
      const m = child.material as T.MeshStandardMaterial;
      m.emissive.setHex(color);
      m.emissiveIntensity =
        level === 2
          ? 3.5 + Math.sin(time * 28) * 0.7
          : level === 1
            ? 0.7
            : 0.12;
    }
  });
}
export function replayDropshot(
  clip: { dropshot?: { time: number; state: DropshotSnapshot }[] },
  time: number,
) {
  let result: DropshotSnapshot | undefined;
  for (const e of clip.dropshot ?? []) if (e.time <= time) result = e.state;
  return result;
}
