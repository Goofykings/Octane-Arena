import assert from "node:assert/strict";
import {
  FirebaseTrainingPacks,
  communityPack,
} from "../src/network/firebase-training";
import { TrainingDraft } from "../src/game/custom-training-editor";
import {
  CustomTrainingLibrary,
  LocalTrainingPackStorage,
} from "../src/game/custom-training";
import { readFileSync } from "node:fs";
// Requires local Auth + Firestore emulators. Never contacts the production project.
const project = "demo-octane-training",
  base =
    "http://127.0.0.1:8087/v1/projects/" +
    project +
    "/databases/(default)/documents";
assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST,
  "Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 to run isolated cloud tests.",
);
const rules = readFileSync("firestore.rules", "utf8");
const loaded = await fetch(
  "http://127.0.0.1:8087/emulator/v1/projects/" + project + ":securityRules",
  {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rules: { files: [{ name: "firestore.rules", content: rules }] },
    }),
  },
);
assert.equal(loaded.status, 200, await loaded.text());
const memory = new Map<string, string>();
const library = new CustomTrainingLibrary(
  new LocalTrainingPackStorage(
    {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => {
        memory.set(k, v);
      },
    },
    "cloud-test",
  ),
);
const created = library.create("Cloud test");
const draft = new TrainingDraft(created);
draft.add();
draft.add();
draft.setEnabled(draft.pack.shots[1].id, false);
let pack = draft.save(library, "Owner");
const cloud = new FirebaseTrainingPacks(
  {
    apiKey: "demo-api-key",
    projectId: project,
    appId: "demo-app",
    authDomain: "localhost",
  },
  { authUrl: "http://127.0.0.1:9099", host: "127.0.0.1", port: 8087 },
);
const published = await cloud.publish(pack, "Owner");
assert.equal(published.version, 1);
pack = library.markPublished(pack.id, published, pack.updatedAt);
assert.equal(library.get(pack.id)!.shots.length, 3);
assert.equal(library.get(pack.id)!.shots[1].enabled, false);
const page = await cloud.browse();
assert.ok(page.packs.some((p) => p.id === pack.id && p.shots.length === 2));
const raw = await fetch(
  base + "/publishedTrainingPacks/" + published.documentId,
);
assert.equal(raw.status, 200);
const publicDoc = await raw.json();
const signup = await fetch(
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  },
);
const stranger = await signup.json();
assert.ok(stranger.idToken);
assert.notEqual(stranger.localId, published.ownerUid);
const foreignDelete = await fetch(
  base + "/publishedTrainingPacks/" + published.documentId,
  {
    method: "DELETE",
    headers: { Authorization: "Bearer " + stranger.idToken },
  },
);
assert.equal(foreignDelete.status, 403, "Another anonymous UID cannot delete");
const fields = structuredClone(publicDoc.fields);
fields.name = { stringValue: "Hijacked" };
fields.ownerUid = { stringValue: stranger.localId };
fields.version = { integerValue: "2" };
delete fields.updatedAt;
delete fields.publishedAt;
const foreignUpdate = await fetch(base + ":commit", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + stranger.idToken,
  },
  body: JSON.stringify({
    writes: [
      {
        update: { name: publicDoc.name, fields },
        updateTransforms: [
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
          { fieldPath: "publishedAt", setToServerValue: "REQUEST_TIME" },
        ],
      },
    ],
  }),
});
assert.equal(foreignUpdate.status, 403, "Owner UID cannot be changed");
const anonymousQuery = await fetch(base + ":runQuery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: "publishedTrainingPacks" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "published" },
          op: "EQUAL",
          value: { booleanValue: true },
        },
      },
      limit: 21,
    },
  }),
});
assert.equal(anonymousQuery.status, 200);
const unlimited = await fetch(base + "/publishedTrainingPacks");
assert.equal(unlimited.status, 403, "Unbounded/unfiltered list denied");
library.rename(pack.id, "Cloud test updated");
pack = library.get(pack.id)!;
const updated = await cloud.publish(pack, "Owner");
assert.equal(updated.version, 2);
pack = library.markPublished(pack.id, updated, pack.updatedAt);
assert.equal(
  (await cloud.browse()).packs.find((p) => p.id === pack.id)?.name,
  "Cloud test updated",
);
assert.throws(() =>
  communityPack({ published: true, ownerUid: "a", shotCount: 999 }, "bad"),
);
const feedbackRead = await fetch(base + "/feedbackReports");
assert.equal(feedbackRead.status, 403, "Feedback read remains denied");
const feedbackFields = {
  username: { stringValue: "Guest" },
  reportType: { stringValue: "Bug" },
  description: { stringValue: "Emulator report" },
  gameVersion: { stringValue: "V0.2.2" },
  screen: { stringValue: "home" },
  mode: { stringValue: "home" },
};
const feedbackWrite = await fetch(base + ":commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    writes: [
      {
        update: {
          name:
            "projects/" +
            project +
            "/databases/(default)/documents/feedbackReports/test-report-" +
            crypto.randomUUID(),
          fields: feedbackFields,
        },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
        ],
      },
    ],
  }),
});
assert.equal(feedbackWrite.status, 200, await feedbackWrite.text());
await cloud.unpublish(pack);
const missing = await fetch(
  base + "/publishedTrainingPacks/" + published.documentId,
);
assert.notEqual(missing.status, 200);
assert.ok(!(await cloud.browse()).packs.some((p) => p.id === pack.id));
console.log(
  "PASS real Auth/Firestore emulators: anonymous publish, enabled-only public read with all local shots retained, second UID update/delete denied, version update, unpublish, bounded query, malformed data rejected and feedback create-only preserved.",
);
process.exit(0);
