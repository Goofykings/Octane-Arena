import assert from "node:assert/strict";
import { starter } from "../shared/catalog";
import {
  createPeerParty,
  peerMember,
  PeerPartyAuthority,
  peerPartySchema,
} from "../shared/peer-party";
import { canStartParty, partyModes, partyMaxPlayers } from "../shared/party";
import { partyRoster } from "../shared/match-roster";
import {
  initializeMatchPhysics,
  NetworkMatch,
} from "../src/game/authoritative-match";
import { peerSnapshot } from "../shared/rtc";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import { ReplayDirectorCamera } from "../src/replay/director-camera";
import { PerspectiveCamera, Vector3 } from "three";
const legacy = (await import("../shared/settings")).defaults();
for (const action of ["spectateNext", "spectatePrevious"] as const) {
  delete (legacy.bindings as any)[action];
  delete (legacy.controller.bindings as any)[action];
}
const upgraded = (await import("../shared/accounts")).preferencesSchema.parse(
  legacy,
);
assert.equal(upgraded.bindings.spectateNext, "Period");
assert.deepEqual(upgraded.controller.bindings.spectateNext, {
  type: "button",
  button: 15,
});
const member = (name: string) =>
  peerMember({
    type: "party-hello",
    version: "test",
    profile: {
      localPlayerId: crypto.randomUUID(),
      name,
      avatarId: "helmet",
      avatarColor: "#ffffff",
    },
    preset: starter(),
  });
const host = member("Host"),
  guest = member("Guest"),
  watch = member("Watcher"),
  fourth = member("Fourth");
const state = createPeerParty("ABCDEF", host),
  a = new PeerPartyAuthority(state);
a.join(guest);
a.join(watch);
a.join(fourth);
for (const mode of partyModes) {
  a.action(host.id, "mode", { mode: mode.id });
  assert.equal(state.mode, mode.id);
}
a.action(host.id, "mode", { mode: "1v1" });
a.action(host.id, "stage", { stage: "mode" });
a.action(host.id, "stage", { stage: "teams" });
a.action(host.id, "team", { team: 0 });
a.action(guest.id, "team", { team: 1 });
a.action(watch.id, "team", { team: "spectator" });
assert.ok(
  canStartParty(state),
  "unassigned and explicit watchers do not block start",
);
assert.throws(() => a.action(fourth.id, "team", { team: 0 }), /FULL/);
a.action(host.id, "launch", {});
assert.equal(state.members[3].team, "spectator");
assert.equal(partyRoster(state).length, 2);
assert.ok(peerPartySchema.safeParse(state).success);
const originalMatchId = state.matchId;
a.remove(fourth.id);
assert.equal(state.stage, "match");
assert.equal(
  state.matchId,
  originalMatchId,
  "watcher departure leaves active match intact",
);
await initializeMatchPhysics();
for (const mode of ["soccar", "heatseeker", "rumble"] as const) {
  const roster = partyRoster(state),
    g = new NetworkMatch(
      roster,
      "city",
      crypto.randomUUID(),
      mode,
      structuredClone(state.members),
    );
  assert.equal(g.simulation.cars.length, 2);
  assert.ok(!g.simulation.cars.some((c) => c.id === watch.id));
  assert.equal(g.accept(watch.id, 1, neutralInput()), false);
  assert.ok(g.acceptChat(watch.id, "Hello").message);
  assert.ok(
    peerSnapshot(
      g.snapshot(),
      g.id,
      roster.map((p) => p.id),
      state.members.map((m) => m.id),
    ),
    "spectator chat survives snapshot validation",
  );
  assert.ok(!g.snapshot().stats?.some((s) => s.playerId === watch.id));
  g.match.phase = "playing";
  for (let i = 0; i < 60; i++) g.step();
  g.simulation.lastTouchId = host.id;
  g.simulation.lastTouchTime = g.simulation.clock;
  g.simulation.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
  g.match.tick(g.simulation, g.pads);
  for (let i = 0; i < 400 && String(g.match.phase) !== "replay"; i++) g.step();
  assert.equal(g.match.phase, "replay", mode + " replay");
  const id = g.match.replay!.clip.goal.id;
  assert.deepEqual(
    new Set(g.match.replay!.eligible),
    new Set([host.id, guest.id]),
  );
  assert.equal(g.skipReplay(watch.id, id), false);
  assert.equal(g.skipReplay(host.id, id), true);
  assert.equal(g.match.phase, "replay");
  assert.equal(g.skipReplay(guest.id, id), true);
  assert.equal(g.match.phase, "countdown");
  g.removeSessionMember(watch.id);
  assert.equal(g.sessionActive(watch.id), false);
  assert.ok(g.acceptChat(watch.id, "After leaving").error);
  assert.ok(
    peerSnapshot(
      g.snapshot(),
      g.id,
      roster.map((p) => p.id),
      state.members.map((m) => m.id),
    ),
    "departed spectator history remains a valid snapshot",
  );
  g.dispose();
}
// Partial 2v2 teams and the full six-player wire format.
a.action(host.id, "rtc-end", { matchId: state.matchId, reason: "finished" });
a.action(host.id, "return", {});
a.action(host.id, "stage", { stage: "mode" });
a.action(host.id, "mode", { mode: "2v2" });
a.action(host.id, "stage", { stage: "teams" });
a.action(host.id, "team", { team: 0 });
assert.equal(canStartParty(state), false);
a.action(guest.id, "team", { team: 1 });
assert.ok(canStartParty(state));
a.action(watch.id, "team", { team: 0 });
assert.ok(canStartParty(state));
assert.throws(() => {
  a.join(fourth);
  a.action(fourth.id, "team", { team: 0 });
}, /FULL/);
a.action(host.id, "stage", { stage: "mode" });
a.action(host.id, "mode", { mode: "3v3" });
a.join(member("Fifth"));
a.join(member("Sixth"));
a.action(host.id, "launch", {});
assert.equal(partyRoster(state).length, 6);
const six = new NetworkMatch(
  partyRoster(state),
  "city",
  crypto.randomUUID(),
  "rumble",
);
assert.ok(
  peerSnapshot(
    six.snapshot(),
    six.id,
    six.players.map((p) => p.id),
  ),
);
six.dispose();
while (state.members.length < partyMaxPlayers)
  ((a.state.stage = "home"), a.join(member("Watcher")));
assert.throws(() => a.join(member("Full")), /FULL/);
// Distant goal/car cannot pull the camera out from the final ball-touch pair.
const camera = new PerspectiveCamera(73, 16 / 9, 0.05, 340),
  director = new ReplayDirectorCamera(camera);
const ball = new Vector3(0, 2, 20),
  scorer = new Vector3(1, 1, 22);
director.update(
  ball,
  new Vector3(0, 0, -20),
  scorer,
  {
    id: "goal",
    time: 8,
    touchTime: 5,
    scorerId: host.id,
    team: 0,
    ownGoal: false,
    lastTouchId: host.id,
    ballSpeed: 20,
    focus: { x: 0, y: 2, z: -51 },
  },
  1 / 60,
  5,
  1,
  [],
);
assert.ok(camera.position.distanceTo(ball) < 12);
assert.ok(Math.abs(director.debug.ballScreen.x) < 0.9);
assert.ok(Math.abs(director.debug.scorerScreen.x) < 0.9);
console.log(
  "PASS party caps/partial teams, explicit spectators/no cars/stats/input, spectator chat/snapshots, all scoring replay modes, active-human skip, watcher leave and six-car Rumble wire format; close final-touch director framing",
);
