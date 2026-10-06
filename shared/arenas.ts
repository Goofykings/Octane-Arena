/** Soccer styles share identical gameplay geometry; extra modes use their own worlds. */
export const arenaIds = ["city", "beach", "stadium", "circuit"] as const;
export type ArenaId = (typeof arenaIds)[number];
export const isArenaId = (id: unknown): id is ArenaId =>
  typeof id === "string" && arenaIds.some((arena) => arena === id);
export function chooseMatchArena(
  previous?: ArenaId,
  random = Math.random,
): ArenaId {
  const pool = arenaIds.filter((id) => id !== previous);
  return pool[
    Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  ];
}
