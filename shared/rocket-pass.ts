import { inventory } from "./catalog";
import { xpRequired, type Progression } from "./progression";
export type RocketPassRewardType =
  | "TOPPER"
  | "GOAL_EXPLOSION"
  | "CAR_BODY"
  | "BOOST";
export interface RocketPassReward {
  level: number;
  type: RocketPassRewardType;
  itemId: string;
  displayName: string;
  bonus?: { type: RocketPassRewardType; itemId: string; displayName: string }[];
}
const items: [RocketPassRewardType, string][] = [
  ["TOPPER", "beanie"],
  ["GOAL_EXPLOSION", "confetti"],
  ["TOPPER", "top-hat"],
  ["GOAL_EXPLOSION", "electric"],
  ["TOPPER", "cat-ears"],
  ["GOAL_EXPLOSION", "bubbles"],
  ["TOPPER", "birthday"],
  ["GOAL_EXPLOSION", "inferno"],
  ["TOPPER", "pickle"],
  ["CAR_BODY", "boxy"],
  ["GOAL_EXPLOSION", "crystal"],
  ["TOPPER", "crown"],
  ["GOAL_EXPLOSION", "digital"],
  ["TOPPER", "cone"],
  ["GOAL_EXPLOSION", "blue-wash"],
  ["TOPPER", "halo"],
  ["GOAL_EXPLOSION", "debris"],
  ["TOPPER", "ufo"],
  ["GOAL_EXPLOSION", "violet-wash"],
  ["CAR_BODY", "wedge"],
  ["TOPPER", "pirate"],
  ["TOPPER", "emerald-hat"],
  ["TOPPER", "solar-halo"],
  ["TOPPER", "frost-crown"],
  ["TOPPER", "violet-ufo"],
];
// Add boosts as bonuses so previously claimed primary rewards never change.
const boostBonuses: Record<number, string> = {
  3: "ember",
  6: "standard",
  9: "ion",
  12: "lightning",
  15: "thermal",
  18: "sparkles",
  21: "sacred",
  24: "datastream",
  25: "dust",
};
export const rewardSlot = (type: RocketPassRewardType) =>
  type === "CAR_BODY"
    ? "body"
    : type === "TOPPER"
      ? "topper"
      : type === "BOOST"
        ? "boost"
        : "explosion";
export const ROCKET_PASS_SEASON_1 = {
  id: "season-1",
  name: "SEASON 1",
  rewards: items.map(([type, itemId], i): RocketPassReward => {
    const item = inventory[rewardSlot(type)].find((item) => item.id === itemId);
    if (!item) throw Error("Unknown Rocket Pass item " + itemId);
    const boost = inventory.boost.find(
      (item) => item.id === boostBonuses[i + 1],
    );
    return {
      level: i + 1,
      type,
      itemId,
      displayName: item.name,
      bonus: boost
        ? [{ type: "BOOST", itemId: boost.id, displayName: boost.name }]
        : undefined,
    };
  }),
};
export interface OwnedInventory {
  body: string[];
  topper: string[];
  explosion: string[];
  boost: string[];
}
export const starterOwnership = (): OwnedInventory => ({
  body: ["vector", "lowflat"],
  topper: [],
  explosion: ["pulse"],
  boost: ["plasma"],
});
export function rocketPassProgress(p: Progression) {
  return Math.max(
    0,
    Math.min(1, (p.level - 1 + p.currentLevelXP / xpRequired(p.level)) / 24),
  );
}
