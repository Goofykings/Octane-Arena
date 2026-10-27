import assert from "node:assert/strict";
import {
  parsePublishedPack,
  publicationStatus,
  serializePublishedPack,
  type CustomTrainingPack,
} from "../shared/custom-training";
import { defaultTrainingShot } from "../src/game/custom-training-editor";
import { trainingCloudError } from "../src/network/firebase-training";
import {
  CustomTrainingLibrary,
  LocalTrainingPackStorage,
} from "../src/game/custom-training";
const shot = (id: string, enabled = true) => ({
  ...defaultTrainingShot(1000),
  id,
  enabled,
});
const pack = (shots = [shot("s1"), shot("s2", false), shot("s3")]) =>
  ({
    id: "pack-1",
    name: "  Wall Reads ",
    createdAt: 1,
    updatedAt: 2,
    published: false,
    version: 1,
    authorName: "Local",
    shots,
  }) as CustomTrainingPack;

// Serialization: enabled shots only, exact public keys, local draft untouched.
const draft = pack();
const payload = serializePublishedPack(draft, " Maxwell ");
assert.equal(draft.shots.length, 3, "local draft keeps disabled shots");
assert.deepEqual(
  payload.shots.map((s) => s.id),
  ["s1", "s3"],
);
assert.equal(payload.shotCount, 2);
assert.equal(payload.name, "Wall Reads");
assert.equal(payload.authorName, "Maxwell");
assert.equal(payload.description, "");
assert.deepEqual(Object.keys(payload).sort(), [
  "authorName",
  "description",
  "name",
  "packId",
  "shotCount",
  "shots",
]);
assert.deepEqual(Object.keys(payload.shots[0]).sort(), [
  "ballAngularVelocity",
  "ballLaunchDirection",
  "ballLaunchSpeed",
  "ballPosition",
  "carPosition",
  "carRotation",
  "carVelocity",
  "enabled",
  "id",
  "name",
  "timeLimit",
]);
const injected = pack([{ ...shot("s1"), evil: "x", mesh: {} } as never]);
assert.ok(!("evil" in serializePublishedPack(injected, "A").shots[0]));

// Publishing refuses invalid local data instead of trusting it.
const rejects = (p: unknown, author = "A") =>
  assert.throws(() => serializePublishedPack(p, author));
rejects(pack([shot("s1", false)]));
rejects(pack([]));
rejects({ ...pack(), id: "../../etc" });
rejects(pack([{ ...shot("s1"), id: "bad id!" }]));
rejects({ ...pack(), name: "x".repeat(41) });
rejects({ ...pack(), description: "x".repeat(251) });
rejects(pack(), "x".repeat(21));
rejects(pack(), "   ");
rejects(pack(Array.from({ length: 51 }, (_, i) => shot("s" + i))));
rejects(pack([{ ...shot("s1"), carVelocity: { x: NaN, y: 0, z: 0 } }]));
rejects(pack([{ ...shot("s1"), ballLaunchSpeed: Infinity }]));
assert.equal(
  serializePublishedPack(
    pack(Array.from({ length: 50 }, (_, i) => shot("s" + i))),
    "A",
  ).shotCount,
  50,
);

// Downloaded documents are untrusted: everything malformed is rejected before physics.
const ts = (ms: number) => ({ toMillis: () => ms });
const remote = {
  ...payload,
  ownerUid: "uid-a",
  version: 3,
  published: true,
  createdAt: ts(10),
  updatedAt: ts(30),
  publishedAt: ts(10),
};
const parsed = parsePublishedPack(remote, "uid-a_pack-1");
assert.equal(parsed.shots.length, 2);
assert.equal(parsed.publishedVersion, 3);
assert.equal(parsed.updatedAt, 30);
assert.equal(parsed.ownerUid, "uid-a");
const bad = (change: Record<string, unknown>, id = "uid-a_pack-1") =>
  assert.throws(() => parsePublishedPack({ ...remote, ...change }, id));
const firstShot = remote.shots[0];
bad({
  shots: [{ ...firstShot, carVelocity: { x: NaN, y: 0, z: 0 } }],
  shotCount: 1,
});
bad({
  shots: [{ ...firstShot, carPosition: { x: 1e9, y: 0, z: 0 } }],
  shotCount: 1,
});
bad({
  shots: [{ ...firstShot, ballPosition: { x: 0, y: -50, z: 0 } }],
  shotCount: 1,
});
bad({ shots: [{ ...firstShot, carRotation: undefined }], shotCount: 1 });
bad({
  shots: [{ ...firstShot, carRotation: { x: 0, y: 0, z: 0, w: 5 } }],
  shotCount: 1,
});
bad({
  shots: [{ ...firstShot, ballLaunchDirection: { x: 0, y: 0 } }],
  shotCount: 1,
});
bad({ shots: [{ ...firstShot, ballLaunchDirection: "up" }], shotCount: 1 });
bad({
  shots: [{ ...firstShot, carVelocity: { x: 1e6, y: 0, z: 0 } }],
  shotCount: 1,
});
bad({ shots: [{ ...firstShot, ballLaunchSpeed: 1e6 }], shotCount: 1 });
bad({ shots: [{ ...firstShot, id: "<script>" }], shotCount: 1 });
bad({ shots: Array.from({ length: 500 }, () => firstShot), shotCount: 500 });
bad({ shotCount: 7 });
bad({ name: "x".repeat(5000) });
bad({ authorName: "" });
bad({ description: "x".repeat(251) });
bad({ published: false });
bad({ ownerUid: 42 });
bad({ version: 1.5 });
bad({ updatedAt: "yesterday" });
bad({}, "../escape");
assert.throws(() => parsePublishedPack(null, "uid-a_pack-1"));
assert.throws(() => parsePublishedPack("pack", "uid-a_pack-1"));

// Local publication state and unpublish keep the local pack.
assert.equal(publicationStatus(pack()), "DRAFT");
const memory = new Map<string, string>();
const library = new CustomTrainingLibrary(
  new LocalTrainingPackStorage(
    {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
    },
    "publish-test",
  ),
);
const local = library.create("Status");
library.saveDraft({ ...local, shots: [shot("a"), shot("b", false)] });
const saved = library.get(local.id)!;
library.markPublished(
  local.id,
  {
    documentId: "uid_" + local.id,
    ownerUid: "uid",
    version: 1,
    publishedAt: 5,
  },
  saved.updatedAt,
);
assert.equal(publicationStatus(library.get(local.id)!), "PUBLISHED");
library.rename(local.id, "Status 2");
assert.equal(
  publicationStatus(library.get(local.id)!),
  "PUBLISHED • LOCAL CHANGES",
);
const unpublished = library.markUnpublished(local.id);
assert.equal(publicationStatus(unpublished), "DRAFT");
assert.equal(unpublished.shots.length, 2, "unpublish keeps local shots");
assert.equal(unpublished.ownerUid, undefined);
assert.equal(unpublished.publishedVersion, undefined);
// Anonymous Auth disabled in the Firebase project gives an actionable message, not a crash.
for (const code of [
  "auth/operation-not-allowed",
  "auth/admin-restricted-operation",
])
  assert.match(trainingCloudError({ code }), /enable Anonymous sign-in/);
assert.match(trainingCloudError({ code: "unavailable" }), /local pack is safe/);
console.log(
  "PASS training publishing: enabled-only exact-key payload, publish limits, malicious remote data rejected, publication states.",
);
