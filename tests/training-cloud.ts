import assert from "node:assert/strict";
import {
  FirebaseTrainingPacks,
  communityPack,
  publicationId,
} from "../src/network/firebase-training";
import { TrainingDraft } from "../src/game/custom-training-editor";
import {
  CustomTrainingLibrary,
  LocalTrainingPackStorage,
} from "../src/game/custom-training";
import { validatePlayablePack } from "../shared/custom-training";
import { readFileSync } from "node:fs";
// Requires local Auth + Firestore emulators. Never contacts the production project.
const project = "demo-octane-training",
  root = "projects/" + project + "/databases/(default)/documents",
  base = "http://127.0.0.1:8087/v1/" + root;
assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST,
  "Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 to run isolated cloud tests.",
);
const loaded = await fetch(
  "http://127.0.0.1:8087/emulator/v1/projects/" + project + ":securityRules",
  {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rules: {
        files: [
          {
            name: "firestore.rules",
            content: readFileSync("firestore.rules", "utf8"),
          },
        ],
      },
    }),
  },
);
assert.equal(loaded.status, 200, await loaded.text());
await fetch(
  "http://127.0.0.1:8087/emulator/v1/projects/" +
    project +
    "/databases/(default)/documents",
  { method: "DELETE" },
);
const config = {
  apiKey: "demo-api-key",
  projectId: project,
  appId: "demo-app",
  authDomain: "localhost",
};
const browser = (instance: string) => {
  const memory = new Map<string, string>();
  return {
    library: new CustomTrainingLibrary(
      new LocalTrainingPackStorage(
        {
          getItem: (k) => memory.get(k) ?? null,
          setItem: (k, v) => void memory.set(k, v),
        },
        "profile-" + instance,
      ),
    ),
    cloud: new FirebaseTrainingPacks(config, {
      authUrl: "http://127.0.0.1:9099",
      host: "127.0.0.1",
      port: 8087,
      instance,
    }),
  };
};
const A = browser("a"),
  B = browser("b");
const rest = (path: string, init: RequestInit = {}, token?: string) =>
  fetch(base + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
  });

// --- Browser A: create a pack (one disabled shot) and publish it.
const draft = new TrainingDraft(A.library.create("Cloud test"));
draft.add();
draft.add();
draft.setEnabled(draft.pack.shots[1].id, false);
let pack = draft.save(A.library, "Owner");
const first = await A.cloud.publish(pack, "Owner");
assert.equal(first.version, 1);
assert.equal(first.documentId, publicationId(first.ownerUid, pack.id));
pack = A.library.markPublished(pack.id, first, pack.updatedAt);
assert.equal(
  A.library.get(pack.id)!.shots.length,
  3,
  "local draft keeps all shots",
);
assert.equal(A.library.get(pack.id)!.shots[1].enabled, false);
const v1 = await (
  await rest("/publishedTrainingPacks/" + first.documentId)
).json();
assert.equal(v1.fields.ownerUid.stringValue, first.ownerUid);
assert.equal(
  v1.fields.shotCount.integerValue,
  "2",
  "only enabled shots are public",
);
assert.deepEqual(Object.keys(v1.fields).sort(), [
  "authorName",
  "createdAt",
  "description",
  "name",
  "ownerUid",
  "packId",
  "published",
  "publishedAt",
  "shotCount",
  "shots",
  "updatedAt",
  "version",
]);

// --- Browser B: browse, see it (not owned), download and validate for playback.
let pageB = await B.cloud.browse();
let listed = pageB.entries.find((e) => e.pack.id === pack.id);
assert.ok(listed, "B sees A's pack");
assert.equal(listed.owned, false);
assert.equal(listed.pack.shots.length, 2);
const pageA = await A.cloud.browse();
assert.equal(pageA.entries.find((e) => e.pack.id === pack.id)?.owned, true);
const downloaded = await B.cloud.download(first.documentId);
assert.equal(validatePlayablePack(downloaded).shots.length, 2);
assert.notEqual(downloaded.ownerUid, undefined);

// --- Browser B tries to modify A's pack through the client: refused before any write.
await assert.rejects(
  B.cloud.publish({ ...downloaded, name: "Hijacked" }, "Thief"),
);
await assert.rejects(B.cloud.unpublish(downloaded));

// --- Browser B bypasses the client entirely (raw REST with its own anonymous token): rules deny.
const signup = await fetch(
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  },
);
const stranger = await signup.json();
assert.ok(stranger.idToken && stranger.localId !== first.ownerUid);
const commit = (writes: unknown[], token = stranger.idToken) =>
  rest(":commit", { method: "POST", body: JSON.stringify({ writes }) }, token);
const stamps = [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }];
assert.equal(
  (
    await rest(
      "/publishedTrainingPacks/" + first.documentId,
      { method: "DELETE" },
      stranger.idToken,
    )
  ).status,
  403,
  "another UID cannot delete",
);
const hijack = structuredClone(v1.fields);
hijack.name = { stringValue: "Hijacked" };
hijack.version = { integerValue: "2" };
delete hijack.updatedAt;
assert.equal(
  (
    await commit([
      { update: { name: v1.name, fields: hijack }, updateTransforms: stamps },
    ])
  ).status,
  403,
  "another UID cannot update",
);
hijack.ownerUid = { stringValue: stranger.localId };
assert.equal(
  (
    await commit([
      { update: { name: v1.name, fields: hijack }, updateTransforms: stamps },
    ])
  ).status,
  403,
  "ownerUid cannot be reassigned",
);
const forged = structuredClone(v1.fields);
forged.packId = { stringValue: "forged" };
forged.version = { integerValue: "1" };
delete forged.updatedAt;
delete forged.createdAt;
delete forged.publishedAt;
const allStamps = ["createdAt", "updatedAt", "publishedAt"].map(
  (fieldPath) => ({
    fieldPath,
    setToServerValue: "REQUEST_TIME",
  }),
);
assert.equal(
  (
    await commit([
      {
        update: {
          name: root + "/publishedTrainingPacks/" + first.ownerUid + "_forged",
          fields: forged,
        },
        currentDocument: { exists: false },
        updateTransforms: allStamps,
      },
    ])
  ).status,
  403,
  "cannot create a pack claiming someone else's ownerUid",
);
forged.ownerUid = { stringValue: stranger.localId };
const ownForged =
  root + "/publishedTrainingPacks/" + stranger.localId + "_forged";
forged.extra = { stringValue: "injected" };
assert.equal(
  (
    await commit([
      {
        update: { name: ownForged, fields: forged },
        currentDocument: { exists: false },
        updateTransforms: allStamps,
      },
    ])
  ).status,
  403,
  "extra fields rejected",
);
delete forged.extra;
forged.name = { stringValue: "x".repeat(41) };
assert.equal(
  (
    await commit([
      {
        update: { name: ownForged, fields: forged },
        currentDocument: { exists: false },
        updateTransforms: allStamps,
      },
    ])
  ).status,
  403,
  "oversized name rejected",
);
forged.name = { stringValue: "Legit" };
forged.shotCount = { integerValue: "51" };
assert.equal(
  (
    await commit([
      {
        update: { name: ownForged, fields: forged },
        currentDocument: { exists: false },
        updateTransforms: allStamps,
      },
    ])
  ).status,
  403,
  "shot count limit enforced",
);
forged.shotCount = v1.fields.shotCount;
const clientTime = { timestampValue: "2000-01-01T00:00:00Z" };
assert.equal(
  (
    await commit([
      {
        update: {
          name: ownForged,
          fields: { ...forged, createdAt: clientTime, publishedAt: clientTime },
        },
        currentDocument: { exists: false },
        updateTransforms: [stamps[0]],
      },
    ])
  ).status,
  403,
  "client-chosen timestamps rejected",
);
assert.equal(
  (
    await commit([
      {
        update: { name: ownForged, fields: forged },
        currentDocument: { exists: false },
        updateTransforms: allStamps,
      },
    ])
  ).status,
  200,
  "a well-formed pack owned by the caller is accepted",
);
assert.equal(
  (await rest("/publishedTrainingPacks")).status,
  403,
  "unbounded list denied",
);

// --- Browser A updates the same pack: same document, version 2, original publication time kept.
A.library.rename(pack.id, "Cloud test updated");
pack = A.library.get(pack.id)!;
const second = await A.cloud.publish(pack, "Owner");
assert.equal(second.version, 2);
assert.equal(
  second.documentId,
  first.documentId,
  "update targets the same document",
);
assert.equal(second.publishedAt, first.publishedAt, "publishedAt preserved");
pack = A.library.markPublished(pack.id, second, pack.updatedAt);
const v2 = await (
  await rest("/publishedTrainingPacks/" + first.documentId)
).json();
assert.equal(
  v2.fields.createdAt.timestampValue,
  v1.fields.createdAt.timestampValue,
);
assert.ok(
  v2.fields.updatedAt.timestampValue > v1.fields.updatedAt.timestampValue,
);
pageB = await B.cloud.browse();
listed = pageB.entries.find((e) => e.pack.id === pack.id);
assert.equal(listed?.pack.name, "Cloud test updated", "B sees the update");
assert.equal(listed?.pack.publishedVersion, 2);
assert.equal(
  pageB.entries.filter((e) => e.pack.id === pack.id).length,
  1,
  "no duplicate public copies",
);

// --- Rapid repeated publish of another pack still yields exactly one document.
const rapid = new TrainingDraft(A.library.create("Rapid"));
const rapidPack = rapid.save(A.library, "Owner");
const results = await Promise.allSettled(
  [1, 2, 3].map(() => A.cloud.publish(rapidPack, "Owner")),
);
assert.ok(results.some((r) => r.status === "fulfilled"));
const rapidDocs = (await B.cloud.browse()).entries.filter(
  (e) => e.pack.id === rapidPack.id,
);
assert.equal(rapidDocs.length, 1, "repeated publish never duplicates");

// --- Malicious document written behind the rules (emulator admin): skipped when browsing, rejected on download.
const evil = structuredClone(v2.fields);
evil.packId = { stringValue: "evil" };
evil.shots.arrayValue.values[0].mapValue.fields.carVelocity.mapValue.fields.x =
  { doubleValue: "NaN" };
evil.updatedAt = { timestampValue: new Date(Date.now() + 60000).toISOString() };
const adminWrite = await fetch(
  base + "/publishedTrainingPacks?documentId=" + first.ownerUid + "_evil",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer owner",
    },
    body: JSON.stringify({ fields: evil }),
  },
);
assert.equal(adminWrite.status, 200, await adminWrite.text());
const withEvil = await B.cloud.browse();
assert.ok(withEvil.skipped >= 1, "malformed pack skipped");
assert.ok(!withEvil.entries.some((e) => e.pack.id === "evil"));
await assert.rejects(B.cloud.download(first.ownerUid + "_evil"));
assert.throws(() =>
  communityPack({ published: true, ownerUid: "a", shotCount: 999 }, "bad"),
);

// --- Pagination: 20 per page, LOAD MORE cursor, updatedAt descending, no overlap.
for (let i = 0; i < 21; i++) {
  const d = new TrainingDraft(A.library.create("Bulk " + i));
  await A.cloud.publish(d.save(A.library, "Owner"), "Owner");
}
const page1 = await B.cloud.browse();
assert.equal(page1.entries.length + page1.skipped, 20);
assert.ok(page1.cursor, "more results available");
const page2 = await B.cloud.browse(page1.cursor);
const ids1 = new Set(page1.entries.map((e) => e.pack.id));
assert.ok(
  page2.entries.length > 0 && page2.entries.every((e) => !ids1.has(e.pack.id)),
);
const times = [...page1.entries, ...page2.entries].map((e) => e.pack.updatedAt);
assert.deepEqual(
  times,
  [...times].sort((a, b) => b - a),
  "updatedAt descending",
);

// --- Browser A unpublishes: public copy removed, local pack kept and editable.
await A.cloud.unpublish(pack);
const local = A.library.markUnpublished(pack.id);
assert.equal(local.shots.length, 3);
assert.notEqual(
  (await rest("/publishedTrainingPacks/" + first.documentId)).status,
  200,
);
assert.ok(!(await B.cloud.browse()).entries.some((e) => e.pack.id === pack.id));
await A.cloud.unpublish({ ...pack }); // already gone: no error
await assert.rejects(B.cloud.download(first.documentId));
const again = await A.cloud.publish(local, "Owner");
assert.equal(
  again.version,
  1,
  "republishing after unpublish starts a fresh version",
);

// --- Feedback reports: unchanged create-only behaviour.
assert.equal(
  (await rest("/feedbackReports")).status,
  403,
  "feedback read remains denied",
);
const feedback = (extra: Record<string, unknown> = {}) =>
  commit(
    [
      {
        update: {
          name: root + "/feedbackReports/test-report-" + crypto.randomUUID(),
          fields: {
            username: { stringValue: "Guest" },
            reportType: { stringValue: "Bug" },
            description: { stringValue: "Emulator report" },
            gameVersion: { stringValue: "V0.2.2" },
            screen: { stringValue: "home" },
            mode: { stringValue: "home" },
            ...extra,
          },
        },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
        ],
      },
    ],
    undefined,
  );
const okFeedback = await feedback();
assert.equal(okFeedback.status, 200, await okFeedback.text());
assert.equal((await feedback({ extra: { stringValue: "x" } })).status, 403);
console.log(
  "PASS real Auth/Firestore emulators: two anonymous browsers; publish enabled-only, browse/download/play-validate from B, B update/delete/forge denied by client and rules, A update keeps same doc+publishedAt, no duplicates on rapid publish, malformed doc skipped/rejected, 20-per-page updatedAt pagination, unpublish keeps local pack, feedback create-only preserved.",
);
process.exit(0);
