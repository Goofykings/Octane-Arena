import assert from "node:assert/strict";
import { starter } from "../shared/catalog";
import {
  generatePeerCode,
  validPeerCode,
  PEER_CODE_ALPHABET,
  helloSchema,
  peerMember,
  peerPartySchema,
  createPeerParty,
  PeerPartyAuthority,
} from "../shared/peer-party";
import { partyRoster } from "../shared/match-roster";
import { peerErrorMessage } from "../shared/peer-errors";
for (const type of [
  "unavailable-id",
  "peer-unavailable",
  "network",
  "server-error",
  "socket-error",
  "socket-closed",
  "webrtc",
]) {
  const message = peerErrorMessage(type);
  assert.ok(message.length > 0 && message.length < 100);
  assert.ok(
    !message.includes(" at "),
    "UI receives an error label, not a stack",
  );
}
assert.equal(peerErrorMessage("peer-unavailable"), "PARTY NOT FOUND");
const member = () =>
  peerMember(
    helloSchema.parse({
      type: "party-hello",
      version: "0.1.2",
      profile: {
        localPlayerId: crypto.randomUUID(),
        name: "Same",
        avatarId: "helmet",
      },
      preset: starter(),
    }),
  );
for (let i = 0; i < 1000; i++) {
  const code = generatePeerCode();
  assert.equal(code.length, 6);
  assert.ok(validPeerCode(code));
  assert.ok([...code].every((c) => PEER_CODE_ALPHABET.includes(c)));
}
for (const code of [
  "ABCDE",
  "ABCDEFG",
  "A0BCDE",
  "AOBCDE",
  "AIBCDE",
  "A1BCDE",
  "abcdef",
])
  assert.equal(validPeerCode(code), false);
const host = member(),
  guest = member(),
  third = member(),
  fourth = member(),
  state = createPeerParty(generatePeerCode(), host),
  party = new PeerPartyAuthority(state);
party.join(guest);
party.join(third);
party.join(fourth);
assert.equal(state.members.length, 4);
assert.throws(() => party.join(member()), /FULL/);
assert.throws(() => party.join(guest), /PROFILE/);
assert.throws(() => party.action(guest.id, "mode", { mode: "2v2" }), /HOST/);
party.action(host.id, "mode", { mode: "2v2" });
party.action(host.id, "stage", { stage: "mode" });
party.action(host.id, "stage", { stage: "teams" });
const previewArena = state.matchArenaId;
assert.ok(previewArena);
party.action(host.id, "team", { team: 0 });
party.action(guest.id, "team", { team: 0 });
assert.throws(() => party.action(third.id, "team", { team: 0 }), /FULL/);
party.action(third.id, "team", { team: 1 });
party.action(fourth.id, "team", { team: 1 });
party.action(guest.id, "ready", { ready: true });
assert.equal(state.members[1].ready, true);
party.action(host.id, "launch", {});
assert.equal(state.stage, "match");
assert.equal(
  state.matchArenaId,
  previewArena,
  "Match uses the arena chosen before team selection",
);
assert.equal(state.matchHostId, host.id);
const arena = state.matchArenaId,
  id = state.matchId;
assert.equal(new Set(partyRoster(state).map((p) => p.id)).size, 4);
assert.ok(peerPartySchema.safeParse(state).success);
assert.throws(() => party.action(guest.id, "team", { team: 1 }), /PROGRESS/);
assert.throws(() => party.action(host.id, "return", {}), /PLAYING/);
party.action(host.id, "rtc-end", { matchId: id, reason: "finished" });
assert.throws(() => party.action(guest.id, "rematch", {}), /HOST/);
const teams = state.members.map((m) => [m.id, m.team]);
party.action(host.id, "rematch", {});
assert.equal(state.stage, "match");
assert.notEqual(state.matchId, id);
assert.notEqual(state.matchArenaId, arena);
assert.deepEqual(
  state.members.map((m) => [m.id, m.team]),
  teams,
);
assert.equal(state.matchFinished, false);
assert.throws(() => party.action(host.id, "rematch", {}), /PLAYING/);
party.action(host.id, "rtc-end", {
  matchId: state.matchId,
  reason: "finished",
});
const rematchArena = state.matchArenaId;
party.action(host.id, "return", {});
assert.equal(state.stage, "teams");

party.action(host.id, "stage", { stage: "mode" });
party.action(host.id, "launch", {});
assert.notEqual(
  state.matchArenaId,
  rematchArena,
  "Do not repeat the immediately previous arena",
);
party.remove(fourth.id);
assert.equal(state.stage, "teams");
assert.ok(!state.members.some((m) => m.id === fourth.id));
party.action(host.id, "stage", { stage: "mode" });
party.remove(third.id);
party.action(host.id, "mode", { mode: "2v2bots" });
party.action(host.id, "gamemode", { gameMode: "heatseeker" });
party.action(host.id, "launch", {});
const roster = partyRoster(state);
assert.equal(roster.length, 4);
assert.equal(roster.filter((p) => p.controller === "bot").length, 2);
assert.ok(
  roster.filter((p) => p.controller !== "bot").every((p) => p.team === 0),
);
assert.ok(peerPartySchema.safeParse(state).success);
const uuidDescriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
try {
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
  });
  party.action(host.id, "rtc-end", {
    matchId: state.matchId,
    reason: "finished",
  });
  party.action(host.id, "return", {});
  party.action(host.id, "stage", { stage: "mode" });
  party.action(host.id, "launch", {});
  assert.match(
    state.matchId!,
    /^[0-9a-f-]{36}$/,
    "Protocol IDs use the existing cryptographic fallback",
  );
} finally {
  if (uuidDescriptor)
    Object.defineProperty(crypto, "randomUUID", uuidDescriptor);
  else delete (crypto as any).randomUUID;
}
console.log(
  "PASS random six-symbol codes, strict HELLO identity/presets, four stable-ID members, host authority, team/ready/mode/gamemode capacity, shared random arena, disconnect and 2v2-bot roster",
);
