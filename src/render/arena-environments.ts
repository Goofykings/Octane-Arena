import * as T from "three";
import { box, material } from "./models";
import type { ArenaId } from "./arena-themes";

/** Decorative meshes only, always outside the shared playable shell. */
export function drawEnvironment(id: Exclude<ArenaId, "city">) {
  const group = new T.Group();
  group.name = `environment-${id}`;
  if (id === "beach") drawBeach(group);
  else drawStadium(group);
  group.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.castShadow = false;
      o.receiveShadow = true;
    }
  });
  return group;
}

export function disposeEnvironment(group: T.Group) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  group.traverse((o) => {
    if (!(o instanceof T.Mesh || o instanceof T.Line)) return;
    geometries.add(o.geometry);
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
      materials.add(m),
    );
    if (o instanceof T.InstancedMesh) o.dispose();
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  group.removeFromParent();
}

function drawBeach(g: T.Group) {
  const sand = material(0xc8b080, 0, 0.95),
    wood = material(0x876e52, 0, 0.9),
    white = material(0xe8dfc7, 0, 0.8),
    ocean = material(0x298b9f, 0.1, 0.48);
  const shore = new T.Mesh(new T.PlaneGeometry(500, 500), sand);
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = -0.15;
  g.add(shore);
  // The ocean is to the east, beyond the shore and boardwalk.
  const sea = new T.Mesh(new T.PlaneGeometry(185, 470), ocean);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(191, -0.11, 0);
  sea.name = "coastal-ocean";
  g.add(sea);
  const duneGeometry = new T.SphereGeometry(1, 12, 8);
  for (let i = 0; i < 7; i++) {
    const dune = new T.Mesh(duneGeometry, sand);
    dune.position.set(-150 + i * 35, -3, -133 - (i % 2) * 14);
    dune.scale.set(30, 12 + (i % 3) * 3, 25);
    g.add(dune);
  }
  const cloudGeometry = new T.SphereGeometry(1, 10, 6),
    cloudMaterial = new T.MeshBasicMaterial({ color: 0xe4eff0 });
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 3; j++) {
      const cloud = new T.Mesh(cloudGeometry, cloudMaterial);
      cloud.position.set(
        -160 + i * 65 + j * 5,
        57 + (i % 3) * 12 + (j % 2) * 2,
        -160 + (i % 2) * 38,
      );
      cloud.scale.set(9, 2.5 + (j % 2), 4);
      g.add(cloud);
    }
  const waves = new T.BufferGeometry(),
    wavePoints: number[] = [];
  for (let x = 103; x < 270; x += 8)
    for (let z = -180; z < 180; z += 2) {
      const sx = x + Math.sin(z * 0.12 + x) * 0.65;
      wavePoints.push(
        sx,
        -0.09,
        z,
        x + Math.sin((z + 2) * 0.12 + x) * 0.65,
        -0.09,
        z + 2,
      );
    }
  waves.setAttribute("position", new T.Float32BufferAttribute(wavePoints, 3));
  g.add(
    new T.LineSegments(
      waves,
      new T.LineBasicMaterial({
        color: 0xbcdfd4,
        transparent: true,
        opacity: 0.32,
      }),
    ),
  );
  box(g, [10, 0.6, 166], [77, 0.5, 0], wood).name = "coastal-boardwalk";
  for (let z = -80; z <= 80; z += 4) {
    box(g, [10.2, 0.05, 0.08], [77, 0.83, z], white);
    if (z % 8 === 0) {
      box(g, [0.2, 2.1, 0.2], [82, 1.55, z], wood);
      box(g, [0.14, 0.12, 8], [82, 2.45, z + 4], white);
    }
  }
  // Low beach pavilions and alternating canopy colors.
  for (const side of [-1, 1])
    for (const z of [-66, 0, 66]) {
      const x = side * 70,
        paint = material(z === 0 ? 0x398d9b : 0xc27856);
      box(g, [10, 5, 8], [x, 2.5, z], white);
      const roof = new T.Mesh(new T.ConeGeometry(8, 2.5, 4), paint);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(x, 6.1, z);
      g.add(roof);
      for (const dx of [-3, 0, 3])
        box(g, [1.8, 2, 0.1], [x + dx, 2.8, z - 4.06], paint);
    }
  const trunkGeo = new T.CylinderGeometry(0.24, 0.5, 1, 7),
    trunkMat = material(0x947350),
    leafGeo = new T.ConeGeometry(0.8, 7, 4),
    leafMat = material(0x397853, 0, 0.85),
    trunks = new T.InstancedMesh(trunkGeo, trunkMat, 20),
    leaves = new T.InstancedMesh(leafGeo, leafMat, 120),
    dummy = new T.Object3D();
  trunks.name = "palm-trunks";
  leaves.name = "palm-fronds";
  for (let i = 0; i < 20; i++) {
    const side = i % 2 ? 1 : -1,
      x = side * (57 + (i % 3) * 5),
      z = -79 + Math.floor(i / 2) * 17.5,
      h = 12 + (i % 4) * 1.2;
    dummy.position.set(x, h / 2, z);
    dummy.rotation.set(0, 0, side * 0.06);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    for (let j = 0; j < 6; j++) {
      const a = (j * Math.PI) / 3 + i;
      dummy.position.set(x + Math.cos(a) * 2.1, h - 0.4, z + Math.sin(a) * 2.1);
      dummy.quaternion.setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        new T.Vector3(Math.cos(a), -0.22, Math.sin(a)).normalize(),
      );
      dummy.scale.set(0.7, 1, 0.32);
      dummy.updateMatrix();
      leaves.setMatrixAt(i * 6 + j, dummy.matrix);
    }
  }
  g.add(trunks, leaves);
  const poleMat = material(0xe5d5b1),
    canopyGeo = new T.ConeGeometry(2.8, 1.3, 10),
    canopyColors = [0xe48a5a, 0x4f9eb0, 0xe0c475];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1,
      x = side * (85 + (i % 3) * 4),
      z = -64 + Math.floor(i / 2) * 21;
    box(g, [0.12, 3.8, 0.12], [x, 1.9, z], poleMat);
    const canopy = new T.Mesh(canopyGeo, material(canopyColors[i % 3], 0, 0.9));
    canopy.position.set(x, 4, z);
    g.add(canopy);
    box(g, [2.5, 0.18, 1], [x, 0.5, z], white);
  }
  const sun = new T.Mesh(
    new T.SphereGeometry(5, 16, 12),
    new T.MeshBasicMaterial({ color: 0xffedbd }),
  );
  sun.position.set(-100, 100, -170);
  g.add(sun);
}

function drawStadium(g: T.Group) {
  const concrete = material(0x73868e),
    blue = material(0x264c68),
    orange = material(0x88553b),
    trim = material(0xb0bcc1),
    roofMat = material(0x294657, 0.2, 0.75);
  const plaza = new T.Mesh(new T.PlaneGeometry(260, 290), material(0x354651));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = -0.12;
  g.add(plaza);
  const crowd = new T.InstancedMesh(
    new T.SphereGeometry(0.36, 7, 6),
    material(0xffffff, 0, 0.9),
    2200,
  );
  crowd.name = "egg-crowd";
  const dummy = new T.Object3D(),
    color = new T.Color();
  const crowdColors = [0xe1dec4, 0x8db9c1, 0xd9b480, 0xc6b5cc, 0x9fbf9a];
  let count = 0;
  for (const side of [-1, 1])
    for (let row = 0; row < 9; row++) {
      const height = 2.2 + row * 1.6,
        x = side * (46 + row * 2.2),
        z = side * (61 + row * 2.2);
      box(g, [2.2, 1.5, 116], [x, height, 0], concrete);
      box(g, [1.9, 0.22, 116], [x, height + 0.8, 0], side < 0 ? blue : orange);
      box(g, [84, 1.5, 2.2], [0, height, z], concrete);
      box(g, [84, 0.22, 1.9], [0, height + 0.8, z], side < 0 ? orange : blue);
      for (let p = -54; p <= 54; p += 2) {
        dummy.position.set(x, height + 1.28, p + (row % 2) * 0.6);
        dummy.rotation.set(0, 0, ((count % 5) - 2) * 0.08);
        dummy.scale.set(1, 1.45, 1);
        dummy.updateMatrix();
        crowd.setMatrixAt(count, dummy.matrix);
        crowd.setColorAt(count, color.setHex(crowdColors[count % 5]));
        count++;
      }
      for (let p = -40; p <= 40; p += 2) {
        dummy.position.set(p + (row % 2) * 0.6, height + 1.28, z);
        dummy.updateMatrix();
        crowd.setMatrixAt(count, dummy.matrix);
        crowd.setColorAt(count, color.setHex(crowdColors[count % 5]));
        count++;
      }
    }
  crowd.count = count;
  crowd.instanceMatrix.needsUpdate = true;
  g.add(crowd);
  for (const side of [-1, 1]) {
    box(g, [7, 0.7, 130], [side * 60, 19.5, 0], roofMat);
    box(g, [96, 0.7, 7], [0, 19.5, side * 76], roofMat);
    for (let z = -60; z <= 60; z += 15) {
      box(g, [0.4, 20, 0.4], [side * 65, 10, z], trim);
      box(g, [7, 0.14, 0.16], [side * 60, 18.8, z], trim);
    }
    for (const z of [-69, 69]) {
      box(g, [10, 4.8, 0.5], [side * 31, 17, z], roofMat);
      box(
        g,
        [8.8, 3.8, 0.08],
        [side * 31, 17, z - Math.sign(z) * 0.3],
        new T.MeshBasicMaterial({ color: side < 0 ? 0x6698aa : 0xbd9663 }),
      );
    }
  }
}
