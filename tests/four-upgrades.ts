import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Group, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { NetworkMatch } from "../src/game/authoritative-match";
import { LocalCarPrediction } from "../src/network/local-prediction";
import {
  SnapshotBuffer,
  interpolateTransform,
} from "../src/network/snapshot-buffer";
import { GameCamera } from "../src/camera/camera";
import { MouseLook } from "../src/camera/mouse-look";
import { starter } from "../shared/catalog";
import { packInputTick, readInputTick } from "../shared/network-events";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const n = neutralInput();
const players = [0, 1].map((i) => ({
  id: "player-" + i,
  name: "Pilot " + i,
  team: i as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
const game = new NetworkMatch(players);
try {
  game.match.phase = "playing";
  game.simulation.cars[0].reset(0, 0, 0, 5);
  game.simulation.cars[1].reset(8, 0, 0, 5);
  game.simulation.ball.setTranslation({ x: 0, y: 5, z: -3 }, true);
  const snapshot = game.snapshot();
  const prediction = new LocalCarPrediction(players[0], snapshot);
  try {
    let sequence = 0;
    prediction.update(snapshot, n, 0, 0, 0);
    assert.equal(prediction.simulation.ball.isEnabled(), true);
    assert.equal(prediction.simulation.cars.length, 2);
    assert.equal(
      prediction.simulation.cars[1].body.bodyType(),
      RAPIER.RigidBodyType.KinematicPositionBased,
    );
    prediction.car.body.setLinvel({ x: 0, y: 0, z: -15 }, true);
    const hostPosition = { ...game.simulation.ball.translation() };
    for (let frame = 0; frame < 12; frame++)
      prediction.update(
        snapshot,
        n,
        sequence,
        1 / 60,
        frame / 60,
        () => ++sequence,
      );
    assert.ok(
      Math.abs(prediction.simulation.ball.linvel().z) > 1,
      "physical local feedback before any host reply",
    );
    assert.deepEqual(
      { ...game.simulation.ball.translation() },
      hostPosition,
      "speculative contact cannot affect authority",
    );
    assert.ok(Number.isFinite(prediction.correctionRotation));
    assert.equal(sequence, 24, "one command per 120-Hz tick");
  } finally {
    prediction.dispose();
  }
  const batch = Array.from({ length: 4 }, (_, i) =>
    packInputTick({
      sequence: i + 1,
      tick: i + 10,
      input: { ...n, jump: i === 0, throttle: 1 },
    }),
  );
  assert.ok(readInputTick(batch[0])?.input.jump);
  assert.equal(readInputTick([1, 1, NaN]), null);
  assert.equal(game.accept(players[0].id, 1, n, 0, {} as number[][]), false);
  assert.equal(game.accept(players[0].id, 1, n, 0, [[1, 0, 99]]), false);
  assert.ok(game.accept(players[0].id, 2, n, 0, batch));
  for (let i = 0; i < 4; i++) {
    game.step(i * P.dt * 1000);
    assert.equal(game.snapshot().cars[0].inputSequence, i + 1);
    assert.equal(game.snapshot().cars[0].inputTick, i + 10);
  }
  assert.ok(
    game.accept(players[0].id, 3, n, 50, batch),
    "duplicate batch resends are idempotent",
  );
  game.step(50);
  assert.equal(game.snapshot().cars[0].inputSequence, 4);
  // Authoritative collision checkpoints recover a bounce between sparse endpoints.
  const base = game.snapshot(),
    buffer = new SnapshotBuffer();
  const pose = (x: number, v: number) => ({
    ...base.ball,
    position: { x, y: 5, z: 0 },
    velocity: { x: v, y: 0, z: 0 },
  });
  const a = { ...base, tick: 0, time: 0, contacts: [], ball: pose(0, 10) };
  const b = {
    ...base,
    tick: 4,
    time: 4 / 120,
    ball: pose(0, -10),
    contacts: [
      {
        sequence: 1,
        tick: 2,
        time: 2 / 120,
        ball: { ...pose(1, -10), angularVelocity: { x: 0, y: 0, z: 0 } },
        cars: base.cars.map((c) => ({
          ...c,
          angularVelocity: c.angularVelocity ?? { x: 0, y: 0, z: 0 },
        })),
      },
    ],
  };
  buffer.push(a, 0);
  buffer.push(b, (4 / 120) * 1000);
  assert.ok(
    buffer.snapshots.some((s) => s.tick === 2),
    "impact pose retained between 30-Hz endpoints",
  );
  // Every rendered gameplay camera basis has horizontal right and positive up.
  const s = new Simulation(),
    car = new Group(),
    ball = new Group(),
    camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
    rig = new GameCamera(camera);
  try {
    // Verify both exact poles and their noisy neighborhoods stay orthonormal
    // and world-level. These were a subtle source of residual free-look roll.
    for (let i = 0; i < 200; i++) {
      const look = new Vector3(
        Math.sin(i) * 0.03,
        i % 2 ? 1 : -1,
        Math.cos(i) * 0.03,
      ).normalize();
      (rig as any).orientation(look, camera.quaternion);
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      assert.ok(Math.abs(right.y) < 1e-7 && up.y >= -1e-7);
      assert.ok(Math.abs(camera.quaternion.length() - 1) < 1e-7);
    }
    car.position.set(39, 9, 0);
    ball.position.set(0, 14, -15);
    rig.settings = { ...rig.settings, shake: true };
    const look = new MouseLook();
    rig.mouseLook = look;
    for (const mode of [false, true])
      for (const fps of [30, 60, 144]) {
        rig.ballMode = mode;
        rig.reset();
        for (let i = 0; i < 200; i++) {
          car.quaternion.setFromEuler(
            new Euler(i * 0.06, i * 0.015, i * 0.04, "YXZ"),
          );
          car.position.y = 9 + Math.sin(i * 0.03) * 7;
          ball.position.set(
            i % 20 === 0 ? car.position.x : 0,
            car.position.y + 12,
            -15,
          );
          look.yaw = Math.sin(i * 0.04) * 1.2;
          look.pitch = Math.sin(i * 0.03) * 0.4;
          rig.reverseHeld = i % 80 > 60;
          rig.update(car, ball, s, 1 / fps, false, i / fps);
          const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
          assert.ok(
            Math.abs(right.y) < 1e-5,
            "zero roll in air/wall/ceiling/shake",
          );
          assert.ok(up.y >= -1e-6, "no inverted horizon");
          assert.deepEqual(rig.referenceUp.toArray(), [0, 1, 0]);
        }
      }
  } finally {
    s.dispose();
  }
} finally {
  game.dispose();
}
console.log(
  "PASS physical speculative contacts/proxies, fixed-tick commands/acknowledgements, loss-safe duplicate batches, collision checkpoints and world-up camera at 30/60/144 FPS",
);
