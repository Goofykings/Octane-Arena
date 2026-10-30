import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../src/game/authoritative-match";
import { Simulation } from "../src/physics/simulation";
import { RemoteCollisionProxies } from "../src/network/remote-collision-proxies";
import { LocalCarPrediction } from "../src/network/local-prediction";
import { RemoteCarSmoother } from "../src/network/remote-car-smoother";
import { AuthoritativeBallCorrection } from "../src/network/authoritative-ball-correction";
import {
  SnapshotBuffer,
  interpolateTransform,
} from "../src/network/snapshot-buffer";
import { FixedLoop } from "../src/physics/loop";
import { starter } from "../shared/catalog";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import type { MatchSnapshot } from "../shared/network";

await initializeMatchPhysics();
const players = [0, 1].map((i) => ({
  id: crypto.randomUUID(),
  name: "Contact " + i,
  team: i as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
const records = [];
// The existing speculative world must consume the visual timeline continuously,
// including a remote demo/respawn, without packet seeding moving its proxies.
{
  const host = new NetworkMatch(players);
  host.match.phase = "playing";
  const initial = host.snapshot();
  const prediction = new LocalCarPrediction(players[0], initial);
  try {
    let remote = { ...initial.cars[1], position: { x: 15, y: 3, z: 0 } };
    const body = prediction.simulation.cars[1].body;
    prediction.setRemoteTimeline(() => remote);
    prediction.update(initial, neutralInput(), 1, 1 / 60, 0);
    assert.ok(body.isKinematic());
    assert.ok(
      new Vector3().copy(body.translation()).distanceTo(remote.position) < 1e-5,
    );
    remote = { ...remote, position: { x: 15.1, y: 3, z: 0 } };
    prediction.update(initial, neutralInput(), 2, 1 / 60, 0);
    assert.ok(
      new Vector3().copy(body.translation()).distanceTo(remote.position) < 1e-5,
      "Proxy advances without a new packet",
    );
    remote = { ...remote, enabled: false };
    prediction.update(initial, neutralInput(), 3, 1 / 60, 0);
    assert.equal(body.isEnabled(), false);
    remote = { ...remote, enabled: true, position: { x: -15, y: 3, z: 0 } };
    prediction.update(initial, neutralInput(), 4, 1 / 60, 0);
    assert.equal(
      body.isEnabled(),
      true,
      "A respawn re-enables the timeline proxy",
    );
    assert.ok(
      new Vector3().copy(body.translation()).distanceTo(remote.position) < 1e-5,
    );
    prediction.update(
      { ...initial, tick: initial.tick + 4, time: initial.time + 4 * P.dt },
      neutralInput(),
      5,
      0,
      0,
    );
    assert.ok(
      new Vector3().copy(body.translation()).distanceTo(remote.position) < 1e-5,
      "Raw packet seeding does not snap the remote proxy",
    );
  } finally {
    prediction.dispose();
    host.dispose();
  }
}
for (const kind of [
  "straight",
  "side",
  "boost",
  "kickoff",
  "simultaneous",
] as const) {
  const host = new NetworkMatch(players),
    view = new Simulation(false, players);
  try {
    host.match.phase = "playing";
    const speed = kind === "boost" ? 23 : 9;
    const cars = host.simulation.cars;
    cars.forEach((c) => c.setBody("vector"));
    if (kind !== "kickoff") {
      cars[0].reset(
        kind === "side" ? 4 : 0,
        kind === "side" ? 0 : 4,
        kind === "side" ? Math.PI / 2 : 0,
      );
      cars[0].body.setLinvel(
        {
          x: kind === "side" ? -speed : 0,
          y: 0,
          z: kind === "side" ? 0 : -speed,
        },
        true,
      );
      cars[1].reset(0, kind === "simultaneous" ? -4 : -25, Math.PI);
      if (kind === "simultaneous")
        cars[1].body.setLinvel({ x: 0, y: 0, z: speed }, true);
    }
    host.simulation.ball.setTranslation(
      { x: 0, y: host.simulation.physics.ball.radius + 0.02, z: 0 },
      true,
    );
    host.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    host.simulation.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const driver = new RemoteCollisionProxies(view.cars);
    view.cars.forEach((c) => c.setBody("vector"));
    view.ball.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    const remote = new SnapshotBuffer({
      contactCheckpoints: false,
      extrapolationSeconds: 0.1,
      clockLeadSeconds: () => 0.05,
    });
    const ball = new SnapshotBuffer();
    const smoother = new RemoteCarSmoother(),
      corrector = new AuthoritativeBallCorrection(),
      loop = new FixedLoop();
    let latest = host.snapshot();
    const pending: { at: number; s: MatchSnapshot }[] = [
      { at: 0.05, s: latest },
    ];
    const touches = new Set<string>();
    let steps = 0,
      firstImpact = -1,
      confirmed = 0,
      nearContact = 0,
      maxError = 0,
      betweenPackets = 0,
      lastTick = -1;
    let previous: Vector3 | undefined;
    for (let tick = 1; tick <= 600; tick++) {
      const now = tick * P.dt;
      for (const i of [0, 1])
        host.accept(
          players[i].id,
          tick,
          {
            ...neutralInput(),
            throttle: i === 0 || kind === "simultaneous" ? 1 : 0,
            boost: kind === "boost",
          },
          now * 1000,
        );
      host.step(now * 1000);
      for (const touch of host.simulation.statTouches)
        touches.add(touch.playerId);
      if (host.simulation.statTouches.length && firstImpact < 0)
        firstImpact = host.tick;
      if (tick % 4 === 0) pending.push({ at: now + 0.05, s: host.snapshot() });
      while (pending[0]?.at <= now) {
        const packet = pending.shift()!;
        latest = packet.s;
        remote.push(latest, packet.at * 1000);
        ball.push(latest, packet.at * 1000);
      }
      if (tick % 2 !== 0) continue;
      const sample = remote.sample(now * 1000);
      if (!sample) continue;
      const visuals = latest.cars.map((c) =>
        smoother.sample(c.id, latest, sample),
      );
      const pose = corrector.sample(latest, ball.sampleAt(sample.time)!);
      const beforeHost = JSON.stringify(host.simulation.ball.translation());
      loop.advance(1 / 60, () => {
        const time = sample.time - Math.max(0, loop.accumulator - P.dt),
          s = remote.sampleAt(time)!;
        for (const car of view.cars)
          driver.move(car, smoother.sample(car.id, latest, s), latest.reset);
        const b = corrector.sample(latest, ball.sampleAt(time)!);
        view.ball.setNextKinematicTranslation(b.position);
        view.ball.setNextKinematicRotation(b.rotation);
        view.world.step();
        steps++;
      });
      assert.equal(
        JSON.stringify(host.simulation.ball.translation()),
        beforeHost,
        "Client world cannot mutate host ball",
      );
      for (let i = 0; i < view.cars.length; i++) {
        assert.equal(
          view.cars[i].body.bodyType(),
          RAPIER.RigidBodyType.KinematicPositionBased,
        );
        const error = new Vector3()
          .copy(view.cars[i].body.translation())
          .distanceTo(visuals[i].position);
        maxError = Math.max(maxError, error);
        assert.ok(
          error < 0.02,
          "Fixed-step proxy follows the visual timeline at 60 FPS",
        );
      }
      if (
        previous &&
        latest.tick === lastTick &&
        previous.distanceTo(visuals[0].position) > 1e-5
      )
        betweenPackets++;
      previous = new Vector3().copy(visuals[0].position);
      lastTick = latest.tick;
      if (
        firstImpact >= 0 &&
        Math.abs(sample.time - firstImpact * P.dt) < 0.1
      ) {
        if (
          view.cars.some((c) =>
            c.collider.contactCollider(view.ballCollider, 0.2),
          )
        )
          nearContact++;
        const wrong = {
          position: pose.position.clone().addScalar(0.5),
          rotation: new Quaternion(),
          velocity: pose.velocity.clone().negate().addScalar(15),
        };
        const corrected = corrector.blendSmallPrediction(pose, wrong, 1);
        assert.ok(
          corrected.position.distanceTo(wrong.position) > 0.1,
          "Host impact cannot be overwritten by a wrong local trajectory",
        );
        confirmed++;
      }
    }
    assert.ok(
      touches.has(players[0].id),
      kind + " actually hits the stationary host ball",
    );
    if (kind === "simultaneous")
      assert.ok(
        touches.has(players[1].id),
        "Both simultaneous hitters participate",
      );
    assert.ok(
      nearContact > 0,
      kind + " proxy reaches the ball at the displayed impact",
    );
    assert.ok(
      confirmed > 0,
      kind + " has an authoritative collision correction",
    );
    assert.ok(
      betweenPackets > 20,
      kind + " collider/visual motion continues between packets",
    );
    assert.ok(
      steps > 500,
      "120 Hz proxy world continues independently of 30 Hz packets",
    );
    assert.equal(
      view.touchSequence,
      0,
      "Presentation never generates gameplay touches/goals/demos",
    );
    records.push({
      kind,
      firstImpact,
      steps,
      betweenPackets,
      maxError,
      nearContact,
    });
  } finally {
    host.dispose();
    view.dispose();
  }
}
// Ordinary small state differences retain interpolation/blending; large wrong
// trajectories, velocity discontinuities and reset epochs follow the host promptly.
const host = new NetworkMatch(players);
try {
  const initial = host.snapshot(),
    correction = new AuthoritativeBallCorrection();
  const state = (tick: number, x: number, vx: number): MatchSnapshot => ({
    ...initial,
    tick,
    time: tick * P.dt,
    contacts: [],
    ball: {
      ...initial.ball,
      position: { x, y: 3, z: 0 },
      velocity: { x: vx, y: 0, z: 0 },
    },
  });
  const a = state(0, 0, 1),
    b = state(48, 0.4, 1),
    sample = { older: a, newer: b, alpha: 0.5, extrapolation: 0, time: 0.2 };
  correction.sample(a, { ...sample, newer: a, time: 0 });
  const smooth = correction.sample(b, sample);
  assert.ok(Math.abs(smooth.position.x - 0.2) < 1e-7);
  correction.blendSmallPrediction(
    smooth,
    {
      position: new Vector3(0.3, 3, 0),
      rotation: new Quaternion(),
      velocity: new Vector3(1, 0, 0),
    },
    0.5,
  );
  assert.ok(
    Math.abs(smooth.position.x - 0.25) < 1e-7,
    "Small prediction differences blend normally",
  );
  const hit = state(52, 0.5, -12);
  const corrected = correction.sample(hit, {
    older: b,
    newer: hit,
    alpha: 1,
    extrapolation: 0,
    time: hit.time,
  });
  assert.equal(corrected.velocity.x, -12);
  assert.ok(
    correction.authoritative,
    "Large velocity change is a collision fence",
  );
  const reset = { ...state(56, 40, 0), reset: initial.reset + 1 };
  assert.equal(
    correction.sample(reset, sample).position.x,
    40,
    "Reset cannot interpolate across old trajectory",
  );
  const driver = new RemoteCollisionProxies(host.simulation.cars),
    car = host.simulation.cars[0];
  const teleport = {
    ...initial.cars[0],
    teleportSequence: 7,
    position: { x: 80, y: 3, z: 0 },
  };
  driver.move(car, teleport, reset.reset);
  assert.ok(
    new Vector3().copy(car.body.translation()).distanceTo(teleport.position) <
      1e-5,
    "Explicit teleport snaps proxy without sweeping arena",
  );
} finally {
  host.dispose();
}
console.log(
  "PASS real Rapier straight/side/boost/kickoff/simultaneous host impacts, 120Hz kinematic proxies on the visual timeline, between-packet motion, authority isolation, small interpolation and major collision/reset correction",
  records,
);
