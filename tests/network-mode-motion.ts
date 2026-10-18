import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../src/game/authoritative-match";
import { SnapshotPublisher, readMotionFrame } from "../shared/network-stream";
import {
  SnapshotBuffer,
  interpolateTransform,
} from "../src/network/snapshot-buffer";
import { starter } from "../shared/catalog";
import { neutralInput } from "../shared/player";
await initializeMatchPhysics();
for (const mode of [
  "soccar",
  "heatseeker",
  "hoops",
  "dropshot",
  "rumble",
] as const) {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: "Pilot " + i,
    team: (i < 3 ? 0 : 1) as 0 | 1,
    controller: (i === 0 || i === 3 ? "remote" : "bot") as "remote" | "bot",
    preset: starter(),
  }));
  const g = new NetworkMatch(players, undefined, undefined, mode),
    publisher = new SnapshotPublisher(),
    buffer = new SnapshotBuffer();
  g.match.phase = "playing";
  g.simulation.ball.setTranslation({ x: 0, y: 7, z: 0 }, true);
  g.simulation.ball.setLinvel({ x: 12, y: 9, z: -24 }, true);
  if (g.simulation.heatseeker)
    for (let i = 0; i < 8; i++)
      g.simulation.heatseeker.touch(players[i % 6].id, 0, i);
  let latest = g.snapshot(),
    frames = 0,
    visualFrames = 0,
    moving = 0,
    last: Vector3 | null = null;
  const start = g.simulation.cars.map((c) =>
    new Vector3().copy(c.body.translation()),
  );
  for (let tick = 1; tick <= 240; tick++) {
    const now = tick / 120;
    for (const i of [0, 3])
      g.accept(
        players[i].id,
        tick,
        { ...neutralInput(), throttle: 1, boost: true },
        now * 1000,
      );
    g.step(now * 1000);
    if (tick % 4 === 0) {
      const full = g.snapshot(),
        packet = publisher.packet(full, players[0].id);
      latest =
        packet.type === "snapshot" ? packet : readMotionFrame(packet, latest)!;
      assert.ok(latest);
      buffer.push(latest, now * 1000);
      frames++;
      assert.deepEqual(
        latest.cars.map((c) => c.id),
        players.map((p) => p.id),
      );
    }
    if (tick % 2 === 0) {
      const s = buffer.sample(now * 1000);
      if (!s) continue;
      if (!s.newer.ball.enabled || s.newer.phase !== "playing") {
        last = null;
        continue;
      }
      const pose = interpolateTransform(
        s.older.ball,
        s.newer.ball,
        s.alpha,
        s.extrapolation,
      );
      assert.ok(pose.position.toArray().every(Number.isFinite));
      if (last && pose.position.distanceTo(last) > 0.00001) moving++;
      last = pose.position;
      visualFrames++;
    }
  }
  assert.equal(frames, 60);
  assert.ok(visualFrames > 12, mode + " has enough live-ball frames");
  assert.ok(
    moving > visualFrames * 0.85,
    mode + " ball progresses at render cadence",
  );
  for (const i of [1, 2, 4, 5])
    assert.ok(
      new Vector3()
        .copy(g.simulation.cars[i].body.translation())
        .distanceTo(start[i]) > 0.5,
      mode + " bot moves only on authority",
    );
  assert.equal((g as unknown as { bots: Map<string, unknown> }).bots.size, 4);
  g.simulation.cars.forEach((c, i) =>
    assert.equal(
      latest.cars[i].enabled,
      c.body.isEnabled(),
      mode + " authoritative demolition visibility",
    ),
  );
  g.dispose();
}
console.log(
  "PASS six-car 3v3 with four host-only bots in all five modes; real aerial/homing ball motion, 30 Hz per-ID packets and 60 Hz buffered rendering",
);
