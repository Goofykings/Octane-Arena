import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  SnapshotBuffer,
  interpolateTransform,
  interpolateCar,
} from "../src/network/snapshot-buffer";
import { NETWORK as N, snapshotBucket } from "../shared/network-tuning";
import {
  SnapshotPublisher,
  motionFrame,
  readMotionFrame,
} from "../shared/network-stream";
import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../src/game/authoritative-match";
import { starter } from "../shared/catalog";
import { writeFileSync, mkdirSync } from "node:fs";
await initializeMatchPhysics();
const players = Array.from({ length: 6 }, (_, i) => ({
  id: crypto.randomUUID(),
  name: "Pilot " + i,
  team: (i % 2) as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
const game = new NetworkMatch(players);
const base = game.snapshot();
function snapshot(tick: number) {
  const time = tick / 120;
  return {
    ...base,
    tick,
    time,
    cars: base.cars.map((c, i) => ({
      ...c,
      position: { x: time * 8, y: 3 + i, z: 0 },
      velocity: { x: 8, y: 0, z: 0 },
      rotation: new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        time * 0.4,
      ),
    })),
    ball: {
      ...base.ball,
      position: { x: time * 12, y: 5, z: 0 },
      velocity: { x: 12, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 2, z: 0 },
    },
  };
}
const results: any[] = [];
for (const fps of [30, 60, 144])
  for (const latency of [30, 60, 100]) {
    const buffer = new SnapshotBuffer(),
      packets: { at: number; s: ReturnType<typeof snapshot> }[] = [];
    for (let i = 0; i < 300; i++) {
      if (i % 23 === 8) continue;
      const jitter = Math.sin(i * 1.71) * 22 + (i % 31 === 7 ? 65 : 0);
      packets.push({
        at: i / 30 + latency / 1000 + jitter / 1000,
        s: snapshot(i * 4),
      });
      if (i % 47 === 6)
        packets.push({
          at: i / 30 + latency / 1000 + 0.03,
          s: snapshot(i * 4),
        });
    }
    packets.sort((a, b) => a.at - b.at);
    let index = 0,
      previous = NaN,
      moving = 0,
      count = 0,
      maxStep = 0;
    for (let frame = 0; frame < fps * 10; frame++) {
      const now = frame / fps;
      while (index < packets.length && packets[index].at <= now) {
        const p = packets[index++];
        buffer.push(p.s, p.at * 1000);
      }
      const sample = buffer.sample(now * 1000);
      if (!sample) continue;
      const pose = interpolateTransform(
        sample.older.ball,
        sample.newer.ball,
        sample.alpha,
        sample.extrapolation,
      );
      if (now > 1 && now < 9 && Number.isFinite(previous)) {
        const dx = pose.position.x - previous;
        assert.ok(dx >= -1e-7, "Playback never rewinds from jitter");
        count++;
        if (dx > 1e-4) moving++;
        maxStep = Math.max(maxStep, dx);
        assert.ok(buffer.snapshots.length <= N.bufferSize);
      }
      previous = pose.position.x;
    }
    assert.ok(
      moving / count > 0.97,
      "Render-frame smoothness " +
        fps +
        "/" +
        latency +
        " " +
        moving +
        "/" +
        count,
    );
    assert.ok(maxStep < (12 / fps) * 1.22, "No arrival-sized jumps " + maxStep);
    assert.ok(
      buffer.duplicates > 0 && buffer.outOfOrder > 0,
      "Duplicate/out-of-order handling exercised",
    );
    const last = buffer.snapshots.at(-1)!;
    for (let t = 10; t < 13; t += 1 / fps) buffer.sample(t * 1000);
    const held = buffer.sample(14000)!;
    assert.ok(held.extrapolation <= 0.1200001);
    const p = interpolateTransform(
      held.older.ball,
      held.newer.ball,
      held.alpha,
      held.extrapolation,
    );
    assert.ok(p.position.x <= last.ball.position.x + 12 * 0.120001);
    results.push({
      fps,
      latency,
      movingFraction: moving / count,
      maxStep,
      duplicates: buffer.duplicates,
      outOfOrder: buffer.outOfOrder,
      dropped: buffer.dropped,
    });
  }
const buf = new SnapshotBuffer();
buf.push(snapshot(0), 0);
buf.push(snapshot(12), 100);
buf.push(snapshot(8), 105);
assert.equal(buf.snapshots[1].tick, 8);
buf.push({ ...snapshot(240), reset: base.reset + 1 }, 2000);
assert.equal(buf.snapshots.length, 1);
assert.equal(buf.sample(2000)!.newer.reset, base.reset + 1);
const a = base.cars[0],
  b = { ...a, position: { x: 80, y: 2, z: 0 }, teleportSequence: 1 };
assert.equal(
  interpolateCar(a, b, {
    older: base,
    newer: base,
    alpha: 0.5,
    extrapolation: 0,
    time: 0,
  }),
  b,
  "Teleports snap",
);
const publisher = new SnapshotPublisher();
let full = 0,
  frame = 0,
  bytes = 0;
let hydrated = base;
for (let tick = 0; tick < 240; tick += 4) {
  const s = { ...snapshot(tick), phase: "playing" as const },
    packet = publisher.packet(s, players[0].id);
  bytes += Buffer.byteLength(JSON.stringify(packet));
  if (packet.type === "snapshot") {
    full++;
    hydrated = packet;
    assert.ok(packet.cars[0].prediction);
    assert.equal(packet.cars[1].prediction, undefined);
  } else {
    frame++;
    const decoded = readMotionFrame(packet, hydrated);
    assert.ok(decoded);
    assert.deepEqual(decoded.cars[0].position, s.cars[0].position);
    assert.deepEqual(decoded.ball.velocity, s.ball.velocity);
    hydrated = decoded;
  }
}
assert.equal(full, 10);
assert.equal(frame, 50);
assert.ok(
  bytes / 60 < Buffer.byteLength(JSON.stringify(base)) * 0.8,
  "Motion packets reduce wire bytes",
);
const packet = motionFrame(base, players[0].id);
assert.equal(readMotionFrame({ ...packet, matchId: "wrong" }, base), null);
const bad = structuredClone(packet);
bad.cars[0].motion[0] = NaN;
assert.equal(readMotionFrame(bad, base), null);
const eventPublisher = new SnapshotPublisher();
eventPublisher.packet(base);
assert.equal(
  eventPublisher.packet({ ...base, tick: 4, time: 4 / 120, score: [1, 0] })
    .type,
  "snapshot",
  "Goal metadata immediate",
);
let lastBucket = -1,
  sends = 0;
for (let tick = 0; tick <= 120; tick++) {
  const bucket = snapshotBucket(tick);
  if (bucket !== lastBucket) {
    lastBucket = bucket;
    sends++;
  }
}
assert.equal(sends, 31, "30 sends plus bootstrap");
mkdirSync(".tools", { recursive: true });
writeFileSync(
  ".tools/network-smoothing.json",
  JSON.stringify(
    {
      results,
      fullHz: full / 2,
      motionHz: (full + frame) / 2,
      averagePacketBytes: bytes / 60,
      baselineFullBytes: Buffer.byteLength(JSON.stringify(base)),
    },
    null,
    2,
  ),
);
game.dispose();
console.log(
  "PASS 30/60/144 FPS at 30/60/100 ms latency with jitter/loss/reordering/duplicates; bounded extrapolation, teleports, compact 30 Hz motion / 5 Hz metadata and invalid-frame rejection",
);
