import {
  DROPSHOT_SUPPORT_GROUP,
  DROPSHOT_TILE_GROUP,
} from "../physics/collision-groups";
import RAPIER from "@dimforge/rapier3d-compat";
import { ShapeUtils, Vector2 } from "three";
import {
  DROPSHOT_CONFIG as D,
  hexVertices,
  dropshotTiles,
} from "../../shared/dropshot";
import type { ArenaMesh } from "./geometry";
/** Rounded regular-hex perimeter, used by both collision and rendering. */
export function dropshotPerimeter(inset = 0) {
  const radius = D.arenaRadius - inset / Math.cos(Math.PI / 6),
    vs = Array.from(
      { length: 6 },
      (_, i) =>
        new Vector2(
          Math.cos((i * Math.PI) / 3) * radius,
          Math.sin((i * Math.PI) / 3) * radius,
        ),
    );
  const points: Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const v = vs[i],
      a = v.clone().lerp(vs[(i + 5) % 6], D.cornerRadius / radius),
      b = v.clone().lerp(vs[(i + 1) % 6], D.cornerRadius / radius);
    for (let j = 0; j < 12; j++) {
      const t = j / 11;
      points.push(
        a
          .clone()
          .multiplyScalar((1 - t) ** 2)
          .addScaledVector(v, 2 * t * (1 - t))
          .addScaledVector(b, t * t),
      );
    }
  }
  return points;
}
export function dropshotShell(): ArenaMesh {
  const vertices: number[] = [],
    indices: number[] = [],
    rings: { inset: number; y: number }[] = [],
    r = D.rampRadius;
  for (let j = 0; j <= 24; j++) {
    const a = (j * Math.PI) / 48;
    rings.push({ inset: r * (1 - Math.sin(a)), y: r * (1 - Math.cos(a)) });
  }
  rings.push({ inset: 0, y: D.arenaHeight - r });
  for (let j = 1; j <= 24; j++) {
    const a = (j * Math.PI) / 48;
    rings.push({
      inset: r * (1 - Math.cos(a)),
      y: D.arenaHeight - r + r * Math.sin(a),
    });
  }
  const n = dropshotPerimeter().length;
  for (const ring of rings)
    for (const p of dropshotPerimeter(ring.inset))
      vertices.push(p.x, ring.y, p.y);
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < n; i++) {
      const a = j * n + i,
        b = j * n + ((i + 1) % n),
        c = a + n,
        d = b + n;
      indices.push(a, c, b, b, c, d);
    }
  const center = vertices.length / 3;
  vertices.push(0, D.arenaHeight, 0);
  for (let i = 0; i < n; i++) {
    const a = (rings.length - 1) * n;
    indices.push(center, a + i, a + ((i + 1) % n));
  }
  // Orient every face toward the cavity for wheel/chassis queries.
  for (let k = 0; k < indices.length; k += 3) {
    const ids = indices.slice(k, k + 3),
      p = ids.map((i) => vertices.slice(i * 3, i * 3 + 3)),
      u = p[1].map((v, i) => v - p[0][i]),
      v = p[2].map((v, i) => v - p[0][i]);
    const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      mid = p[0].map((v, i) => (v + p[1][i] + p[2][i]) / 3),
      inside = [-mid[0], D.arenaHeight / 2 - mid[1], -mid[2]];
    if (normal.reduce((s, v, i) => s + v * inside[i], 0) < 0)
      [indices[k + 1], indices[k + 2]] = [indices[k + 2], indices[k + 1]];
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    profileLength: rings.length,
  };
}
function tileBoundary(team: number) {
  const edges = new Map<string, { a: Vector2; b: Vector2 }>(),
    key = (p: Vector2) => p.x.toFixed(4) + "," + p.y.toFixed(4);
  for (const t of dropshotTiles.filter((t) => t.team === team)) {
    const vs = hexVertices(t.x, t.z).map((p) => new Vector2(p.x, p.z));
    for (let i = 0; i < 6; i++) {
      const a = vs[i],
        b = vs[(i + 1) % 6],
        k = [key(a), key(b)].sort().join("|");
      if (edges.has(k)) edges.delete(k);
      else edges.set(k, { a, b });
    }
  }
  const remaining = [...edges.values()],
    path: Vector2[] = [remaining[0].a];
  let end = remaining[0].b;
  remaining.shift();
  while (remaining.length) {
    path.push(end);
    const i = remaining.findIndex(
      (e) => key(e.a) === key(end) || key(e.b) === key(end),
    );
    if (i < 0) throw Error("Disconnected Dropshot floor boundary");
    const e = remaining.splice(i, 1)[0];
    end = key(e.a) === key(end) ? e.b : e.a;
  }
  return path;
}
let floor: ArenaMesh | undefined;
/** Solid neutral divider/perimeter only. There is NO solid floor below any tile. */
export function dropshotFloor(): ArenaMesh {
  if (floor) return floor;
  const contour = dropshotPerimeter(D.rampRadius),
    holes = [tileBoundary(0), tileBoundary(1)],
    all = [...contour, ...holes.flat()],
    faces = ShapeUtils.triangulateShape(contour, holes),
    vertices = all.flatMap((p) => [p.x, 0, p.y]),
    indices = faces.flat();
  // Earcut winds in X/Z; mapped into Y-up, its top faces point downward.
  // Orient the solid divider/perimeter upward for physical contact, not just rays.
  for (let i = 0; i < indices.length; i += 3) {
    const a = all[indices[i]],
      b = all[indices[i + 1]],
      c = all[indices[i + 2]];
    if ((b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) < 0)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  return (floor = {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    profileLength: 1,
  });
}
export function insideDropshot(p: { x: number; y: number; z: number }) {
  return (
    p.y < D.arenaHeight + 2 &&
    p.y > D.ballRecoveryDepth &&
    Array.from({ length: 6 }, (_, i) => {
      const a = ((i + 0.5) * Math.PI) / 3;
      return (
        p.x * Math.cos(a) + p.z * Math.sin(a) <=
        D.arenaRadius * Math.cos(Math.PI / 6) + 1
      );
    }).every(Boolean)
  );
}
export function createDropshotArena(world: RAPIER.World) {
  const add = (m: ArenaMesh) =>
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        m.vertices,
        m.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      )
        .setFriction(0.4)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
  const shell = add(dropshotShell()),
    filler = add(dropshotFloor());
  filler.setCollisionGroups(DROPSHOT_TILE_GROUP);
  // One continuous rigid floor for cars, including wheel/chassis queries.
  // Ball-only tile prisms retain their exposed sides and independent open state.
  const supportPoints = dropshotPerimeter(D.rampRadius).flatMap((p) => [
    p.x,
    0,
    p.y,
    p.x,
    -D.tileThickness,
    p.y,
  ]);
  const support = world.createCollider(
    RAPIER.ColliderDesc.convexHull(new Float32Array(supportPoints))!
      .setCollisionGroups(DROPSHOT_SUPPORT_GROUP)
      .setFriction(0.4)
      .setRestitution(0.05),
  );
  const tiles = dropshotTiles.map((t) => {
    const pts = hexVertices().flatMap((p) => [
      p.x,
      0,
      p.z,
      p.x,
      -D.tileThickness,
      p.z,
    ]);
    return world.createCollider(
      RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!
        .setTranslation(t.x, 0, t.z)
        .setCollisionGroups(DROPSHOT_TILE_GROUP)
        .setFriction(0.4)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
  });
  return {
    shell,
    filler,
    support,
    tiles,
    colliders: [shell, filler, support, ...tiles],
  };
}
