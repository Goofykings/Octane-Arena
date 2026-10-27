import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firestoreFeedbackWriter } from "../src/network/firebase-feedback";
import { FeedbackService, feedbackError } from "../src/game/feedback";
// Requires the local Firestore emulator. Never contacts a real project.
const project = "demo-octane-feedback-cloud",
  emulator = "http://127.0.0.1:8087",
  docs =
    emulator + "/v1/projects/" + project + "/databases/(default)/documents";
assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST,
  "Run inside `firebase emulators:exec` (FIRESTORE_EMULATOR_HOST unset).",
);
const rules = readFileSync("firestore.rules", "utf8");
const loadRules = async (content: string) => {
  const r = await fetch(
    emulator + "/emulator/v1/projects/" + project + ":securityRules",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rules: { files: [{ name: "firestore.rules", content }] },
      }),
    },
  );
  assert.equal(r.status, 200, await r.text());
};
await loadRules(rules);
await fetch(
  emulator +
    "/emulator/v1/projects/" +
    project +
    "/databases/(default)/documents",
  {
    method: "DELETE",
  },
);
// Admin listing (bypasses rules) to count what actually landed.
const stored = async () => {
  const r = await fetch(docs + "/feedbackReports", {
    headers: { Authorization: "Bearer owner" },
  });
  return ((await r.json()).documents ?? []) as {
    name: string;
    fields: Record<string, Record<string, string>>;
  }[];
};
const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
};
const writer = firestoreFeedbackWriter(
  { apiKey: "demo-key", projectId: project, appId: "demo-app" },
  { host: "127.0.0.1", port: 8087 },
);
const report = {
  username: "Maxwell",
  reportType: "Bug" as const,
  description: "Test feedback submission",
  gameVersion: "V0.2.2",
  screen: "home",
  mode: "home",
};

// Requested test case: one document, exact schema, server timestamp.
const service = new FeedbackService(writer, storage);
const first = service.submit(report);
await assert.rejects(service.submit(report), /already being submitted/);
await first;
await assert.rejects(service.submit(report), /Please wait/);
const docsAfter = await stored();
assert.equal(docsAfter.length, 1, "exactly one feedbackReports document");
const [doc] = docsAfter;
assert.match(doc.name, /\/feedbackReports\/[A-Za-z0-9]{20}$/, "generated ID");
assert.deepEqual(Object.keys(doc.fields).sort(), [
  "createdAt",
  "description",
  "gameVersion",
  "mode",
  "reportType",
  "screen",
  "username",
]);
assert.equal(doc.fields.reportType.stringValue, "Bug");
assert.equal(doc.fields.description.stringValue, "Test feedback submission");
assert.ok(
  doc.fields.createdAt.timestampValue,
  "createdAt is a Firestore timestamp",
);
const age = Date.now() - Date.parse(doc.fields.createdAt.timestampValue);
assert.ok(Math.abs(age) < 60_000, "createdAt is the server's request time");

// Security unchanged: no reads, updates or deletes for anyone.
assert.equal((await fetch(docs + "/feedbackReports")).status, 403);
const id = doc.name.split("/").pop();
assert.equal(
  (await fetch(docs + "/feedbackReports/" + id, { method: "DELETE" })).status,
  403,
);

// Forced rejection: same payload, rules that refuse every create.
await loadRules(
  rules.replace("allow create: if validReport();", "allow create: if false;"),
);
const logged: unknown[] = [];
const original = console.error;
console.error = (...args: unknown[]) => void logged.push(args);
const failing = new FeedbackService(writer, new Map() as never);
let failure: unknown;
try {
  await failing.submit(report);
} catch (e) {
  failure = e;
} finally {
  console.error = original;
}
assert.ok(failure, "rejected write is not reported as success");
assert.equal((failure as { code?: string }).code, "permission-denied");
assert.match(feedbackError(failure), /^REPORT FAILED\./);
assert.equal(failing.cooldownSeconds, 0, "no success cooldown after a failure");
const entry = logged.flat().find((x) => typeof x === "object") as Record<
  string,
  unknown
>;
assert.equal(entry.code, "permission-denied");
assert.equal(entry.projectId, project);
assert.equal(entry.collection, "feedbackReports");
assert.ok(!JSON.stringify(entry).includes("demo-key"), "no API key in logs");
assert.equal((await stored()).length, 1, "failed write adds nothing");
await loadRules(rules);
console.log(
  "PASS feedback emulator: one feedbackReports/{autoId} doc with exactly username/reportType/description/gameVersion/screen/mode/createdAt(server time), no duplicates, read/delete denied, forced rejection logged (code/projectId/collection) and surfaced as REPORT FAILED with no cooldown.",
);
process.exit(0);
