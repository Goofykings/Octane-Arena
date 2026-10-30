import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  SnapshotBuffer,
  interpolateTransform,
  interpolateCar,
} from "../src/network/snapshot-buffer";
import { NETWORK as N, snapshotBucket } from "../shared/network-tuning";
import { RemoteCarSmoother } from "../src/network/remote-car-smoother";
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
      angularVelocity: { x: 0, y: 0.4, z: 0 },
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
      remote = new SnapshotBuffer({
        contactCheckpoints: false,
        extrapolationSeconds: N.remoteExtrapolationSeconds,
        clockLeadSeconds: () => latency / 1000,
      }),
      smoother = new RemoteCarSmoother(),
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
    let latest: ReturnType<typeof snapshot> | undefined;
    const previousCars = new Map<
      string,
      ReturnType<RemoteCarSmoother["sample"]>
    >();
    let remoteMoving = 0,
      remoteFrames = 0;
    for (let frame = 0; frame < fps * 10; frame++) {
      const now = frame / fps;
      while (index < packets.length && packets[index].at <= now) {
        const p = packets[index++];
        buffer.push(p.s, p.at * 1000);
        remote.push(p.s, p.at * 1000);
        if (!latest || p.s.tick > latest.tick) latest = p.s;
      }
      const remoteSample = remote.sample(now * 1000);
      if (remoteSample && latest)
        for (const car of latest.cars) {
          const pose = smoother.sample(car.id, latest, remoteSample),
            previous = previousCars.get(car.id);
          if (previous && now > 1 && now < 9) {
            const dx = pose.position.x - previous.position.x;
            assert.ok(dx >= -1e-7, "Remote car never rewinds");
            assert.ok(
              dx < (8 / fps) * 1.22,
              "Remote car has no packet-sized jump",
            );
            assert.ok(
              new Quaternion()
                .copy(pose.rotation)
                .angleTo(new Quaternion().copy(previous.rotation)) <
                (0.4 / fps) * 1.23,
              "Remote quaternion advances smoothly",
            );
            remoteFrames++;
            if (dx > 1e-4) remoteMoving++;
          }
          previousCars.set(car.id, pose);
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
    assert.ok(
      remoteMoving / remoteFrames > 0.97,
      "All six cars/bots move at render cadence",
    );
    for (let t = 10; t < 13; t += 1 / fps) remote.sample(t * 1000);
    const stopped = remote.sample(14000)!;
    assert.ok(
      stopped.extrapolation <= 0.1000001,
      "Remote extrapolation stops at 100 ms",
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
// A teleport must snap once, then never follow newest packets and rewind when
// delayed playback catches up. Other cars continue their own delayed timeline.
const remoteCars = new RemoteCarSmoother();
const old = snapshot(120);
const at = (x: number, tick: number, sequence = 1, enabled = true) => ({
  ...snapshot(tick),
  cars: snapshot(tick).cars.map((c, i) =>
    i
      ? c
      : {
          ...c,
          position: { x, y: 2, z: 0 },
          teleportSequence: sequence,
          enabled,
        },
  ),
});
const span = (older: typeof old, newer: typeof old, time: number) => ({
  older,
  newer,
  time,
  alpha:
    newer.time === older.time
      ? 1
      : (time - older.time) / (newer.time - older.time),
  extrapolation: 0,
});
const id = old.cars[0].id;
remoteCars.sample(id, old, span(old, old, old.time));
const teleported = at(80, 124);
assert.equal(
  remoteCars.sample(id, teleported, span(old, old, old.time)).position.x,
  80,
);
const after = at(80 + 8 / 30, 128);
assert.equal(
  remoteCars.sample(id, after, span(old, teleported, old.time + 0.01)).position
    .x,
  80,
  "Hold teleport anchor while delayed clock catches up",
);
const resumed = remoteCars.sample(
  id,
  after,
  span(teleported, after, teleported.time + 1 / 60),
);
assert.ok(
  Math.abs(resumed.position.x - (80 + 8 / 60)) < 1e-7,
  "Resume without teleport rollback",
);
const dead = at(90, 132, 1, false);
assert.equal(
  remoteCars.sample(id, dead, span(teleported, after, after.time)).enabled,
  false,
  "Demolition bypasses delay",
);
const respawn = at(-20, 136, 1, true);
assert.equal(
  remoteCars.sample(id, respawn, span(teleported, after, after.time)).position
    .x,
  -20,
  "Respawn bypasses delay",
);
const swapped = at(30, 140, 2);
assert.equal(
  remoteCars.sample(id, swapped, span(teleported, after, after.time)).position
    .x,
  30,
  "Swapper/deliberate teleport marker bypasses delay",
);
const reset = { ...snapshot(144), reset: old.reset + 1 };
assert.equal(
  remoteCars.sample(id, reset, span(teleported, after, after.time)).position.x,
  reset.cars[0].position.x,
  "Kickoff/goal reset bypasses delay",
);
const contacts = {
  ...snapshot(160),
  contacts: [
    {
      sequence: 1,
      tick: 158,
      time: 158 / 120,
      ball: snapshot(158).ball,
      cars: [],
    },
  ],
};
const carsOnly = new SnapshotBuffer({
  contactCheckpoints: false,
  extrapolationSeconds: 0.1,
});
carsOnly.push(contacts, (160 / 120) * 1000);
assert.deepEqual(
  carsOnly.snapshots.map((s) => s.tick),
  [160],
  "Contact checkpoints cannot overwrite remote visual fields",
);
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
  "PASS 30/60/144 FPS at 30/60/100 ms latency with jitter/loss/reordering/duplicates; six smooth remote cars, 100ms remote extrapolation, teleport/reset/respawn fences without rollback, independent collision timeline, compact 30 Hz motion / 5 Hz metadata and invalid-frame rejection",
);
