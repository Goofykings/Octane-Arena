import { ShapeUtils, Vector2, Vector3 } from "three";
import { arenaShell, goalShell, type ArenaMesh } from "./geometry";
import { P } from "../config/physics";

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
export function meshEdges(indices: ArrayLike<number>) {
  const edges = new Map<string, { a: number; b: number; faces: number[] }>();
  for (let i = 0; i < indices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j],
        b = indices[i + ((j + 1) % 3)],
        k = key(a, b);
      const edge = edges.get(k) ?? { a, b, faces: [] };
      edge.faces.push(i / 3);
      edges.set(k, edge);
    }
  return edges;
}

let cached: ArenaMesh | undefined;
/** One watertight original shell. Weld shared patches, resolve T junctions,
 * cap the actual floor/ceiling contours, then orient adjacent triangles alike. */
export function collisionShell(): ArenaMesh {
  if (cached) return cached;
  const points: Vector3[] = [],
    ids = new Map<string, number>();
  let faces: number[][] = [];
  for (const mesh of [arenaShell(), goalShell(-1), goalShell(1)]) {
    const remap: number[] = [];
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const p = new Vector3().fromArray(mesh.vertices, i);
      const k = p
        .toArray()
        .map((v) => Math.round(v * 1e5))
        .join(",");
      if (!ids.has(k)) {
        ids.set(k, points.length);
        points.push(p);
      }
      remap.push(ids.get(k)!);
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const f = Array.from(mesh.indices.slice(i, i + 3), (v) => remap[v]);
      if (
        new Set(f).size === 3 &&
        new Vector3()
          .subVectors(points[f[1]], points[f[0]])
          .cross(new Vector3().subVectors(points[f[2]], points[f[0]]))
          .lengthSq() > 1e-14
      )
        faces.push(f);
    }
  }
  const split = () => {
    const edges = meshEdges(faces.flat());
    // Only unmatched edges can be patch T junctions. Keep regular grid diagonals intact.
    const cuts = new Map<string, number[]>();
    for (const [k, e] of edges) {
      if (e.faces.length !== 1) continue;
      const a = points[e.a],
        d = points[e.b].clone().sub(a),
        len = d.lengthSq();
      const inside: { id: number; t: number }[] = [];
      points.forEach((p, id) => {
        if (id === e.a || id === e.b) return;
        const delta = p.clone().sub(a),
          t = delta.dot(d) / len;
        if (
          t > 1e-5 &&
          t < 1 - 1e-5 &&
          delta.addScaledVector(d, -t).lengthSq() < 1e-10
        )
          inside.push({ id, t });
      });
      if (inside.length)
        cuts.set(k, [
          e.a,
          ...inside.sort((a, b) => a.t - b.t).map((p) => p.id),
          e.b,
        ]);
    }
    const out: number[][] = [];
    for (const face of faces) {
      const boundary: number[] = [];
      for (let j = 0; j < 3; j++) {
        const a = face[j],
          b = face[(j + 1) % 3],
          cut = cuts.get(key(a, b));
        const run = cut ? (cut[0] === a ? cut : [...cut].reverse()) : [a, b];
        boundary.push(...run.slice(0, -1));
      }
      if (boundary.length === 3) out.push(face);
      else {
        // A centre fan retains every collinear boundary vertex (ear clipping doesn't).
        const center = new Vector3();
        face.forEach((id) => center.add(points[id]));
        center.multiplyScalar(1 / 3);
        const id = points.length;
        points.push(center);
        for (let j = 0; j < boundary.length; j++)
          out.push([boundary[j], boundary[(j + 1) % boundary.length], id]);
      }
    }
    faces = out;
  };
  split();
  for (const height of [0, P.arena.height]) {
    const edges = [...meshEdges(faces.flat()).values()].filter(
      (e) =>
        e.faces.length === 1 &&
        Math.abs(points[e.a].y - height) < 1e-5 &&
        Math.abs(points[e.b].y - height) < 1e-5,
    );
    const neighbors = new Map<number, number[]>();
    for (const e of edges) {
      neighbors.set(e.a, [...(neighbors.get(e.a) ?? []), e.b]);
      neighbors.set(e.b, [...(neighbors.get(e.b) ?? []), e.a]);
    }
    if ([...neighbors.values()].some((n) => n.length !== 2))
      throw Error(`Open cap contour at y=${height}`);
    while (neighbors.size) {
      const start = neighbors.keys().next().value!,
        loop = [start];
      let previous = -1,
        current = start;
      do {
        const next = neighbors.get(current)!.find((n) => n !== previous)!;
        previous = current;
        current = next;
        if (current !== start) loop.push(current);
      } while (current !== start && loop.length <= neighbors.size);
      for (const id of loop) neighbors.delete(id);
      const triangles = ShapeUtils.triangulateShape(
        loop.map((id) => new Vector2(points[id].x, points[id].z)),
        [],
      );
      triangles.forEach((f) => faces.push(f.map((i) => loop[i])));
    }
  }
  split();
  const edges = meshEdges(faces.flat());
  const bad = [...edges.values()].filter((e) => e.faces.length !== 2);
  if (bad.length)
    throw Error(
      `Arena shell has ${bad.length} unmatched/non-manifold edges: ${JSON.stringify(bad.slice(0, 4).map((e) => [points[e.a], points[e.b]]))}`,
    );
  // Propagate consistent winding; generated goal patches historically disagreed.
  const visited = new Set<number>();
  for (let seed = 0; seed < faces.length; seed++) {
    if (visited.has(seed)) continue;
    const queue = [seed];
    visited.add(seed);
    for (let at = 0; at < queue.length; at++) {
      const id = queue[at],
        f = faces[id];
      for (let j = 0; j < 3; j++) {
        const a = f[j],
          b = f[(j + 1) % 3];
        const next = edges.get(key(a, b))!.faces.find((i) => i !== id)!;
        if (visited.has(next)) continue;
        const n = faces[next];
        if (n[(n.indexOf(a) + 1) % 3] === b) n.reverse();
        visited.add(next);
        queue.push(next);
      }
    }
  }
  const volume = faces.reduce(
    (sum, f) =>
      sum +
      points[f[0]].dot(new Vector3().crossVectors(points[f[1]], points[f[2]])),
    0,
  );
  if (volume > 0) faces.forEach((f) => f.reverse()); // inward normals for the playable cavity
  cached = {
    vertices: new Float32Array(points.flatMap((p) => p.toArray())),
    indices: new Uint32Array(faces.flat()),
    profileLength: 0,
  };
  return cached;
}
