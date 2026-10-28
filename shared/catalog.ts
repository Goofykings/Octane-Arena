/** Collision dimensions. Every selectable body shares Vector's tested chassis and rigid
 * wheel geometry; cosmetics never alter the length, inertia, contact solver or driving tuning.
 * Ion is a legacy hitbox kept only as a physics fixture: it is not selectable, and saved
 * presets that used it (or the retired Cargo/Slicer/Wraith shells) migrate to Vector.
 */
export const bodies = {
  ion: {
    name: "Ion",
    halfWidth: 0.42,
    halfHeight: 0.18,
    halfLength: 0.59,
    hitboxY: 0.04,
    axle: 0.43,
  },
  vector: {
    name: "Vector",
    halfWidth: 0.43,
    halfHeight: 0.25,
    halfLength: 0.66,
    hitboxY: 0.13, // Raise the roof while preserving the existing underside clearance.
    axle: 0.49,
  },
  // GLB lineup (art/blender/build_octane_arena_cars.py): visual-only shells on Vector's chassis.
  lowflat: {
    name: "LowFlat",
    halfWidth: 0.43,
    halfHeight: 0.25,
    halfLength: 0.66,
    hitboxY: 0.13,
    axle: 0.49,
  },
  boxy: {
    name: "Boxy",
    halfWidth: 0.43,
    halfHeight: 0.25,
    halfLength: 0.66,
    hitboxY: 0.13,
    axle: 0.49,
  },
  wedge: {
    name: "Wedge",
    halfWidth: 0.43,
    halfHeight: 0.25,
    halfLength: 0.66,
    hitboxY: 0.13,
    axle: 0.49,
  },
} as const;
export type BodyId = keyof typeof bodies;
export const inventory = {
  body: [
    { id: "vector", name: "Vector" },
    { id: "lowflat", name: "LowFlat" },
    { id: "boxy", name: "Boxy" },
    { id: "wedge", name: "Wedge" },
  ],
  wheels: [
    { id: "apex", name: "Apex" },
    { id: "disc", name: "Orbit" },
    { id: "filament", name: "Filament" },
    { id: "dish", name: "Recess" },
    { id: "offroad", name: "Badland" },
    { id: "turbine", name: "Vortex" },
    { id: "glow", name: "Pulse" },
    { id: "star", name: "Aster" },
    { id: "steel", name: "Heritage" },
    { id: "experimental", name: "Gyro" },
  ],
  boost: [
    { id: "plasma", name: "Plasma" },
    { id: "ember", name: "Ember" },
    { id: "standard", name: "Slipstream" },
    { id: "ion", name: "Ion Drive" },
    { id: "lightning", name: "Arc" },
    { id: "thermal", name: "Heatwave" },
    { id: "sparkles", name: "Stardust" },
    { id: "sacred", name: "Astral" },
    { id: "datastream", name: "Byte Stream" },
    { id: "dust", name: "Dune" },
  ],
  topper: [
    { id: "none", name: "None" },
    { id: "top-hat", name: "Top Hat" },
    { id: "cat-ears", name: "Cat Ears" },
    { id: "birthday", name: "Birthday Hat" },
    { id: "pickle", name: "Pickle" },
    { id: "crown", name: "Crown" },
    { id: "cone", name: "Traffic Cone" },
    { id: "beanie", name: "Propeller Beanie" },
    { id: "halo", name: "Halo Ring" },
    { id: "ufo", name: "Tiny UFO" },
    { id: "pirate", name: "Pirate Hat" },
    { id: "emerald-hat", name: "Emerald Top Hat" },
    { id: "solar-halo", name: "Solar Halo" },
    { id: "frost-crown", name: "Frost Crown" },
    { id: "violet-ufo", name: "Violet UFO" },
  ],
  explosion: [
    { id: "pulse", name: "Pulse" },
    { id: "inferno", name: "Afterburn" },
    { id: "electric", name: "Arcstorm" },
    { id: "confetti", name: "Confetti" },
    { id: "crystal", name: "Prism Bloom" },
    { id: "bubbles", name: "Bubble Pop" },
    { id: "digital", name: "Databurst" },
    { id: "debris", name: "Quarry" },
    { id: "blue-wash", name: "Blue Horizon" },
    { id: "violet-wash", name: "Violet Eclipse" },
  ],
} as const;
export type CosmeticSlot = keyof typeof inventory;
/** Bodies a preset may use (Ion is a physics fixture only). */
export type SelectableBodyId = (typeof inventory.body)[number]["id"];
export type Team = "blue" | "orange";
export interface Preset {
  id: string;
  name: string;
  body: SelectableBodyId;
  blue: string;
  orange: string;
  wheels: string;
  boost: string;
  topper: string;
  explosion: string;
}
export const palette = [
  "#e6faff",
  "#80e5ef",
  "#36cedd",
  "#138dba",
  "#185690",
  "#203b63",
  "#f0eaff",
  "#b8b0fa",
  "#8173e9",
  "#6950b2",
  "#4f3388",
  "#30244e",
  "#ffe5f2",
  "#f5a6cf",
  "#e066a5",
  "#be3982",
  "#8b2862",
  "#531d41",
  "#ffebe0",
  "#ffc693",
  "#f89a49",
  "#e36a30",
  "#ab4225",
  "#672b24",
  "#fff7d6",
  "#ffe69b",
  "#edc74d",
  "#be962c",
  "#876521",
  "#4d411e",
  "#e2ffee",
  "#9fedc2",
  "#50d59e",
  "#249a7a",
  "#176557",
  "#1a403b",
  "#f2f6fa",
  "#c3d0db",
  "#8c9daa",
  "#5c6f80",
  "#354756",
  "#1b2734",
];
export const starter = (): Preset => ({
  id: "starter",
  name: "Preset 1",
  body: "vector",
  blue: "#36cedd",
  orange: "#f89a49",
  wheels: "apex",
  boost: "plasma",
  topper: "none",
  explosion: "pulse",
});

/** Accept only known effects; missing/obsolete saved choices use the original Pulse. */
export const goalExplosionId = (value: unknown): string =>
  inventory.explosion.some((x) => x.id === value) ? (value as string) : "pulse";
/** Ion and the retired Cargo/Slicer/Wraith shells migrate to the default Vector.
 * Any other unknown body is left alone so validation still rejects it. */
const retiredBodies = ["ion", "cargo", "slicer", "wraith"];
export const selectableBody = (value: unknown): unknown =>
  retiredBodies.includes(value as string) ? "vector" : value;
/** Narrow legacy migration only. The rest of preset validation remains strict. */
export function migratePreset(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { decal: _removed, ...preset } = raw as Record<string, unknown>;
  return {
    ...preset,
    body: selectableBody(preset.body),
    explosion: goalExplosionId(preset.explosion),
  };
}
