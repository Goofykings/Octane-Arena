import { isArenaId, type ArenaId } from "../../shared/arenas";
export { arenaIds, isArenaId, type ArenaId } from "../../shared/arenas";
/** Visual palettes only. Every theme uses the same gameplay geometry. */
const baseArenaThemes = {
  city: {
    name: "Lumen District",
    sky: 0x28354c,
    fogNear: 105,
    fogFar: 290,
    skyLight: 0xc5e8ff,
    groundLight: 0x426453,
    sunlight: 0xffeed9,
    sunIntensity: 3.2,
    ambientIntensity: 2.5,
    turf: ["#154e47", "#205a4c", "#103f3e"],
    stripe: 0x5ac7ac,
    stripeOpacity: 0.035,
    marking: 0xb6ded1,
    lowerWall: 0x78969c,
    upperWall: 0x3e566b,
    wallOpacity: 0.72,
    lining: 0x456172,
    canopy: 0xb7e6ef,
    grid: 0x6aa0b1,
  },
  beach: {
    name: "Sunbreak Coast",
    sky: 0x93cbdc,
    fogNear: 135,
    fogFar: 320,
    skyLight: 0xd7f1ff,
    groundLight: 0x998461,
    sunlight: 0xfff2d8,
    sunIntensity: 2.6,
    ambientIntensity: 2.3,
    turf: ["#b69768", "#c4a578", "#a98a5b"],
    stripe: 0xe4c894,
    stripeOpacity: 0.095,
    marking: 0x334f58,
    lowerWall: 0xbca57e,
    upperWall: 0x809ba5,
    wallOpacity: 0.42,
    lining: 0x758e90,
    canopy: 0xffedca,
    grid: 0x527f92,
  },
  stadium: {
    name: "Crown Stadium",
    sky: 0x416177,
    fogNear: 125,
    fogFar: 290,
    skyLight: 0xd4edff,
    groundLight: 0x41684b,
    sunlight: 0xfff5e5,
    sunIntensity: 2.8,
    ambientIntensity: 2.3,
    turf: ["#246040", "#2e7049", "#1e5438"],
    stripe: 0x7aaa63,
    stripeOpacity: 0.1,
    marking: 0xdbeac9,
    lowerWall: 0x869e9c,
    upperWall: 0x57798b,
    wallOpacity: 0.48,
    lining: 0x526c79,
    canopy: 0xe6f1ff,
    grid: 0x90b1c6,
  },
} as const;
export const arenaThemes = {
  ...baseArenaThemes,
  circuit: { ...baseArenaThemes.stadium, name: "Circuit Field" },
} as const;

export function loadArenaChoice(): ArenaId {
  try {
    const id = localStorage.getItem("octane-arena-map");
    return isArenaId(id) ? id : "city";
  } catch {
    return "city";
  }
}
export function saveArenaChoice(id: ArenaId) {
  try {
    localStorage.setItem("octane-arena-map", id);
  } catch {
    /* The choice still works for this session. */
  }
}
