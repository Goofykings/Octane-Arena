import type { PlayerEntity } from "./player";
export const botSizes = ["1v1", "2v2", "3v3", "1v2", "1v3"] as const;
export const botDifficulties = [
  "beginner",
  "intermediate",
  "advanced",
] as const;
export type BotSize = (typeof botSizes)[number];
export type BotDifficulty = (typeof botDifficulties)[number];
export function botRoster(size: BotSize, local: PlayerEntity): PlayerEntity[] {
  const [blue, orange] = size.split("v").map(Number);
  const usedNames = new Set([local.name.trim().toLowerCase()]);
  const name = (preferred: string) => {
    const selected = [preferred, "Maverick", "Nova", "Blaze", "Orbit", "Comet"]
      .find((candidate) => !usedNames.has(candidate.toLowerCase()))!;
    usedNames.add(selected.toLowerCase());
    return selected;
  };
  return [
    { ...local, team: 0, controller: "local" },
    ...Array.from({ length: blue - 1 }, (_, i) => ({
      id: `ally-${i}`,
      name: name(["Rivet", "Aster"][i]),
      team: 0 as const,
      controller: "bot" as const,
    })),
    ...Array.from({ length: orange }, (_, i) => ({
      id: `opponent-${i}`,
      name: name(["Vanta", "Kestrel", "Flux"][i]),
      team: 1 as const,
      controller: "bot" as const,
    })),
  ];
}
