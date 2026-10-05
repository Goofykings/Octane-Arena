/** Soccar reference positions supplied for this game, in Unreal units.
 * Reference axes: X across field, negative Y at Blue's goal. Game axes:
 * X across field, positive Z at Blue's goal; car forward is local -Z.
 * Scale each horizontal axis independently to preserve arena proportions.
 */
export const kickoffSlots = {
  "right-diagonal": { x: -1952, y: -2464 },
  "left-diagonal": { x: 1952, y: -2464 },
  "back-right": { x: -256, y: -3840 },
  "back-left": { x: 256, y: -3840 },
  "far-back-center": { x: 0, y: -4608 },
} as const;
export type KickoffSlot = keyof typeof kickoffSlots;
export interface KickoffFormation {
  readonly id: string;
  readonly slots: readonly KickoffSlot[];
}
export const soloKickoffs: readonly KickoffFormation[] = (
  Object.keys(kickoffSlots) as KickoffSlot[]
).map((slot) => ({
  id: slot,
  slots: [slot],
}));
/** Predictable practice order; positions remain owned by kickoffSlots. */
export const freeplayKickoffs = [
  "left-diagonal",
  "right-diagonal",
  "back-left",
  "back-right",
  "far-back-center",
].map((id) => soloKickoffs.find((formation) => formation.id === id)!);
// Balanced combinations from canonical slots; not a claim of exact RL 2v2 sets.
export const duoKickoffs: readonly KickoffFormation[] = [
  { id: "two-diagonals", slots: ["right-diagonal", "left-diagonal"] },
  { id: "right-diagonal-back-right", slots: ["right-diagonal", "back-right"] },
  { id: "right-diagonal-back-left", slots: ["right-diagonal", "back-left"] },
  { id: "left-diagonal-back-right", slots: ["left-diagonal", "back-right"] },
  { id: "left-diagonal-back-left", slots: ["left-diagonal", "back-left"] },
  { id: "right-diagonal-center", slots: ["right-diagonal", "far-back-center"] },
  { id: "left-diagonal-center", slots: ["left-diagonal", "far-back-center"] },
  { id: "two-back-offsets", slots: ["back-right", "back-left"] },
];
export function kickoffSpawn(
  slot: KickoffSlot,
  team: number,
  arena: { halfWidth: number; halfLength: number },
) {
  const reference = kickoffSlots[slot];
  const mirror = team === 0 ? 1 : -1;
  const x = ((mirror * reference.x) / 4096) * arena.halfWidth;
  const z = ((mirror * -reference.y) / 5120) * arena.halfLength;
  // Exactly face the ball even if the arena's aspect ratio differs.
  return { x, z, yaw: Math.atan2(x, z) };
}

/** One selector per match, never per team or client. No boundary repeats. */
export class KickoffBag {
  private bags = new Map<number, KickoffFormation[]>();
  private previous = new Map<number, string>();
  constructor(private random: () => number = Math.random) {}
  next(teamSize: number): KickoffFormation {
    if (teamSize !== 1 && teamSize !== 2)
      throw Error("Kickoffs support one or two players per team");
    let bag = this.bags.get(teamSize);
    if (!bag?.length) {
      bag = [...(teamSize === 1 ? soloKickoffs : duoKickoffs)];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[bag.length - 1].id === this.previous.get(teamSize))
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      this.bags.set(teamSize, bag);
    }
    const formation = bag.pop()!;
    this.previous.set(teamSize, formation.id);
    return formation;
  }
}
