import assert from "node:assert/strict";
import {
  rtcChunks,
  RtcChunkReceiver,
  RTC_MAX_PAYLOAD,
  peerSnapshot,
} from "../shared/rtc";
import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../src/game/authoritative-match";
import { starter } from "../shared/catalog";
import { P } from "../src/config/physics";
// Include realistic multi-megabyte replay JSON, unicode names, duplicates and
// out-of-order chunks.
const payload = JSON.stringify({
  name: "Driver 🌟",
  frames: Array.from({ length: 140000 }, (_, i) => Math.sin(i) * 42),
});
const chunks = rtcChunks(payload, crypto.randomUUID());
assert.ok(chunks.length > 100);
assert.ok(
  chunks.every(
    (chunk) => new TextEncoder().encode(JSON.stringify(chunk)).length < 64000,
  ),
);
const receiver = new RtcChunkReceiver();
assert.equal(receiver.accept(chunks[0]), null);
assert.equal(receiver.accept(chunks[0]), null);
let assembled: string | null = null;
for (const chunk of chunks.slice(1).reverse())
  assembled = receiver.accept(chunk);
assert.equal(assembled, payload);
assert.throws(() => receiver.accept({ ...chunks[0], total: 100000 }));
assert.throws(() => receiver.accept({ ...chunks[0], index: -1 }));
assert.throws(() => rtcChunks("x".repeat(RTC_MAX_PAYLOAD + 1), "too-large"));
console.log(
  "PASS bounded SCTP replay chunks, unicode, duplicate/out-of-order handling and oversize rejection",
);
await initializeMatchPhysics();
const players = [0, 1].map((team) => ({
  id: crypto.randomUUID(),
  name: "Driver",
  team: team as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
const game = new NetworkMatch(players);
try {
  const ids = players.map((p) => p.id);
  const check = () =>
    assert.ok(
      peerSnapshot(game.snapshot(), game.id, ids),
      `Rejected valid ${game.match.phase} snapshot`,
    );
  check();
  const invalid = game.snapshot();
  invalid.cars[0].position.x = NaN;
  assert.equal(peerSnapshot(invalid, game.id, ids), null);
  assert.equal(peerSnapshot(game.snapshot(), crypto.randomUUID(), ids), null);
  const duplicate = game.snapshot();
  duplicate.cars[1].id = ids[0];
  assert.equal(peerSnapshot(duplicate, game.id, ids), null);
  for (let i = 0; i < 400; i++) game.step(0);
  check();
  game.simulation.lastTouchId = ids[0];
  game.simulation.ball.setTranslation(
    { x: 0, y: 1, z: P.arena.halfLength + P.ball.radius + 0.5 },
    true,
  );
  game.step(0);
  assert.equal(game.match.phase, "goal");
  check();
  for (
    let i = 0;
    i < Math.ceil(P.match.celebration / P.dt) + 2 &&
    String(game.match.phase) !== "replay";
    i++
  )
    game.step(0);
  assert.equal(game.match.phase, "replay");
  check();
  const replay = game.match.replay!.clip.goal.id;
  game.skipReplay(ids[0], replay);
  game.skipReplay(ids[1], replay);
  assert.equal(game.match.phase, "countdown");
  check();
  game.match.phase = "playing";
  game.match.remaining = 0;
  game.match.score = [1, 0];
  game.simulation.ball.setTranslation({ x: 0, y: P.ball.radius, z: 0 }, true);
  game.step(0);
  assert.equal(game.match.phase, "finished");
  check();
  console.log(
    "PASS real countdown/playing/goal/replay/skip/reset/finished authority snapshots; malformed, stale and duplicate-player data rejected",
  );
} finally {
  game.dispose();
}
