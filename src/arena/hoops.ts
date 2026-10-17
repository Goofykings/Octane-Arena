import { HOOPS_NET_GROUP } from "../physics/collision-groups";
import RAPIER from "@dimforge/rapier3d-compat";
import { HOOPS_CONFIG as H, hoopsRimPath } from "../../shared/hoops";
import type { ArenaMesh } from "./geometry";
let cached: ArenaMesh | undefined;
/** Welded closed convex cavity. One indexed perimeter/profile grid, continuous
 * floor/ramp/wall/ceiling normals; no separate overlapping emergency boundaries. */
export function hoopsShell(): ArenaMesh {
  if (cached) return cached;
  const vertices: number[] = [],
    indices: number[] = [],
    rings: { offset: number; y: number }[] = [];
  const n = 128,
    steps = 24,
    r = H.rampRadius;
  for (let j = 0; j <= steps; j++) {
    const a = ((j / steps) * Math.PI) / 2;
    rings.push({ offset: r * (1 - Math.sin(a)), y: r * (1 - Math.cos(a)) });
  }
  rings.push({ offset: 0, y: H.ceilingHeight - r });
  for (let j = 1; j <= steps; j++) {
    const a = ((j / steps) * Math.PI) / 2;
    rings.push({
      offset: r * (1 - Math.cos(a)),
      y: H.ceilingHeight - r + r * Math.sin(a),
    });
  }
  for (const ring of rings)
    for (let i = 0; i < n; i++) {
      const quadrant = Math.floor(i / 32),
        a = (((i % 32) / 32) * Math.PI) / 2 + (quadrant * Math.PI) / 2;
      const cx =
          (quadrant === 0 || quadrant === 3 ? 1 : -1) *
          (H.arenaWidth / 2 - H.cornerRadius),
        cz = (quadrant < 2 ? 1 : -1) * (H.arenaLength / 2 - H.cornerRadius);
      vertices.push(
        cx + (H.cornerRadius - ring.offset) * Math.cos(a),
        ring.y,
        cz + (H.cornerRadius - ring.offset) * Math.sin(a),
      );
    }
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < n; i++) {
      const a = j * n + i,
        b = j * n + ((i + 1) % n),
        c = (j + 1) * n + i,
        d = (j + 1) * n + ((i + 1) % n);
      indices.push(a, c, b, b, c, d);
    }
  const floor = vertices.length / 3;
  vertices.push(0, 0, 0);
  const ceiling = vertices.length / 3;
  vertices.push(0, H.ceilingHeight, 0);
  for (let i = 0; i < n; i++) {
    indices.push(floor, i, (i + 1) % n);
    const a = (rings.length - 1) * n;
    indices.push(ceiling, a + ((i + 1) % n), a + i);
  }
  // Choose inward orientation explicitly for raycasts and visual front faces.
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3),
      p = ids.map((k) => vertices.slice(k * 3, k * 3 + 3));
    const u = p[1].map((v, k) => v - p[0][k]),
      v = p[2].map((v, k) => v - p[0][k]);
    const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      center = p[0].map((v, k) => (v + p[1][k] + p[2][k]) / 3),
      inside = [-center[0], H.ceilingHeight / 2 - center[1], -center[2]];
    if (normal.reduce((sum, v, k) => sum + v * inside[k], 0) < 0)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  return (cached = {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    profileLength: rings.length,
  });
}
/** Ball-only net surface with a small 0.32 m outward curl at the foot.
 * Shared visual/collision vertices; this is a skirt, never a launch bank. */
export function hoopsNet(sign: number): ArenaMesh {
  const path = hoopsRimPath(sign),
    vertices: number[] = [],
    indices: number[] = [];
  const rows = [
    { y: 0.06, flare: H.netFlare },
    { y: 0.14, flare: H.netFlare * 0.65 },
    { y: 0.28, flare: H.netFlare * 0.18 },
    { y: H.netCurveHeight, flare: 0 },
    ...Array.from({ length: 9 }, (_, i) => ({
      y:
        H.netCurveHeight +
        ((H.hoopHeight - H.rimThickness / 2 - H.netCurveHeight) * (i + 1)) / 9,
      flare: 0,
    })),
  ];
  for (const row of rows)
    for (let i = 0; i < path.length; i++) {
      const p = path[i],
        side = i <= 1 || i >= path.length - 2;
      let nx = side ? Math.sign(p.x) : p.x / H.hoopRadius,
        nz = side ? 0 : (p.z - sign * H.hoopZ) / H.hoopRadius;
      vertices.push(p.x + nx * row.flare, row.y, p.z + nz * row.flare);
    }
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < path.length - 1; i++) {
      const a = j * path.length + i,
        b = a + 1,
        c = a + path.length;
      indices.push(a, b, c, b, c + 1, c);
    }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    profileLength: rows.length,
  };
}
export function createHoopsArena(world: RAPIER.World) {
  const add = (m: ArenaMesh, oriented = true) =>
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        m.vertices,
        m.indices,
        oriented
          ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES |
              RAPIER.TriMeshFlags.ORIENTED
          : 0,
      )
        .setFriction(0.3)
        .setRestitution(0),
    );
  const shell = add(hoopsShell()),
    colliders = [shell],
    rims: RAPIER.Collider[] = [];
  for (const sign of [-1, 1]) {
    // Open net is two-sided; ORIENTED is reserved for the closed arena shell.
    const net = add(hoopsNet(sign), false);
    net.setCollisionGroups(HOOPS_NET_GROUP);
    net.setRestitution(H.netRestitution);
    net.setFriction(0.12);
    colliders.push(net);
    const path = hoopsRimPath(sign);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i],
        b = path[i + 1],
        dx = b.x - a.x,
        dz = b.z - a.z,
        len = Math.hypot(dx, dz);
      // Rotate capsule Y to the horizontal rim segment.
      const ux = dx / len,
        uz = dz / len;
      const desc = RAPIER.ColliderDesc.capsule(len / 2, H.rimThickness / 2)
        .setTranslation((a.x + b.x) / 2, H.hoopHeight, (a.z + b.z) / 2)
        .setRotation({
          x: uz * Math.SQRT1_2,
          y: 0,
          z: -ux * Math.SQRT1_2,
          w: Math.SQRT1_2,
        })
        .setFriction(0.22)
        .setRestitution(H.rimRestitution);
      const c = world.createCollider(desc);
      c.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      colliders.push(c);
      rims.push(c);
    }
  }
  return { shell, colliders, rims };
}
