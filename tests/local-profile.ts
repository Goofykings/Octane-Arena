import assert from "node:assert/strict";
import { LocalProfile, localProfileKey } from "../src/game/local-profile";
import {
  profileIdentitySchema,
  displayIdentity,
  defaultAvatarColor,
} from "../shared/local-profile";
const data = new Map<string, string>();
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    data.set(key, value);
  },
};
const profile = new LocalProfile(storage),
  id = profile.value.localPlayerId;
profile.customize("  GoofyKing  ", "fox", "#ed9ed8");
assert.equal(profile.value.name, "GoofyKing");
assert.equal(profile.value.avatarId, "fox");
assert.equal(profile.value.avatarColor, "#ED9ED8");
assert.equal(displayIdentity(profile.value), "GoofyKing");
assert.equal("tag" in profile.value, false);
for (const name of ["", " ", "a".repeat(21), "bad\u0001name"])
  assert.equal(profileIdentitySchema.safeParse({ name }).success, false);
for (const avatarColor of ["", "red", "#fff", "#GGFFFF", "red;display:none"])
  assert.equal(
    profileIdentitySchema.safeParse({ name: "Guest", avatarColor }).success,
    false,
  );
assert.equal(
  profileIdentitySchema.safeParse({ name: "Guest", avatarId: "unknown" })
    .success,
  false,
);
profile.observeMatch("match-1", id, 0, "goal", [1, 0], {
  scorerId: id,
  ownGoal: false,
});
profile.observeMatch("match-1", id, 0, "goal", [1, 0], {
  scorerId: id,
  ownGoal: false,
});
profile.observeMatch("match-1", id, 0, "finished", [1, 0]);
profile.observeMatch("match-2", id, 0, "goal", [0, 1], {
  scorerId: id,
  ownGoal: true,
});
profile.observeMatch("match-2", id, 0, "finished", [0, 1]);
profile.addPlayTime(61);
profile.save();
const loaded = new LocalProfile(storage);
profile.customize("Updated");
loaded.flush();
assert.equal(
  JSON.parse(data.get(localProfileKey)!).name,
  "Updated",
  "Idle tab must not overwrite newer profile edits",
);
assert.equal(loaded.value.localPlayerId, id);
assert.equal(loaded.value.name, "GoofyKing");
assert.equal(loaded.value.avatarId, "fox");
assert.equal(loaded.value.avatarColor, "#ED9ED8");
assert.deepEqual(loaded.value.stats, {
  matchesPlayed: 2,
  wins: 1,
  losses: 1,
  goals: 1,
  playTime: 61,
});
loaded.observeMatch("match-1", id, 0, "finished", [1, 0]);
assert.equal(loaded.value.stats.matchesPlayed, 2);
loaded.reset();
assert.equal(loaded.value.localPlayerId, id);
assert.equal(loaded.value.name, "Guest");
assert.equal(loaded.value.avatarId, "helmet");
assert.equal(loaded.value.avatarColor, defaultAvatarColor);
assert.equal(loaded.value.stats.goals, 0);
for (const invalid of [
  "broken",
  "null",
  JSON.stringify({ stats: { wins: -4, goals: "20" }, localPlayerId: "bad" }),
]) {
  data.set(localProfileKey, invalid);
  const recovered = new LocalProfile(storage);
  assert.equal(recovered.value.stats.wins, 0);
  assert.equal(recovered.value.name, "Guest");
}
const unavailable = new LocalProfile({
  getItem: () => {
    throw Error();
  },
  setItem: () => {
    throw Error();
  },
});
unavailable.customize("Session", "comet", "#75DBA6");
assert.equal(unavailable.value.name, "Session");
assert.equal(unavailable.persistent, false);
data.set(
  localProfileKey,
  JSON.stringify({
    localPlayerId: id,
    name: "Legacy",
    tag: "OLD",
    stats: { goals: 3 },
    avatarId: "unknown",
    avatarColor: "invalid",
  }),
);
const migrated = new LocalProfile(storage);
assert.equal(migrated.value.localPlayerId, id);
assert.equal(migrated.value.name, "Legacy");
assert.equal(migrated.value.stats.goals, 3);
assert.equal(migrated.value.avatarId, "helmet");
assert.equal(migrated.value.avatarColor, defaultAvatarColor);
assert.equal("tag" in JSON.parse(data.get(localProfileKey)!), false);
console.log(
  "PASS local identity validation, persistence, stable ID, real event deduplication, stats, reset and corrupt/unavailable storage",
);
