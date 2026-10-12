import assert from "node:assert/strict";
import {
  NetworkMatch,
  initializeMatchPhysics,
  networkInputSchema,
} from "../src/game/authoritative-match";
import { starter, bodies } from "../shared/catalog";
import { P } from "../src/config/physics";
import { peerSnapshot } from "../shared/rtc";
import { neutralInput } from "../shared/player";
await initializeMatchPhysics();
const players = [0, 1].map((i) => ({
  id: `p${i}`,
  name: "Guest",
  team: i as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
const game = new NetworkMatch(players),
  s = game.simulation,
  c = s.cars[0];
try {
  game.match.phase = "playing";
  s.world.gravity = { x: 0, y: 0, z: 0 };
  s.cars[1].body.setEnabled(false);
  c.reset(0, 0, 0, 6);
  c.jump.used = true;
  c.jump.second = true;
  c.jump.age = 10;
  s.ball.setTranslation({ x: 20, y: 12, z: 0 }, true);
  game.step(0); // Clear old kickoff-floor manifolds after the aerial fixture teleport.
  const d = bodies[c.bodyId];
  s.ball.setTranslation(
    { x: 0, y: 6 + d.hitboxY - d.halfHeight - P.ball.radius + 0.025, z: 0 },
    true,
  );
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  game.step(0);
  for (let i = 0; i < 8 && c.flipResetSequence === 0; i++) game.step(0);
  assert.equal(c.flipResetSequence, 1);
  const snapshot = game.snapshot();
  assert.equal(snapshot.cars[0].flipReset!.sequence, 1);
  assert.ok(
    peerSnapshot(
      snapshot,
      game.id,
      players.map((p) => p.id),
    ),
    "Optional reset state is validated and retained on the wire",
  );
  assert.equal(
    game.match.recorder
      .buffer!.clip({
        id: "test",
        time: s.clock,
        scorerId: c.id,
        team: 0,
        ownGoal: false,
        lastTouchId: c.id,
        touchTime: s.clock,
        ballSpeed: 0,
        focus: { x: 0, y: 0, z: 0 },
      })
      .events.filter((e) => e.kind === "flip-reset").length,
    1,
  );
  s.ball.setTranslation({ x: 20, y: 12, z: 0 }, true);
  for (let i = 0; i < 240; i++) game.step(i);
  const input = {
    ...neutralInput(),
    yaw: -1,
    steer: -1,
    roll: 1,
    directionalRoll: 1,
    jump: true,
  };
  assert.equal(networkInputSchema.safeParse(input).success, true);
  assert.equal(game.accept("p0", 1, input, 1000), true);
  game.step(1000);
  assert.equal(c.jump.stall, true);
  assert.equal(c.jump.available, false);
  assert.equal(
    networkInputSchema.safeParse({ ...input, resetAvailable: true }).success,
    false,
    "Clients cannot supply reset eligibility",
  );
  console.log(
    "PASS authoritative real flip reset, validated remote visual metadata/replay event, late network-input stall and server-owned eligibility",
  );
} finally {
  game.dispose();
}
