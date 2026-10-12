import { P } from "../config/physics";
export interface ArenaMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  profileLength: number;
  frame?: { left: Uint32Array; right: Uint32Array; bar: Uint32Array };
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

// Public mesh entry point retained for arena assembly and callers.
export { goalTunnel as goalShell } from "./goal";
