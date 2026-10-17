/** Standard Soccar styles share geometry; Hoops has its own fixed court. */
export const arenaIds = [
  "city",
  "beach",
  "stadium",
  "circuit",
  "hoops",
  "dropshot",
] as const;
export type ArenaId = (typeof arenaIds)[number];
export const isArenaId = (id: unknown): id is ArenaId =>
  typeof id === "string" && arenaIds.some((arena) => arena === id);
export function chooseMatchArena(
  previous?: ArenaId,
  random = Math.random,
  mode: string = "soccar",
): ArenaId {
  if (mode === "dropshot") return "dropshot";
  if (mode === "hoops") return "hoops";
  const pool = arenaIds.filter(
    (id) => id !== previous && id !== "hoops" && id !== "dropshot",
  );
  return pool[
    Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  ];
}
