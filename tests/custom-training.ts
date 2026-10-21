import assert from "node:assert/strict";
import {
  CustomTrainingLibrary,
  LocalTrainingPackStorage,
} from "../src/game/custom-training";
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
let time = 100,
  sequence = 0;
const adapter = new LocalTrainingPackStorage(storage, "profile-a");
const library = new CustomTrainingLibrary(
  adapter,
  () => time++,
  () => "pack-" + ++sequence,
);
assert.deepEqual(library.list(), []);
assert.throws(() => library.create("   "));
assert.throws(() => library.create("x".repeat(41)));
const first = library.create("  Aerial Warmup!  "),
  second = library.create("Goalie's Practice #2");
assert.equal(first.name, "Aerial Warmup!");
assert.notEqual(first.id, second.id);
assert.deepEqual(first.shots, []);
assert.equal(first.published, false);
const reopened = new CustomTrainingLibrary(adapter, () => time++);
assert.equal(reopened.list().length, 2);
reopened.markPublished(
  second.id,
  {
    documentId: "owner_" + second.id,
    ownerUid: "owner",
    version: 1,
    publishedAt: time++,
  },
  reopened.get(second.id)!.updatedAt,
);
assert.equal(library.get(second.id)?.published, true);
reopened.rename(first.id, "Renamed");
assert.equal(library.get(first.id)?.name, "Renamed");
assert.ok(library.get(first.id)!.updatedAt > first.createdAt);
const snapshot = library.list();
snapshot[0].name = "bad";
assert.equal(library.get(first.id)?.name, "Renamed");
library.delete(first.id);
assert.deepEqual(
  reopened.list().map((p) => p.id),
  [second.id],
);
reopened.markUnpublished(second.id);
assert.equal(library.get(second.id)?.published, false);
assert.equal(
  new CustomTrainingLibrary(
    new LocalTrainingPackStorage(storage, "profile-b"),
  ).list().length,
  0,
);
assert.throws(() => library.rename("missing", "Name"));
library.delete(second.id);
assert.deepEqual(reopened.list(), []);
storage.setItem(adapter.key, "corrupt");
assert.throws(() => library.create("Do not erase"));
assert.equal(storage.getItem(adapter.key), "corrupt");
const failing = new CustomTrainingLibrary({
  read: () => [],
  write: () => {
    throw new Error("Quota exceeded");
  },
});
assert.throws(() => failing.create("Not saved"), /Quota/);
console.log(
  "Custom training persistence, validation, identity, publish, rename, delete and storage failures passed.",
);

// LAN HTTP pages may lack randomUUID; reuse the profile UUID fallback.
const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
Object.defineProperty(crypto, "randomUUID", {
  configurable: true,
  value: undefined,
});
try {
  const lanLibrary = new CustomTrainingLibrary(
    new LocalTrainingPackStorage(storage, "lan-profile"),
  );
  const pack = lanLibrary.create("LAN practice");
  assert.match(
    pack.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(lanLibrary.create("Another LAN pack").id, pack.id);
} finally {
  if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
  else Reflect.deleteProperty(crypto, "randomUUID");
}
