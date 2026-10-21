/** Original Hoops court, SI metres, Y up. RLBot Hoops reference informs proportions. */
export const HOOPS_CONFIG = {
  arenaWidth: 59.3334,
  arenaLength: 71.62,
  ceilingHeight: 18.2,
  rampRadius: 1.72,
  cornerRadius: 7,
  hoopRadius: 6.55,
  hoopHeight: 3.64,
  rimThickness: 0.42,
  hoopZ: 28,
  rimRestitution: 0.58,
  kickoffVerticalVelocity: 10,
  kickoffBallHeight: 1.0,
  netFlare: 6,
  netCurveHeight: 3.85,
  netRestitution: 0,
  spawnPositions: [
    { x: -9, z: 15 },
    { x: 9, z: 15 },
    { x: 0, z: 12 },
  ],
  boostPadPositions: [
    ...[-1, 1].flatMap((sign) => [
      { x: -21.76, z: sign * 29.44, large: true },
      { x: 21.76, z: sign * 29.44, large: true },
      { x: 0, z: sign * 28.16, large: false },
      { x: -12.8, z: sign * 23.04, large: false },
      { x: 12.8, z: sign * 23.04, large: false },
      { x: -15.36, z: sign * 10.24, large: false },
      { x: 15.36, z: sign * 10.24, large: false },
      { x: -5.12, z: sign * 5.12, large: false },
      { x: 5.12, z: sign * 5.12, large: false },
    ]),
    { x: -24.32, z: 0, large: true },
    { x: 24.32, z: 0, large: true },
  ],
} as const;
export const hoopsSpawn = (team: number, slot: number, count: number) => {
  const p =
    count === 1
      ? { x: 0, z: 14 }
      : HOOPS_CONFIG.spawnPositions[Math.min(slot, 2)];
  return {
    x: p.x * (team === 0 ? 1 : -1),
    z: p.z * (team === 0 ? 1 : -1),
    yaw: team === 0 ? 0 : Math.PI,
  };
};
export type HoopsPoint = { x: number; y: number; z: number };
/** Full sphere clears the rim's inner radius while crossing center plane downwards.
 * Swept interpolation prevents missed fast crossings and excludes upward/underneath passes. */
export function hoopsCrossing(
  previous: HoopsPoint,
  current: HoopsPoint,
  radius: number,
): 0 | 1 | null {
  const h = HOOPS_CONFIG;
  if (
    ![
      previous.x,
      previous.y,
      previous.z,
      current.x,
      current.y,
      current.z,
      radius,
    ].every(Number.isFinite) ||
    radius <= 0 ||
    previous.y <= h.hoopHeight ||
    current.y > h.hoopHeight ||
    current.y >= previous.y
  )
    return null;
  const t = (previous.y - h.hoopHeight) / (previous.y - current.y),
    x = previous.x + (current.x - previous.x) * t,
    z = previous.z + (current.z - previous.z) * t;
  const aperture = h.hoopRadius - h.rimThickness / 2 - radius;
  if (aperture <= 0) return null;
  for (const team of [0, 1] as const) {
    const depth = (team === 0 ? 1 : -1) * z - h.hoopZ;
    if (Math.abs(z) + radius >= h.arenaLength / 2) continue;
    if (depth <= 0 ? Math.hypot(x, depth) < aperture : Math.abs(x) < aperture)
      return team === 0 ? 1 : 0;
  }
  return null;
}

/** Exposed D-shaped rim: front arc plus two side rails ending inside the wall. */
export function hoopsRimPath(sign: number) {
  const h = HOOPS_CONFIG,
    start = sign > 0 ? Math.PI : 0;
  const points: HoopsPoint[] = [];
  const leftX = Math.cos(start) * h.hoopRadius;
  points.push({ x: leftX, y: h.hoopHeight, z: (sign * h.arenaLength) / 2 });
  for (let i = 0; i <= 48; i++) {
    const a = start + (i / 48) * Math.PI;
    points.push({
      x: Math.cos(a) * h.hoopRadius,
      y: h.hoopHeight,
      z: sign * h.hoopZ + Math.sin(a) * h.hoopRadius,
    });
  }
  points.push({ x: -leftX, y: h.hoopHeight, z: (sign * h.arenaLength) / 2 });
  return points;
}
