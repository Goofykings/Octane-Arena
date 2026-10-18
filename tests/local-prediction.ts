import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../src/game/authoritative-match";
import { LocalCarPrediction } from "../src/network/local-prediction";
import { neutralInput } from "../shared/player";
import { starter } from "../shared/catalog";
import { P } from "../src/config/physics";
import { NETWORK as N } from "../shared/network-tuning";
await initializeMatchPhysics();
const player = {
  id: crypto.randomUUID(),
  name: "Local",
  team: 0 as const,
  controller: "remote" as const,
  preset: starter(),
};
for (const mode of [
  "soccar",
  "heatseeker",
  "hoops",
  "dropshot",
  "rumble",
] as const) {
  const game = new NetworkMatch([player], undefined, undefined, mode);
  game.match.phase = "playing";
  game.simulation.ball.setEnabled(false);
  const c = game.simulation.cars[0];
  c.reset(0, 0, 0);
  for (let i = 0; i < 30; i++) game.step(i * P.dt * 1000);
  const initialTouchSequence = game.simulation.touchSequence;
  let initial = game.snapshot();
  const prediction = new LocalCarPrediction(player, initial);
  prediction.update(initial, neutralInput(), 1, 0, 0);
  const start = new Vector3().copy(prediction.car.body.translation());
  const immediate = prediction.update(
    initial,
    { ...neutralInput(), throttle: 1, boost: true, jump: true },
    2,
    1 / 60,
    0.016,
  )!;
  assert.ok(
    prediction.car.body.linvel().y > 1,
    mode + " jump predicted before any host reply",
  );
  assert.ok(
    new Vector3().copy(prediction.car.body.translation()).distanceTo(start) >
      0.004,
    mode +
      " throttle/boost immediate " +
      JSON.stringify({
        before: start,
        after: prediction.car.body.translation(),
        velocity: prediction.car.body.linvel(),
        boost: prediction.car.boost,
        phase: initial.phase,
      }),
  );
  assert.ok(
    prediction.car.body.linvel().z < -0.2,
    mode + " immediate forward acceleration",
  );
  assert.equal(prediction.simulation.ball.isEnabled(), false);
  assert.equal(game.simulation.touchSequence, initialTouchSequence);
  assert.equal(prediction.simulation.players.length, 1);
  // Replay a local aerial control against the SAME host forces/checkpoint.
  c.reset(0, 0, 0, 8);
  c.body.setLinvel({ x: 1, y: 1, z: -3 }, true);
  game.step(0);
  initial = game.snapshot();
  initial.reset++;
  prediction.update(initial, neutralInput(), 3, 0, 0);
  const air = { ...neutralInput(), pitch: 0.7, roll: 0.8, boost: true };
  prediction.update(initial, air, 4, 1 / 60, 0.016);
  assert.ok(
    new Vector3().copy(prediction.car.body.angvel()).length() > 0.1,
    mode + " aerial input responds immediately",
  );
  // New server respawn/swap must snap without carrying old input across the map.
  c.teleportSequence++;
  c.body.setTranslation({ x: 20, y: 4, z: 0 }, true);
  const teleported = { ...game.snapshot(), tick: initial.tick + 1 };
  const warped = prediction.update(teleported, neutralInput(), 5, 0, 0)!;
  assert.ok(
    new Vector3().copy(warped.position).distanceTo(c.body.translation()) < 1e-6,
  );
  assert.equal(prediction.pendingCount, 0);
  // Absence of packets must not let local prediction run away forever.
  for (let i = 0; i < 100; i++)
    prediction.update(
      teleported,
      { ...neutralInput(), boost: true },
      6 + i,
      1 / 60,
      1 + i / 60,
    );
  assert.ok(
    new Vector3()
      .copy(prediction.car.body.translation())
      .distanceTo(c.body.translation()) < 1e-5,
  );
  // Fresh snapshots without new input acknowledgements must also bound lead.
  for (let i = 0; i < 120; i++) {
    const fresh = {
      ...teleported,
      tick: teleported.tick + i + 1,
      time: teleported.time + (i + 1) / 60,
    };
    prediction.update(
      fresh,
      { ...neutralInput(), throttle: 1, boost: true },
      100 + i,
      1 / 60,
      0,
    );
    assert.ok(
      prediction.pendingCount <= Math.ceil(N.stalePredictionSeconds / P.dt),
    );
    assert.ok(
      new Vector3()
        .copy(prediction.car.body.translation())
        .distanceTo(c.body.translation()) < 3,
      mode + " stalled ack cannot run away",
    );
  }
  prediction.dispose();
  game.dispose();
}
for (const latency of [0.03, 0.06, 0.1]) {
  const g = new NetworkMatch([player]);
  g.match.phase = "playing";
  g.simulation.ball.setEnabled(false);
  g.simulation.cars[0].reset(0, 0, 0);
  g.step(0);
  let latest = g.snapshot(),
    arrived = 0,
    sequence = 1;
  const p = new LocalCarPrediction(player, latest);
  const commands: {
      at: number;
      sequence: number;
      input: ReturnType<typeof neutralInput>;
    }[] = [],
    states: { at: number; state: typeof latest }[] = [];
  let maximum = 0;
  for (let frame = 0; frame < 360; frame++) {
    const time = frame / 60,
      input = {
        ...neutralInput(),
        throttle: frame < 180 ? 1 : 0,
        boost: frame < 80,
      };
    sequence++;
    commands.push({ at: time + latency, sequence, input });
    while (commands[0]?.at <= time) {
      const command = commands.shift()!;
      g.accept(player.id, command.sequence, command.input, time * 1000);
    }
    g.step(time * 1000);
    g.step(time * 1000);
    if (frame % 2 === 0)
      states.push({ at: time + latency, state: g.snapshot() });
    while (states[0]?.at <= time) {
      const next = states.shift()!;
      latest = next.state;
      arrived = time;
    }
    const display = p.update(latest, input, sequence, 1 / 60, time - arrived)!;
    assert.ok(p.pendingCount <= N.predictionHistory);
    assert.ok(
      new Vector3().copy(p.car.body.linvel()).length() <=
        P.car.maxSpeed + 0.001,
    );
    maximum = Math.max(
      maximum,
      new Vector3()
        .copy(display.position)
        .distanceTo(g.simulation.cars[0].body.translation()),
    );
  }
  assert.ok(
    maximum < 6,
    "Bounded moving prediction error " + latency + ": " + maximum,
  );
  assert.ok(
    p.hardCorrections < 3,
    "No constant local snaps " + p.hardCorrections,
  );
  const error = new Vector3()
    .copy(p.car.body.translation())
    .distanceTo(g.simulation.cars[0].body.translation());
  assert.ok(error < 0.3, "Idle reconciliation converges " + error);
  console.log(
    "prediction latency",
    latency,
    "max error",
    maximum,
    "final error",
    error,
    "hard corrections",
    p.hardCorrections,
  );
  p.dispose();
  g.dispose();
}
console.log(
  "PASS same car/contact forces, immediate throttle/boost/jump/air roll in all five modes; host-only ball/bots/scoring; input-ack replay, bounded history/error, gradual correction, stale stop and hard teleport reset",
);
