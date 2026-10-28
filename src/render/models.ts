import * as T from "three";
import { P } from "../config/physics";
import { bodies, type BodyId } from "../game/inventory";
import { wheelMount, wheelMountY, wheelRadius } from "../car/wheels";
import type { Car } from "../car/car";
import { animateSuspension } from "./vehicle-suspension";
import { bodyStyles } from "./body-styles";
import { addWheelDesign } from "./wheel-model";
import { createTopper } from "./toppers";
import { polishMaterial } from "./material-polish";
import { createVectorBody, vectorArt } from "./vector-model";
import { arenaCarAsset, arenaCarShell, arenaCarWheel } from "./arena-car-model";
export const material = (color: number, metalness = 0.1, roughness = 0.65) =>
  new T.MeshStandardMaterial({ color, metalness, roughness });
export function box(
  parent: T.Object3D,
  size: number[],
  position: number[],
  mat: T.Material,
) {
  const m = new T.Mesh(
    new T.BoxGeometry(...(size as [number, number, number])),
    mat,
  );
  m.position.set(...(position as [number, number, number]));
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function carModel(
  color: number,
  bodyId: BodyId = "vector",
  wheels = "apex",
  topper = "none",
) {
  const g = new T.Group(),
    d = bodies[bodyId],
    art = bodyStyles[bodyId];
  const W = d.halfWidth * 2,
    L = d.halfLength * 2;
  let roof: number = art.roof,
    roofZ =
      bodyId === "vector"
        ? vectorArt.roofZ
        : (L * (art.roofBack + art.roofFront)) / 2,
    exhaust = new T.Vector3(0, -0.025, L / 2 + 0.045);
  let vectorMaterials: Parameters<typeof addWheelDesign>[4];
  // GLB bodies use their exported shell when it loaded; otherwise the procedural shells below.
  const arena = arenaCarAsset(bodyId);
  if (arena) {
    g.add(arenaCarShell(arena, color));
    roof = arena.roofY;
    roofZ = arena.roofZ;
    exhaust = arena.exhaust.clone();
  } else if (bodyId === "vector") {
    const near = createVectorBody(color);
    vectorMaterials = near.userData.materials;
    const far = createVectorBody(color, true, near.userData.materials);
    far.name = "body-shell-far";
    far.visible = false;
    const lod = new T.LOD();
    lod.name = "vector-body-lod";
    lod.addLevel(near, 0);
    lod.addLevel(far, 12, 0.12);
    g.add(lod);
  } else {
    const paint = material(color, 0.4, 0.42),
      dark = material(0x101c25, 0.25, 0.48),
      glass = material(0x345f73, 0.45, 0.24);
    [paint, dark, glass].forEach((mat) => polishMaterial(mat, "car"));
    const shell = new T.Group();
    shell.name = "body-shell";
    g.add(shell);
    shell.add(
      profileMesh(
        W - 0.04,
        [
          [-L / 2 + 0.02, -0.125],
          [-L / 2 + 0.02, art.nose],
          [-L * 0.34, art.hood],
          [L * 0.35, art.rear],
          [L / 2 - 0.02, art.rear - 0.03],
          [L / 2 - 0.02, -0.125],
        ],
        paint,
      ),
    );
    shell.add(
      profileMesh(
        W * art.roofWidth,
        [
          [L * art.cabinFront, art.hood],
          [L * art.roofFront, roof - 0.025],
          [L * art.roofBack, roof - 0.025],
          [L * art.cabinBack, art.rear],
        ],
        glass,
      ),
    );
    const roofLength = L * (art.roofBack - art.roofFront);
    box(
      shell,
      [W * art.roofWidth + 0.025, 0.025, roofLength],
      [0, roof - 0.0125, roofZ],
      paint,
    );
    // Hood scoop on every procedural fallback shell.
    box(
      shell,
      [W * 0.36, 0.025, L * 0.21],
      [0, art.hood + 0.012, -L * 0.31],
      dark,
    );
    if (art.spoiler) {
      for (const side of [-1, 1])
        box(
          shell,
          [0.025, 0.06, 0.035],
          [side * W * 0.3, art.rear + 0.025, L * art.spoiler],
          dark,
        );
      box(
        shell,
        [W * 0.92, 0.025, 0.1],
        [0, art.rear + 0.065, L * art.spoiler],
        paint,
      );
    }
    for (const sign of [-1, 1]) {
      box(
        shell,
        [W * 0.22, 0.035, 0.025],
        [sign * W * 0.3, art.nose - 0.01, -L / 2],
        new T.MeshBasicMaterial({ color: 0xd4f8ff }),
      );
      box(
        shell,
        [W * 0.2, 0.03, 0.025],
        [sign * W * 0.3, art.rear - 0.055, L / 2],
        new T.MeshBasicMaterial({ color: 0xff4335 }),
      );
      box(
        shell,
        [0.035, 0.035, L * 0.66],
        [sign * (W / 2 - 0.01), -0.09, 0],
        dark,
      );
      box(
        shell,
        [0.1, 0.065, 0.06],
        [sign * 0.21, -0.025, L / 2 + 0.015],
        dark,
      );
    }
  }
  const accessory = createTopper(topper);
  accessory.position.set(0, roof + 0.008, roofZ);
  g.add(accessory);
  g.userData.topper = accessory;
  g.userData.roofY = roof;
  g.userData.exhaust = exhaust;
  const visualChassis = new T.Group();
  visualChassis.name = "visual-chassis";
  visualChassis.add(...g.children);
  g.add(visualChassis);
  g.userData.visualChassis = visualChassis;
  const spins: T.Group[] = [],
    mounts: T.Group[] = [],
    steering: T.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new T.Group(),
      spin = new T.Group();
    pivot.position.copy(wheelMount(bodyId, i));
    pivot.position.y = wheelMountY;
    mounts.push(pivot);
    pivot.add(spin);
    g.add(pivot);
    if (arena) {
      // Visual wheel sits in the GLB's arch; the pivot keeps steering about the wheel's
      // own centre and the suspension still drives its height. The physics wheel
      // (mount, radius, rays) is unchanged; only the drawn tire's contact patch is matched.
      pivot.position.x = arena.wheelCenters[i].x;
      pivot.position.z = arena.wheelCenters[i].z;
      spin.position.y = arena.wheelRadius - wheelRadius;
      spin.userData.visualRadius = arena.wheelRadius;
      if (wheels === "apex") spin.add(arenaCarWheel(arena, i));
      else {
        addWheelDesign(spin, wheels, i % 2 ? 1 : -1);
        spin.scale.setScalar(arena.wheelRadius / wheelRadius);
      }
    } else if (bodyId === "vector" && i > 0) {
      // Identical tires/rims share GPU buffers and materials within this car.
      for (const part of spins[0].children) spin.add(part.clone());
      spin.userData.designId = spins[0].userData.designId;
      spin.getObjectByName("wheel-rim")!.rotation.y =
        ((i % 2 ? 1 : -1) * Math.PI) / 2;
    } else
      addWheelDesign(
        spin,
        wheels,
        i % 2 ? 1 : -1,
        bodyId === "vector",
        vectorMaterials,
      );
    if (bodyId === "vector" && !arena) {
      spin.scale.setScalar(vectorArt.wheelScale);
      // Keep the contact patch at the original height with smaller visual tires.
      // The steering pivot and physical wheel envelope remain unchanged.
      spin.position.y = -0.18 * (1 - vectorArt.wheelScale);
      spin.position.x = (i % 2 ? -1 : 1) * vectorArt.wheelInset;
    }
    spins.push(spin);
    if (i < 2) steering.push(pivot);
  }
  g.userData.wheels = spins;
  g.userData.frontWheels = steering;
  g.userData.wheelMounts = mounts;
  g.userData.bodyId = bodyId;
  return g;
}
/** Original faceted side profile, extruded across the car; no imported models. */
function profileMesh(
  width: number,
  profile: [number, number][],
  mat: T.Material,
) {
  const shape = new T.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (const [z, y] of profile.slice(1)) shape.lineTo(z, y);
  shape.closePath();
  const geo = new T.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    steps: 1,
  });
  // Extrusion initially uses XY silhouette and Z width; map it into world YZ.
  const positions = geo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getX(i),
      y = positions.getY(i),
      x = width / 2 - positions.getZ(i);
    positions.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const mesh = new T.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
export function animateWheels(
  model: T.Group,
  speed: number,
  steer: number,
  dt: number,
  car?: Car,
  pose?: T.Object3D,
  recorded?: { angle: number; steer: number },
) {
  if (recorded) {
    for (const wheel of model.userData.wheels as T.Group[])
      wheel.rotation.x = recorded.angle;
    for (const pivot of model.userData.frontWheels as T.Group[])
      pivot.rotation.y = recorded.steer;
    if (car && pose) animateSuspension(model, car, pose, dt);
    return;
  }
  const spin = (model.userData.wheelSpin ??= {
    speed: 0,
    contactSpeed: 0,
    airborneTime: 0,
  });
  if (dt > 0) {
    if (!car || (car.grounded && car.wheelContact.some(Boolean))) {
      spin.speed = spin.contactSpeed = speed;
      spin.airborneTime = 0;
    } else {
      spin.airborneTime = Math.min(
        P.car.wheelSpinCoastTime,
        spin.airborneTime + dt,
      );
      spin.speed =
        spin.contactSpeed *
        Math.max(0, 1 - spin.airborneTime / P.car.wheelSpinCoastTime);
    }
  }
  for (const wheel of model.userData.wheels as T.Group[])
    wheel.rotation.x -=
      (spin.speed * dt) / ((wheel.userData.visualRadius as number) ?? 0.18);
  for (const pivot of model.userData.frontWheels as T.Group[])
    pivot.rotation.y = T.MathUtils.lerp(
      pivot.rotation.y,
      steer,
      1 - Math.exp(-dt * 20),
    );
  if (car && pose) animateSuspension(model, car, pose, dt);
}
export function disposeModel(model: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  model.traverse((o) => {
    if (o instanceof T.Mesh || o instanceof T.Points) {
      // Loaded-asset buffers are shared by every car instance; never free them per car.
      if (!o.geometry.userData.shared) geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (!m.userData.shared) materials.add(m);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
export function ballModel() {
  const g = new T.Group(),
    r = P.ball.radius;
  const core = new T.Mesh(
    new T.SphereGeometry(r - 0.009, 40, 28),
    material(0x172d38, 0.35, 0.6),
  );
  core.castShadow = true;
  g.add(core);
  const source = new T.IcosahedronGeometry(1, 1).getAttribute("position");
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    lamps: T.Mesh[] = [];
  const write = (v: T.Vector3, color: T.Color) => {
    v.normalize();
    normals.push(v.x, v.y, v.z);
    positions.push(v.x * r, v.y * r, v.z * r);
    colors.push(color.r, color.g, color.b);
  };
  for (let face = 0; face < source.count / 3; face++) {
    const corners = [0, 1, 2].map((k) =>
      new T.Vector3().fromBufferAttribute(source, face * 3 + k),
    );
    const center = corners[0]
      .clone()
      .add(corners[1])
      .add(corners[2])
      .multiplyScalar(1 / 3);
    const [a, b, c] = corners.map((v) => v.lerp(center, 0.065));
    const point = (i: number, j: number) =>
      a
        .clone()
        .multiplyScalar(1 - (i + j) / 6)
        .addScaledVector(b, i / 6)
        .addScaledVector(c, j / 6);
    const color = new T.Color(
      face % 9 === 0 ? 0x385561 : face % 3 === 0 ? 0xc4d3d6 : 0xf0f3e9,
    );
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6 - i; j++) {
        const triangle = [point(i, j), point(i + 1, j), point(i, j + 1)];
        if (face % 9 === 0 && i === 2 && j === 2) {
          const geo = new T.BufferGeometry().setFromPoints(
            triangle.map((v) => v.normalize().multiplyScalar(r)),
          );
          geo.setIndex([0, 1, 2]);
          const lamp = new T.Mesh(
            geo,
            new T.MeshBasicMaterial({ color: 0x9df8ea, side: T.DoubleSide }),
          );
          g.add(lamp);
          lamps.push(lamp);
        } else for (const v of triangle) write(v, color);
        if (i + j < 5)
          for (const v of [
            point(i + 1, j),
            point(i + 1, j + 1),
            point(i, j + 1),
          ])
            write(v, color);
      }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  const panels = new T.Mesh(
    geo,
    new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
      metalness: 0.2,
    }),
  );
  panels.castShadow = true;
  polishMaterial(panels.material, "ball");
  g.add(panels);
  g.userData.lamps = lamps;
  g.userData.radius = r;
  g.userData.panelMaterial = panels.material;
  g.userData.coreMaterial = core.material;
  g.userData.panelGeometry = geo;
  return g;
}
export function animateBall(ball: T.Group, time: number) {
  (
    ball.userData.lamps as T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>[]
  ).forEach((lamp, i) =>
    lamp.material.color
      .setRGB(0.35, 0.85, 0.72)
      .multiplyScalar(0.65 + 0.35 * Math.sin(time * 1.5 + i * 1.7) ** 2),
  );
}
