import { z } from "zod";
/** SI metres/Y-up; original court and energy-to-impact conversion. */
export const DROPSHOT_CONFIG = {
  arenaRadius: 45.55 / Math.cos(Math.PI / 6),
  arenaHeight: 19.86,
  cornerRadius: 4,
  rampRadius: 2,
  tileCount: 140,
  tileSpacing: 6.6,
  tileThickness: 0.55,
  neutralHalfWidth: 0.45,
  maxEnergy: 20000,
  goalClearance: 0.15,
  eventRetention: 3,
  chargeThreshold1: 2500,
  chargeThreshold2: 11000,
  minimumChargeImpact: 500,
  impactEnergyPerSpeed: 100,
  recentForceCapacity: 2500,
  recentForceDecay: 2500,
  minimumTileDamageImpact: 2.5,
  damageCooldown: 0.2,
  normalDamageRadius: 0,
  chargedDamageRadius: 1,
  superChargedDamageRadius: 2,
  kickoffVerticalVelocity: 10,
  boostRegenRate: 10,
  boostRegenDelay: 0.5,
  damagePoints: 10,
  carFallDepth: -6,
  ballRecoveryDepth: -14,
  fullStateInterval: 1,
} as const;
export const TILE_STATE = { INTACT: 0, DAMAGED: 1, OPEN: 2 } as const;
export type TileState = 0 | 1 | 2;
export const tileRadius = DROPSHOT_CONFIG.tileSpacing / Math.sqrt(3);
export interface DropshotTile {
  id: number;
  team: 0 | 1;
  row: number;
  x: number;
  z: number;
  neighbors: number[];
  clusters: number[][];
}
export const dropshotTiles: DropshotTile[] = [];
for (const team of [0, 1] as const)
  for (let row = 0; row < 7; row++) {
    const count = 13 - row,
      sign = team === 0 ? 1 : -1;
    for (let col = 0; col < count; col++)
      dropshotTiles.push({
        id: dropshotTiles.length,
        team,
        row,
        x: (col - (count - 1) / 2) * DROPSHOT_CONFIG.tileSpacing,
        z:
          sign *
          (tileRadius +
            DROPSHOT_CONFIG.neutralHalfWidth +
            (row * DROPSHOT_CONFIG.tileSpacing * Math.sqrt(3)) / 2),
        neighbors: [],
        clusters: [],
      });
  }
for (const tile of dropshotTiles) {
  tile.neighbors = dropshotTiles
    .filter(
      (t) =>
        t.team === tile.team &&
        Math.abs(
          Math.hypot(t.x - tile.x, t.z - tile.z) - DROPSHOT_CONFIG.tileSpacing,
        ) < 0.001,
    )
    .map((t) => t.id);
}
for (const tile of dropshotTiles) {
  const visited = new Set([tile.id]);
  tile.clusters = [[tile.id]];
  for (let radius = 1; radius <= 2; radius++) {
    for (const id of [...visited])
      for (const n of dropshotTiles[id].neighbors) visited.add(n);
    tile.clusters.push([...visited].sort((a, b) => a - b));
  }
}
export function hexVertices(x = 0, z = 0, r = tileRadius) {
  return Array.from({ length: 6 }, (_, i) => ({
    x: x + Math.sin((i * Math.PI) / 3) * r,
    z: z + Math.cos((i * Math.PI) / 3) * r,
  }));
}
export function tileAt(x: number, z: number): DropshotTile | undefined {
  const team = z >= 0 ? 0 : 1,
    row = Math.round(
      (Math.abs(z) - tileRadius - DROPSHOT_CONFIG.neutralHalfWidth) /
        ((DROPSHOT_CONFIG.tileSpacing * Math.sqrt(3)) / 2),
    );
  for (let r = Math.max(0, row - 1); r <= Math.min(6, row + 1); r++) {
    const count = 13 - r,
      start = team * 70 + 13 * r - (r * (r - 1)) / 2,
      col = Math.round(x / DROPSHOT_CONFIG.tileSpacing + (count - 1) / 2);
    for (let c = Math.max(0, col - 1); c <= Math.min(count - 1, col + 1); c++) {
      const t = dropshotTiles[start + c],
        dx = Math.abs(x - t.x),
        dz = Math.abs(z - t.z);
      if (
        dx <= DROPSHOT_CONFIG.tileSpacing / 2 + 1e-6 &&
        dz <= tileRadius - dx / Math.sqrt(3) + 1e-6
      )
        return t;
    }
  }
}
export const intactTiles = () => "0".repeat(DROPSHOT_CONFIG.tileCount);
/** Full mutated sphere footprint must fit the UNION of open hexes. */
export function openFloor(
  x: number,
  z: number,
  radius: number,
  states: string,
) {
  const t = tileAt(x, z);
  if (!t || states[t.id] !== "2") return null;
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16,
      p = tileAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
    if (!p || p.team !== t.team || states[p.id] !== "2") return null;
  }
  return t.team;
}
export function floorEntry(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  radius: number,
  states: string,
) {
  if (a.y < 0 || b.y >= 0 || b.y >= a.y) return null;
  const f = a.y / (a.y - b.y);
  return openFloor(
    a.x + (b.x - a.x) * f,
    a.z + (b.z - a.z) * f,
    radius,
    states,
  );
}
export function dropshotSpawn(team: number, slot: number, count: number) {
  const positions =
    count === 1
      ? [[0, 30]]
      : count === 2
        ? [
            [-13, 23],
            [13, 23],
          ]
        : [
            [-18.67, 23.79],
            [18.67, 23.79],
            [0, 35.76],
          ];
  const p = positions[Math.min(slot, positions.length - 1)],
    sign = team === 0 ? 1 : -1,
    x = p[0] * sign,
    z = p[1] * sign;
  return { x, z, yaw: Math.atan2(x, z) };
}
export interface DropshotEvent {
  id: number;
  time: number;
  tileId: number;
  playerId: string;
  level: number;
  changes: [number, TileState][];
}
export interface DropshotSnapshot {
  epoch: number;
  revision: number;
  energy: number;
  chargeLevel: 0 | 1 | 2;
  lastTouchTeam: 0 | 1 | null;
  lastTouchPlayerId: string | null;
  recentAbsorbedForce: number;
  tiles?: string;
  events: DropshotEvent[];
}
const team = z.union([z.literal(0), z.literal(1)]).nullable();
export const dropshotSchema = z.object({
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  energy: z.number().finite().min(0).max(100000),
  chargeLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  lastTouchTeam: team,
  lastTouchPlayerId: z.string().max(80).nullable(),
  recentAbsorbedForce: z.number().min(0).max(2500),
  tiles: z
    .string()
    .regex(/^[012]{140}$/)
    .optional(),
  events: z
    .array(
      z.object({
        id: z.number().int().positive(),
        time: z.number().finite(),
        tileId: z.number().int().min(0).max(139),
        playerId: z.string().max(80),
        level: z.number().int().min(0).max(2),
        changes: z
          .array(
            z.tuple([
              z.number().int().min(0).max(139),
              z.union([z.literal(0), z.literal(1), z.literal(2)]),
            ]),
          )
          .max(19),
      }),
    )
    .max(16),
});
/** Client/replay accumulator. Never makes damage decisions. */
export class DropshotView {
  tiles = intactTiles();
  epoch = -1;
  revision = 0;
  apply(s: DropshotSnapshot) {
    if (s.epoch < this.epoch) return;
    if (s.epoch !== this.epoch) {
      this.epoch = s.epoch;
      this.revision = 0;
      this.tiles = intactTiles();
    }
    if (s.tiles && s.revision >= this.revision) {
      this.tiles = s.tiles;
      this.revision = s.revision;
    }
    for (const e of s.events)
      if (e.id === this.revision + 1) {
        const chars = this.tiles.split("");
        for (const [id, state] of e.changes) chars[id] = String(state);
        this.tiles = chars.join("");
        this.revision = e.id;
      }
  }
}
