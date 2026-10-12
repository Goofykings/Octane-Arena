import { P } from "../config/physics";
import type { ArenaMesh } from "./geometry";

/** Original rectangular tunnel with compact floor/side/rear fillets.
 * Shared by visuals and the watertight arena collision shell. */
export function goalTunnel(sign: number): ArenaMesh {
  const a = P.arena,
    r = a.goalCurve,
    l = a.goalLip,
    H = a.goalHeight,
    W = a.goalHalf,
    L = a.halfLength,
    D = a.goalDepth;
  const path: {
    x: number;
    z: number;
    nx: number;
    nz: number;
    radius: number;
    upperRadius: number;
  }[] = [];
  const push = (
    x: number,
    z: number,
    nx: number,
    nz: number,
    radius: number = r,
    upperRadius: number = radius,
  ) => path.push({ x, z, nx, nz, radius, upperRadius });
  // Tangent quarter-turn from the field wall into the tunnel. At the field
  // edge its floor profile matches the arena ramp, not a separate post/step.
  const entrance = (side: number, t: number) => {
    const angle = (t * Math.PI) / 2,
      depth = l * (1 - Math.cos(angle));
    const u = depth / l,
      blend = u * u * (3 - 2 * u);
    push(
      side * (W + l - l * Math.sin(angle)),
      L + depth,
      side * Math.sin(angle),
      Math.cos(angle),
      a.ramp + (r - a.ramp) * blend,
      r * (0.3 * u + 2.4 * u * u - 1.7 * u * u * u),
    );
  };
  for (let i = 0; i <= 20; i++) entrance(1, i / 20);
  push(W, L + D - r, 1, 0);
  for (let i = 1; i <= 24; i++) {
    const t = ((i / 24) * Math.PI) / 2;
    push(
      W - r + r * Math.cos(t),
      L + D - r + r * Math.sin(t),
      Math.cos(t),
      Math.sin(t),
    );
  }
  push(-W + r, L + D, 0, 1);
  for (let i = 1; i <= 24; i++) {
    const t = ((i / 24) * Math.PI) / 2;
    push(
      -W + r - r * Math.sin(t),
      L + D - r + r * Math.cos(t),
      -Math.sin(t),
      Math.cos(t),
    );
  }
  push(-W, L + l, -1, 0);
  for (let i = 1; i <= 20; i++) entrance(-1, 1 - i / 20);
  const v: number[] = [],
    indices: number[] = [],
    N = 43;
  for (const p of path) {
    const radius = p.radius;
    for (let j = 0; j < N; j++) {
      let inset: number, y: number;
      if (j <= 20) {
        const t = ((j / 20) * Math.PI) / 2;
        inset = radius * (1 - Math.sin(t));
        y = radius * (1 - Math.cos(t));
      } else {
        const t = (((j - 22) / 20) * Math.PI) / 2;
        inset = j === 21 ? 0 : p.upperRadius * (1 - Math.cos(t));
        y =
          (j === 21
            ? -p.upperRadius
            : -p.upperRadius + p.upperRadius * Math.sin(t)) +
          goalCeilingHeight(p.z - p.nz * inset - L);
      }
      v.push(p.x - p.nx * inset, y, sign * (p.z - p.nz * inset));
    }
  }
  const tags: ("left" | "right" | "bar" | undefined)[] = [];
  const quad = (
    a: number,
    b: number,
    c: number,
    d: number,
    tag?: "left" | "right" | "bar",
  ) => {
    indices.push(a, b, c, b, d, c);
    tags.push(tag, tag);
  };
  for (let i = 0; i < path.length - 1; i++)
    for (let j = 0; j < N - 1; j++)
      quad(
        i * N + j,
        (i + 1) * N + j,
        i * N + j + 1,
        (i + 1) * N + j + 1,
        i < 20 || i >= path.length - 21
          ? j >= 21
            ? "bar"
            : i < 20
              ? "right"
              : "left"
          : undefined,
      );
  // A single inclined ceiling patch meets the swept rear/side boundaries exactly.
  const start = v.length / 3;
  v.push(
    -W + r,
    goalRoofHeight(l),
    sign * (L + l),
    W - r,
    goalRoofHeight(l),
    sign * (L + l),
    -W + r,
    goalRoofHeight(D - r),
    sign * (L + D - r),
    W - r,
    goalRoofHeight(D - r),
    sign * (L + D - r),
  );
  quad(start, start + 1, start + 2, start + 3);
  // Roof entrance is rounded into the field wall. Reuse the exact side sweep
  // boundary vertices, so there are no overlapping lips or patch gaps.
  const lipStart = v.length / 3;
  for (let i = 0; i <= 20; i++) {
    const left = ((path.length - 1 - i) * N + N - 1) * 3;
    const right = (i * N + N - 1) * 3;
    v.push(...v.slice(left, left + 3), ...v.slice(right, right + 3));
  }
  for (let i = 0; i < 20; i++)
    quad(
      lipStart + i * 2,
      lipStart + i * 2 + 1,
      lipStart + i * 2 + 2,
      lipStart + i * 2 + 3,
      "bar",
    );
  if (sign < 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  // Weld patch boundaries so render normals and Rapier internal-edge correction
  // share actual topology. Rounded rear poles collapse to a single vertex.
  const vertices: number[] = [],
    remap: number[] = [],
    lookup = new Map<string, number>();
  for (let i = 0; i < v.length; i += 3) {
    const key = [v[i], v[i + 1], v[i + 2]]
      .map((n) => Math.round(n * 1e6))
      .join(",");
    let id = lookup.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      vertices.push(v[i], v[i + 1], v[i + 2]);
      lookup.set(key, id);
    }
    remap.push(id);
  }
  const triangles: number[] = [];
  const frame = {
    left: [] as number[],
    right: [] as number[],
    bar: [] as number[],
  };
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((n) => remap[n]);
    if (a !== b && b !== c && c !== a) {
      triangles.push(a, b, c);
      const tag = tags[i / 3];
      if (tag) frame[tag].push(a, b, c);
    }
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(triangles),
    profileLength: N,
    frame: {
      left: new Uint32Array(frame.left),
      right: new Uint32Array(frame.right),
      bar: new Uint32Array(frame.bar),
    },
  };
}

/** Height at depth into either goal. Mouth/scoring aperture stays unchanged. */
export function goalRoofHeight(depth: number) {
  return (
    P.arena.goalHeight -
    P.arena.goalRoofDrop * Math.max(0, Math.min(1, depth / P.arena.goalDepth))
  );
}

/** Crossbar fillet is tangent to the front wall, then to the inclined tunnel roof. */
export function goalCeilingHeight(depth: number) {
  const l = P.arena.goalLip;
  const d = Math.max(0, Math.min(l, depth));
  return (
    goalRoofHeight(depth) +
    l -
    Math.sqrt(Math.max(0, l * l - (l - d) * (l - d)))
  );
}
