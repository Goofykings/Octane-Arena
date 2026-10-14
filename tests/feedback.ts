import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_COOLDOWN_MS,
  feedbackTypes,
  feedbackSchema,
  type FeedbackReport,
} from "../shared/feedback";
import {
  FeedbackService,
  feedbackCooldownKey,
  feedbackError,
} from "../src/game/feedback";
import { firestoreFeedbackWriter } from "../src/network/firebase-feedback";
import { firebaseConfigured } from "../src/config/firebase";
import { RE2JS } from "re2js";
const report: FeedbackReport = {
  username: "Circuit",
  reportType: "Bug",
  description: "  The car clips into the goal.  ",
  gameVersion: "0.1.9",
  screen: "home",
  mode: "home",
};
const data = new Map<string, string>(),
  storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
let now = 1_000_000,
  calls = 0,
  delivered: FeedbackReport | null = null;
const service = new FeedbackService(
  async (value) => {
    calls++;
    delivered = value;
  },
  storage,
  () => now,
);
for (const description of [
  "",
  "   " + String.fromCharCode(10) + "  ",
  "x".repeat(FEEDBACK_MAX_LENGTH + 1),
])
  await assert.rejects(service.submit({ ...report, description }));
assert.equal(calls, 0);
assert.equal(service.pending, false);
assert.equal(service.cooldownSeconds, 0);
await service.submit(report);
assert.equal(calls, 1);
assert.equal(
  (delivered as unknown as FeedbackReport).description,
  "The car clips into the goal.",
);
assert.equal(service.cooldownSeconds, 120);
assert.equal(Number(data.get(feedbackCooldownKey)), now);
await assert.rejects(service.submit(report), /wait/);
assert.equal(calls, 1);
const reloaded = new FeedbackService(
  async () => {
    calls++;
  },
  storage,
  () => now,
);
assert.equal(reloaded.cooldownSeconds, 120);
now += FEEDBACK_COOLDOWN_MS - 1;
assert.equal(service.cooldownSeconds, 1);
now++;
assert.equal(service.cooldownSeconds, 0);
for (const reportType of feedbackTypes) {
  await service.submit({ ...report, reportType });
  assert.equal((delivered as unknown as FeedbackReport).reportType, reportType);
  now += FEEDBACK_COOLDOWN_MS;
}
assert.equal(
  feedbackSchema.safeParse({ ...report, reportType: "Invalid" }).success,
  false,
);
assert.equal(
  feedbackSchema.safeParse({ ...report, extra: "not permitted" }).success,
  false,
);
let resolve!: () => void;
const slow = new FeedbackService(
  () => {
    calls++;
    return new Promise<void>((done) => (resolve = done));
  },
  undefined,
  () => now,
);
const before = calls,
  pending = slow.submit(report);
assert.equal(slow.pending, true);
await assert.rejects(slow.submit(report), /already/);
assert.equal(calls, before + 1);
assert.equal(slow.cooldownSeconds, 0);
resolve();
await pending;
assert.equal(slow.pending, false);
assert.equal(slow.cooldownSeconds, 120);
let attempts = 0;
const failed = new FeedbackService(
  async () => {
    attempts++;
    throw { code: "unavailable" };
  },
  undefined,
  () => now,
);
await assert.rejects(failed.submit(report));
assert.equal(failed.pending, false);
assert.equal(failed.cooldownSeconds, 0);
await assert.rejects(failed.submit(report));
assert.equal(attempts, 2);
const unavailableStore = {
  getItem() {
    throw Error("blocked");
  },
  setItem() {
    throw Error("blocked");
  },
};
const memoryOnly = new FeedbackService(
  async () => {},
  unavailableStore,
  () => now,
);
await memoryOnly.submit(report);
assert.equal(memoryOnly.cooldownSeconds, 120);
assert.ok(
  feedbackError({ code: "firestore/permission-denied" }).includes(
    "unavailable",
  ),
);
assert.ok(feedbackError({ code: "resource-exhausted" }).includes("busy"));
assert.ok(
  feedbackError(new Error("private backend stack")).includes(
    "Your text has been kept",
  ),
);
assert.ok(feedbackError({ code: 13 }).includes("Your text has been kept"));
assert.equal(firebaseConfigured({}), false);
await assert.rejects(firestoreFeedbackWriter({})(report), /not configured/);
// Inspect a real SDK write against a mocked HTTP endpoint: no real Firebase account or writes.
const fetchBefore = globalThis.fetch,
  requests: { url: string; body: any; method: string }[] = [];
let deny = false;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  requests.push({
    url,
    body: JSON.parse(String(init!.body)),
    method: init!.method!,
  });
  if (deny)
    return new Response(
      JSON.stringify({
        error: { code: 403, status: "PERMISSION_DENIED", message: "Denied" },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  return new Response(
    JSON.stringify({
      commitTime: "2026-10-13T12:00:00.000000Z",
      writeResults: [
        {
          updateTime: "2026-10-13T12:00:00.000000Z",
          transformResults: [{ timestampValue: "2026-10-13T12:00:00.000000Z" }],
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
try {
  const writer = firestoreFeedbackWriter({
    apiKey: "demo-web-key",
    appId: "1:123:web:demo",
    projectId: "demo-octane-feedback",
  });
  await writer(feedbackSchema.parse(report));
  assert.equal(requests.length, 1);
  const request = requests[0],
    write = request.body.writes[0];
  assert.equal(request.method, "POST");
  assert.ok(request.url.includes("/documents:commit"));
  assert.ok(write.update.name.includes("/feedbackReports/"));
  assert.equal(
    write.currentDocument.exists,
    false,
    "SDK creation cannot overwrite an existing document",
  );
  assert.deepEqual(write.updateTransforms, [
    { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
  ]);
  for (const [key, value] of Object.entries(feedbackSchema.parse(report)))
    assert.equal(write.update.fields[key].stringValue, value);
  assert.equal(
    write.update.fields.createdAt,
    undefined,
    "timestamp is server-generated, not a local clock string",
  );
  deny = true;
  await assert.rejects(
    writer(report),
    (e: any) => e.code === "permission-denied",
  );
  assert.equal(requests.length, 2);
} finally {
  globalThis.fetch = fetchBefore;
}
// Compile the rule's nonblank check with RE2 syntax, including multiline reports.
const rules = readFileSync("firestore.rules", "utf8"),
  encoded = rules.match(/description\.matches\('([^']+)'\)/)![1];
const pattern = RE2JS.compile(JSON.parse('"' + encoded + '"'));
for (const text of [
  "",
  "  ",
  String.fromCharCode(10) + " " + String.fromCharCode(9),
])
  assert.equal(pattern.matches(text), false);
for (const text of [
  "A bug",
  "First line" + String.fromCharCode(10) + "Second line",
  "  Feature idea  ",
])
  assert.equal(pattern.matches(text), true);
console.log(
  "PASS feedback validation/metadata/types, double-submit lock, success-only persistent 120s cooldown, retry/fallback, real Firestore SDK create payload/server timestamp and multiline nonblank rule",
);
