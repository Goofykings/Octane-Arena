import assert from "node:assert/strict";
import { Garage, inventory, starter } from "../src/game/inventory";
import { LocalProfile } from "../src/game/local-profile";
import {
  ROCKET_PASS_SEASON_1 as S,
  rocketPassProgress,
} from "../shared/rocket-pass";
import { progressionAt, xpAtLevel, xpRequired } from "../shared/progression";
const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  },
});
const fresh = new Garage();
assert.deepEqual(fresh.owned, {
  body: ["vector", "lowflat"],
  topper: [],
  explosion: ["pulse"],
  boost: ["plasma"],
});
assert.equal(fresh.owns("topper", "none"), true);
assert.equal(fresh.equip("body", "boxy"), false);
assert.equal(fresh.equip("topper", "beanie"), false);
assert.equal(S.rewards.length, 25);
assert.deepEqual(
  S.rewards.filter((r) => r.type === "CAR_BODY").map((r) => r.level),
  [10, 20],
);
assert.equal(new Set(S.rewards.map((r) => r.itemId)).size, 25);
assert.equal(await fresh.claimRocketPass(2, progressionAt(0)), false);
assert.equal(await fresh.claimRocketPass(1, progressionAt(0)), true);
assert.equal(await fresh.claimRocketPass(1, progressionAt(0)), false);
assert.equal(fresh.equip("topper", "beanie"), true);
const reopened = new Garage();
assert.equal(reopened.current.topper, "beanie");
assert.ok(reopened.owned.topper.includes("beanie"));
assert.deepEqual(reopened.claimedRocketPass["season-1"], [1]);
for (const level of [9, 10, 20, 25, 26]) {
  const p = progressionAt(xpAtLevel(level));
  for (const r of S.rewards) {
    if (r.level > level)
      assert.equal(await reopened.claimRocketPass(r.level, p), false);
    else if (!reopened.claimedRocketPass["season-1"].includes(r.level))
      assert.equal(await reopened.claimRocketPass(r.level, p), true);
  }
  if (level === 9) assert.equal(reopened.owns("body", "boxy"), false);
  if (level === 10) assert.equal(reopened.equip("body", "boxy"), true);
  if (level === 20) assert.equal(reopened.equip("body", "wedge"), true);
}
assert.equal(reopened.claimedRocketPass["season-1"].length, 25);
assert.equal(
  reopened.owned.boost.length,
  10,
  "all nine bonus boosts earned by level 25",
);
assert.ok(reopened.owns("body", "wedge"));
const half = {
  level: 7,
  currentLevelXP: xpRequired(7) / 2,
  totalXP: xpAtLevel(7) + xpRequired(7) / 2,
};
assert.equal(rocketPassProgress(half), 6.5 / 24);
assert.equal(rocketPassProgress(progressionAt(xpAtLevel(26))), 1);
const profile = new LocalProfile(localStorage);
await profile.awardXP(1000, {
  type: "CHALLENGE",
  id: "challenge/DAILY/pass-test/claim",
});
assert.equal(profile.value.progression.level, 2);
assert.equal(new LocalProfile(localStorage).value.progression.level, 2);
// Legacy customized presets stay owned, without granting the unused catalog.
storage.set(
  "octane-arena-garage",
  JSON.stringify({
    version: 1,
    presets: [
      {
        ...reopened.current,
        body: "wedge",
        topper: "crown",
        explosion: "crystal",
      },
    ],
    index: 0,
  }),
);
const legacy = new Garage();
assert.equal(legacy.current.body, "wedge");
assert.equal(legacy.current.topper, "crown");
assert.equal(legacy.owns("body", "wedge"), true);
assert.equal(legacy.owns("topper", "crown"), true);
assert.equal(legacy.owns("explosion", "crystal"), true);
assert.equal(legacy.owns("topper", "ufo"), false);
assert.equal(legacy.owns("topper", "beanie"), false);
assert.equal(legacy.owns("explosion", "confetti"), false);
const tab2 = new Garage();
assert.equal(
  await legacy.claimRocketPass(25, progressionAt(xpAtLevel(25))),
  true,
);
assert.equal(
  await tab2.claimRocketPass(25, progressionAt(xpAtLevel(25))),
  false,
);
assert.equal(new Garage().owns("boost", "dust"), true);
// Upgrade the previous blanket grant, including already-migrated defaults.
const oldCatalog = {
  body: inventory.body.map((i) => i.id),
  topper: [
    "top-hat",
    "cat-ears",
    "birthday",
    "pickle",
    "crown",
    "cone",
    "beanie",
    "halo",
    "ufo",
    "pirate",
  ],
  explosion: inventory.explosion.map((i) => i.id),
};
storage.set(
  "octane-arena-garage",
  JSON.stringify({
    inventoryVersion: 1,
    owned: oldCatalog,
    presets: [starter()],
    claimedRocketPass: { "season-1": [] },
  }),
);
const migratedDefault = new Garage();
assert.deepEqual(migratedDefault.owned, {
  body: ["vector", "lowflat"],
  topper: [],
  explosion: ["pulse"],
  boost: ["plasma"],
});
assert.equal(
  JSON.parse(storage.get("octane-arena-garage")!).inventoryVersion,
  4,
);
assert.deepEqual(
  new Garage().owned,
  migratedDefault.owned,
  "old grants stay removed after refresh",
);
// Claims persist even when the item is not equipped; all customized presets survive.
storage.set(
  "octane-arena-garage",
  JSON.stringify({
    inventoryVersion: 1,
    owned: oldCatalog,
    presets: [
      { ...starter(), topper: "crown", explosion: "crystal" },
      { ...starter(), id: "other", body: "wedge", topper: "pirate" },
    ],
    claimedRocketPass: { "season-1": [1, 2, 10] },
  }),
);
const customized = new Garage();
assert.ok(
  customized.owns("topper", "crown") && customized.owns("topper", "shark-fin"),
);
assert.ok(
  customized.owns("explosion", "crystal") && customized.owns("body", "wedge"),
);
assert.ok(
  customized.owns("topper", "beanie") &&
    customized.owns("explosion", "confetti") &&
    customized.owns("body", "boxy"),
);
assert.equal(customized.owns("topper", "cat-ears"), false);
assert.deepEqual(new Garage().claimedRocketPass["season-1"], [1, 2, 10]);
// Bonus boosts unlock with their level and also reach earlier claim receipts.
storage.set(
  "octane-arena-garage",
  JSON.stringify({
    inventoryVersion: 2,
    owned: {
      body: ["vector", "lowflat"],
      topper: ["top-hat"],
      explosion: ["pulse"],
    },
    presets: [{ ...starter(), boost: "sparkles" }],
    claimedRocketPass: { "season-1": [3] },
  }),
);
const boostMigration = new Garage();
assert.ok(boostMigration.owns("boost", "plasma"));
assert.ok(
  boostMigration.owns("boost", "sparkles"),
  "preserve an old preset boost",
);
assert.ok(
  boostMigration.owns("boost", "ember"),
  "prior level 3 claims receive their bonus",
);
assert.equal(boostMigration.equip("boost", "lightning"), false);
assert.ok(boostMigration.equip("boost", "ember"));
assert.ok(
  new Garage().owns("boost", "sparkles"),
  "preserved boost survives refresh",
);
assert.equal(
  await boostMigration.claimRocketPass(6, progressionAt(xpAtLevel(5))),
  false,
);
assert.equal(boostMigration.owns("boost", "standard"), false);
assert.equal(
  await boostMigration.claimRocketPass(6, progressionAt(xpAtLevel(6))),
  true,
);
assert.ok(new Garage().owns("boost", "standard"));
assert.equal(
  new Set(
    S.rewards
      .flatMap((r) => [r, ...(r.bonus ?? [])])
      .filter((r) => r.type === "BOOST")
      .map((r) => r.itemId),
  ).size,
  9,
);
// Non-blanket ownership can represent another explicit source of unlocks.
storage.set(
  "octane-arena-garage",
  JSON.stringify({
    inventoryVersion: 1,
    owned: {
      body: ["vector", "lowflat"],
      topper: ["halo"],
      explosion: ["pulse"],
      boost: ["plasma"],
    },
    presets: [starter()],
  }),
);
assert.ok(new Garage().owns("topper", "halo"));
console.log(
  "PASS 25 unique free rewards, Level 10/20 bodies, XP fractions, ownership/equip validation, claims, refresh, multi-tab dedup and legacy migration",
);
