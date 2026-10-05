import { P } from "../config/physics";
export interface ArenaMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  profileLength: number;
}
/** Original rounded-rectangle sweep. Shared by rendering and collision, never extracted geometry. */
export function arenaShell(): ArenaMesh {
  const a = P.arena,
    perimeter: { x: number; z: number; nx: number; nz: number }[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const angle0 = (corner * Math.PI) / 2,
      cx = (corner === 0 || corner === 3 ? 1 : -1) * (a.halfWidth - a.corner),
      cz = (corner < 2 ? 1 : -1) * (a.halfLength - a.corner);
    for (let k = 0; k <= 24; k++) {
      const t = angle0 + ((k / 24) * Math.PI) / 2;
      perimeter.push({
        x: cx + a.corner * Math.cos(t),
        z: cz + a.corner * Math.sin(t),
        nx: Math.cos(t),
        nz: Math.sin(t),
      });
    }
    // Insert goal edges in straight back walls so the opening has exact width.
    if (corner === 0)
      for (const x of [a.goalHalf + a.goalLip, -a.goalHalf - a.goalLip])
        perimeter.push({ x, z: a.halfLength, nx: 0, nz: 1 });
    if (corner === 2)
      for (const x of [-a.goalHalf - a.goalLip, a.goalHalf + a.goalLip])
        perimeter.push({ x, z: -a.halfLength, nx: 0, nz: -1 });
  }
  const profile: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const t = ((i / 20) * Math.PI) / 2;
    profile.push([a.ramp * (1 - Math.sin(t)), a.ramp * (1 - Math.cos(t))]);
  }
  profile.push([0, a.goalHeight + a.goalLip], [0, a.height - a.ramp]);
  for (let i = 1; i <= 20; i++) {
    const t = ((i / 20) * Math.PI) / 2;
    profile.push([
      a.ramp * (1 - Math.cos(t)),
      a.height - a.ramp + a.ramp * Math.sin(t),
    ]);
  }
  const v: number[] = [],
    indices: number[] = [];
  for (const p of perimeter)
    for (const [inset, y] of profile)
      v.push(p.x - p.nx * inset, y, p.z - p.nz * inset);
  const n = profile.length;
  for (let i = 0; i < perimeter.length; i++)
    for (let j = 0; j < n - 1; j++) {
      const next = (i + 1) % perimeter.length,
        p = perimeter[i],
        q = perimeter[next];
      if (
        Math.abs(p.z) === a.halfLength &&
        p.z === q.z &&
        Math.abs((p.x + q.x) / 2) < a.goalHalf + a.goalLip &&
        profile[j + 1][1] <= a.goalHeight + a.goalLip
      )
        continue;
      const k = i * n + j,
        l = next * n + j;
      indices.push(k, l, k + 1, l, l + 1, k + 1);
    }
  return {
    vertices: new Float32Array(v),
    indices: new Uint32Array(indices),
    profileLength: n,
  };
}

/** Rectangular mouth on the scoring plane, lofting into a smooth interior bowl. */
export function goalShell(sign: number): ArenaMesh {
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
  }[] = [];
  const push = (
    x: number,
    z: number,
    nx: number,
    nz: number,
    radius: number = r,
  ) => path.push({ x, z, nx, nz, radius });
  // Keep the front edge exactly at x=+/-W, y=H, z=+/-L. Interior corner
  // radii grow smoothly behind that opening instead of rounding it away.
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    push(W, L + l * t, 1, 0, r * t * t * (3 - 2 * t));
  }
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
  for (let i = 1; i <= 20; i++) {
    const t = 1 - i / 20;
    push(-W, L + l * t, -1, 0, r * t * t * (3 - 2 * t));
  }
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
        inset = j === 21 ? 0 : radius * (1 - Math.cos(t));
        y = j === 21 ? H - radius : H - radius + radius * Math.sin(t);
      }
      v.push(p.x - p.nx * inset, y, sign * (p.z - p.nz * inset));
    }
  }
  const quad = (a: number, b: number, c: number, d: number) =>
    indices.push(a, b, c, b, d, c);
  for (let i = 0; i < path.length - 1; i++)
    for (let j = 0; j < N - 1; j++)
      quad(i * N + j, (i + 1) * N + j, i * N + j + 1, (i + 1) * N + j + 1);
  // A single planar ceiling patch meets the swept rear/side boundaries exactly.
  const start = v.length / 3;
  v.push(
    -W + r,
    H,
    sign * (L + l),
    W - r,
    H,
    sign * (L + l),
    -W + r,
    H,
    sign * (L + D - r),
    W - r,
    H,
    sign * (L + D - r),
  );
  quad(start, start + 1, start + 2, start + 3);
  // Flat ceiling shares the loft's upper boundaries all the way to the mouth.
  const lipStart = v.length / 3;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20,
      width = W - r * t * t * (3 - 2 * t);
    v.push(-width, H, sign * (L + l * t), width, H, sign * (L + l * t));
  }
  for (let i = 0; i < 20; i++)
    quad(
      lipStart + i * 2,
      lipStart + i * 2 + 1,
      lipStart + i * 2 + 2,
      lipStart + i * 2 + 3,
    );
  // Solid front fascia closes the shell cutout to the exact rectangular frame.
  // It is shared by Rapier and rendering, not a cosmetic plane covering a hole.
  const face = (points: number[][]) => {
    const at = v.length / 3;
    for (const p of points) v.push(p[0], p[1], sign * p[2]);
    quad(at, at + 1, at + 2, at + 3);
  };
  face([
    [-W - l, H, L],
    [W + l, H, L],
    [-W - l, H + l, L],
    [W + l, H + l, L],
  ]);
  for (const side of [-1, 1]) {
    // Taper the entire floor fillet to zero at the post, not just its depth.
    // The old constant-height loft left a vertical pocket beside each post.
    // This joins a flat mouth floor to the surrounding ramp without a divot.
    const at = v.length / 3,
      columns = 25;
    for (let row = 0; row <= 20; row++)
      for (let col = 0; col < columns; col++) {
        const t = ((row / 20) * Math.PI) / 2,
          u = col / (columns - 1),
          blend = u * u * (3 - 2 * u),
          radius = a.ramp * blend;
        v.push(
          side * (W + l * u),
          radius * (1 - Math.cos(t)),
          sign * (L - radius * (1 - Math.sin(t))),
        );
      }
    for (let row = 0; row < 20; row++)
      for (let col = 0; col < columns - 1; col++) {
        const k = at + row * columns + col;
        quad(k, k + 1, k + columns, k + columns + 1);
      }
    const wall = v.length / 3;
    for (let col = 0; col < columns; col++) {
      const u = col / (columns - 1),
        radius = a.ramp * u * u * (3 - 2 * u);
      v.push(
        side * (W + l * u),
        radius,
        sign * L,
        side * (W + l * u),
        a.ramp,
        sign * L,
      );
    }
    for (let col = 0; col < columns - 1; col++) {
      const k = wall + col * 2;
      quad(k, k + 2, k + 1, k + 3);
    }
    face([
      [side * W, a.ramp, L],
      [side * (W + l), a.ramp, L],
      [side * W, H, L],
      [side * (W + l), H, L],
    ]);
  }
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
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((n) => remap[n]);
    if (a !== b && b !== c && c !== a) triangles.push(a, b, c);
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(triangles),
    profileLength: N,
  };
}
