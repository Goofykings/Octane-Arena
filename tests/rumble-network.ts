import assert from "node:assert/strict";
import {
  initializeMatchPhysics,
  NetworkMatch,
  networkInputSchema,
} from "../src/game/authoritative-match";
import { neutralInput } from "../shared/player";
import { starter } from "../shared/catalog";
import { peerSnapshot } from "../shared/rtc";
import { rumbleSnapshotSchema, rumbleItems } from "../shared/rumble";
import { Rumble } from "../src/game/rumble";
import { Simulation } from "../src/physics/simulation";
import { RUMBLE_CONFIG as R } from "../src/config/rumble";
await initializeMatchPhysics();
const ids = [crypto.randomUUID(), crypto.randomUUID()];
const players = ids.map((id, i) => ({
  id,
  name: "Shared display name",
  team: i as 0 | 1,
  controller: "remote" as const,
  preset: starter(),
}));
const match = new NetworkMatch(players, "city", crypto.randomUUID(), "rumble");
const s = match.simulation,
  r = s.rumble!;
assert.ok(
  networkInputSchema.safeParse({ ...neutralInput(), usePowerup: true }).success,
);
assert.equal(
  match.accept(
    ids[0],
    1,
    { ...neutralInput(), usePowerup: true, item: "HAYMAKER" },
    0,
  ),
  false,
  "Client cannot assign an item",
);
assert.equal(
  match.accept("fake-id", 1, { ...neutralInput(), usePowerup: true }, 0),
  false,
);
assert.equal(
  match.accept(
    ids[0],
    1,
    { ...neutralInput(), usePowerup: true, impulse: 999999 },
    0,
  ),
  false,
  "Client cannot submit force/velocity",
);
match.match.phase = "playing";
match.match.tick(s);
s.cars[0].reset(0, 0, 0, 10);
s.cars[1].reset(20, 20, 0, 10);
s.ball.setTranslation({ x: 0, y: 10, z: -10 }, true);
s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
r.grant(ids[0], "HAYMAKER");
assert.ok(match.accept(ids[0], 1, { ...neutralInput(), usePowerup: true }, 0));
assert.ok(match.accept(ids[0], 2, { ...neutralInput(), usePowerup: false }, 1));
match.step(2);
assert.equal(
  r.players.get(ids[0])!.phase,
  "cooldown",
  "Fast press/release is latched for the authority",
);
assert.equal(r.events.filter((e) => e.kind === "POWERUP_USED").length, 1);
assert.ok(peerSnapshot(match.snapshot(), match.id, ids));
const tampered = match.snapshot();
tampered.rumble!.players[1].playerId = ids[0];
assert.equal(peerSnapshot(tampered, match.id, ids), null);
assert.ok(rumbleSnapshotSchema.safeParse(match.snapshot().rumble).success);
assert.equal(match.snapshot().rumble!.players[0].playerId, ids[0]);
assert.notEqual(
  match.snapshot().rumble!.players[0].playerId,
  match.snapshot().rumble!.players[1].playerId,
);
r.grant(ids[1], "POWER_HITTER");
r.use(ids[1]);
match.disconnect(ids[1]);
assert.equal(r.players.get(ids[1])!.item, null);
const cooldown = r.players.get(ids[1])!.cooldown;
for (let i = 0; i < 40; i++) match.step(3 + i);
assert.equal(
  r.players.get(ids[1])!.cooldown,
  cooldown,
  "Disconnected timer stays suspended",
);
match.connected(ids[1]);
match.step(50);
assert.ok(r.players.get(ids[1])!.cooldown < cooldown);
match.match.kickoff(s);
assert.ok(
  [...r.players.values()].every((st) => st.cooldown === 10 && st.item === null),
);
match.dispose();
// A remote client submits only intent; target and teleport come from the authority.
const swapMatch = new NetworkMatch(
  players,
  "city",
  crypto.randomUUID(),
  "rumble",
);
swapMatch.match.phase = "playing";
swapMatch.match.tick(swapMatch.simulation);
const swapSim = swapMatch.simulation;
swapSim.world.gravity = { x: 0, y: 0, z: 0 };
swapSim.cars[0].reset(0, 0, 0, 10);
swapSim.cars[1].reset(4, 0, 0, 10);
swapSim.rumble!.grant(ids[0], "SWAPPER");
assert.equal(
  swapMatch.accept(
    ids[0],
    1,
    { ...neutralInput(), usePowerup: true, targetPlayerId: ids[1] },
    0,
  ),
  false,
  "Client cannot specify target",
);
assert.ok(
  swapMatch.accept(ids[0], 1, { ...neutralInput(), usePowerup: true }, 0),
);
swapMatch.step(1);
const swapped = swapMatch.snapshot();
assert.ok(peerSnapshot(swapped, swapMatch.id, ids));
assert.equal(swapped.cars[0].teleportSequence, 1);
assert.equal(swapped.cars[1].teleportSequence, 1);
assert.ok(
  Math.abs(swapped.cars[0].position.x - 4) < 0.01 &&
    Math.abs(swapped.cars[1].position.x) < 0.01,
);
assert.equal(swapped.rumble!.events.filter((e) => e.kind === "SWAP").length, 1);
for (let t = 2; t < 20; t++) swapMatch.step(t);
assert.equal(
  swapSim.rumble!.events.filter((e) => e.kind === "SWAP").length,
  1,
  "Held packet cannot repeat teleport",
);
swapped.rumble!.events.find((e) => e.kind === "SWAP")!.targetPlayerId =
  crypto.randomUUID();
assert.equal(
  peerSnapshot(swapped, swapMatch.id, ids),
  null,
  "Foreign target ID rejected",
);
swapMatch.dispose();
const botPlayers = [
  {
    id: "human",
    name: "Human",
    team: 0 as const,
    controller: "local" as const,
  },
  { id: "bot", name: "Bot", team: 1 as const, controller: "bot" as const },
];
for (const item of rumbleItems) {
  const sim = new Simulation(true, botPlayers);
  sim.setGameMode("rumble");
  sim.world.gravity = { x: 0, y: 0, z: 0 };
  sim.cars[1].reset(0, 0, Math.PI, 10);
  sim.ball.setTranslation({ x: 0, y: 10, z: item === "SPIKES" ? 2 : 5 }, true);
  if (item === "PLUNGER") sim.ball.setTranslation({ x: 0, y: 10, z: -5 }, true);
  if (item === "SWAPPER") {
    sim.cars[0].reset(0, 6, 0, 10);
    sim.cars[1].reset(0, 20, 0, 10);
  }
  sim.rumble!.setPhase(true, true);
  sim.rumble!.grant("bot", item);
  sim.step([neutralInput(), neutralInput()]);
  assert.ok(
    sim.rumble!.events.some(
      (e) =>
        e.playerId === "bot" &&
        (e.kind === "POWERUP_USED" || e.kind === "SWAP"),
    ),
    item + " bot uses sensible in-range item",
  );
  sim.dispose();
}
// The authority's weighted roll covers only the six configured items.
const sim = new Simulation(true, botPlayers);
let sample = 0;
const rng = new Rumble(
  sim,
  () => ((sample++ % rumbleItems.length) + 0.5) / rumbleItems.length,
);
const counts = new Map(rumbleItems.map((k) => [k, 0]));
for (let i = 0; i < rumbleItems.length * 100; i++) {
  rng.grant("human");
  const item = rng.players.get("human")!.item!;
  counts.set(item, counts.get(item)! + 1);
  rng.end("human");
}
assert.ok([...counts.values()].every((n) => n === 100));
rng.dispose();
sim.dispose();
console.log(
  "PASS Rumble authoritative input validation/fast-tap latch, shared snapshots/IDs, disconnect/reconnect/reset, six practical bot powers and configurable equal weighted selection",
);
