import assert from "node:assert/strict";
import {
  xpRequired,
  xpAtLevel,
  progressionAt,
  matchXP,
  type MatchCompletion,
  type XPAward,
} from "../shared/progression";
import { LocalProfile, localProfileKey } from "../src/game/local-profile";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { NetworkMatch } from "../src/game/authoritative-match";
import { neutralInput } from "../shared/player";
import { starter } from "../shared/catalog";
import { peerSnapshot } from "../shared/rtc";
import { SnapshotPublisher, readMotionFrame } from "../shared/network-stream";
import { XPAnimation } from "../src/ui/xp-animation";
import {
  helloSchema,
  peerMember,
  createPeerParty,
  PeerPartyAuthority,
} from "../shared/peer-party";
import { P } from "../src/config/physics";
const id = crypto.randomUUID(),
  other = crypto.randomUUID();
const completed = (
  overrides: Partial<MatchCompletion> = {},
): MatchCompletion => ({
  id: crypto.randomUUID(),
  mode: "bot",
  activeSeconds: 300,
  score: [2, 1],
  mvpId: id,
  players: [
    {
      id,
      team: 0,
      controller: "local",
      completed: true,
      score: 540,
      activeSeconds: 300,
      activitySeconds: 5,
    },
    {
      id: other,
      team: 1,
      controller: "remote",
      completed: true,
      score: 300,
      activeSeconds: 300,
      activitySeconds: 5,
    },
  ],
  ...overrides,
});
const example = completed();
for (const mode of ["freeplay", "training", "rings", "dribble"]) {
  assert.equal(
    matchXP({ ...example, mode } as unknown as MatchCompletion, id),
    null,
  );
}
assert.deepEqual(matchXP(example, id), {
  playtime: 1200,
  performance: 54,
  win: 100,
  mvp: 50,
  total: 1404,
});
assert.equal(matchXP(example, "spectator"), null);
assert.equal(
  matchXP(
    { ...example, players: [{ ...example.players[0], controller: "bot" }] },
    id,
  ),
  null,
);
assert.equal(
  matchXP(
    { ...example, players: [{ ...example.players[0], completed: false }] },
    id,
  ),
  null,
);
assert.equal(
  matchXP(
    {
      ...example,
      players: [{ ...example.players[0], score: 0, activitySeconds: 0 }],
    },
    id,
  ),
  null,
);
assert.equal(
  matchXP(
    {
      ...example,
      players: [{ ...example.players[0], score: 0, activitySeconds: 3 }],
    },
    id,
  )?.total,
  1350,
  "Active low-scoring defender qualifies",
);
assert.equal(
  matchXP(
    {
      ...example,
      players: [{ ...example.players[0], score: 20, activitySeconds: 0 }],
    },
    id,
  )?.total,
  1352,
);
assert.equal(
  matchXP(
    {
      ...example,
      activeSeconds: 1800,
      players: [{ ...example.players[0], activeSeconds: 1800 }],
    },
    id,
  )?.playtime,
  4800,
);
assert.equal(matchXP({ ...example, score: [2, 2] }, id)?.win, 0);
assert.equal(matchXP(example, other)?.total, 1230);
assert.equal(xpRequired(1), 1000);
assert.equal(xpRequired(19), 19000);
assert.equal(xpRequired(20), 20000);
assert.equal(xpRequired(1000), 20000);
for (const level of [1, 2, 19, 20, 21, 100, 500, 1000, 1000000]) {
  assert.deepEqual(progressionAt(xpAtLevel(level)), {
    level,
    currentLevelXP: 0,
    totalXP: xpAtLevel(level),
  });
  assert.equal(
    progressionAt(xpAtLevel(level) + xpRequired(level) - 1).level,
    level,
  );
}
assert.deepEqual(progressionAt(xpAtLevel(20) + 19500 + 1000), {
  level: 21,
  currentLevelXP: 500,
  totalXP: 210500,
});
assert.equal(
  progressionAt(Number.MAX_SAFE_INTEGER).totalXP,
  Number.MAX_SAFE_INTEGER,
);
assert.throws(() => progressionAt(Number.MAX_SAFE_INTEGER + 1));
const makeStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};
const storage = makeStorage();
storage.setItem(
  localProfileKey,
  JSON.stringify({
    localPlayerId: id,
    name: "Veteran",
    avatarId: "fox",
    stats: { wins: 9 },
  }),
);
const profile = new LocalProfile(storage);
assert.deepEqual(profile.value.progression, progressionAt(0));
assert.equal(profile.value.name, "Veteran");
assert.equal(profile.value.stats.wins, 9);
let events = 0;
const unsubscribe = profile.onXPAward((a) => {
  assert.equal(a.source.type, "MATCH");
  events++;
});
const award = await profile.completeMatch(example, id);
assert.equal(award?.amount, 1404);
assert.deepEqual(
  JSON.parse(storage.getItem(localProfileKey)!).xpAwards["MATCH:" + example.id],
  [0, 1404, 1200, 54, 100, 50],
  "Receipts persist compactly with their original breakdown",
);
assert.deepEqual(profile.value.progression, progressionAt(1404));
for (let i = 0; i < 5; i++) await profile.completeMatch(example, id);
assert.equal(events, 1);
assert.equal(profile.value.progression.totalXP, 1404);
const reloaded = new LocalProfile(storage),
  stale = new LocalProfile(storage);
assert.deepEqual(reloaded.value.progression, profile.value.progression);
assert.deepEqual(reloaded.value.xpAwards["MATCH:" + example.id], award);
await reloaded.completeMatch(example, id);
assert.equal(reloaded.value.progression.totalXP, 1404);
const rematch = completed();
await profile.completeMatch(rematch, id);
stale.customize("New name", "robot");
assert.equal(
  new LocalProfile(storage).value.progression.totalXP,
  2808,
  "Stale customization cannot erase XP",
);
await stale.completeMatch(rematch, id);
assert.equal(stale.value.progression.totalXP, 2808);
const secondStorage = makeStorage(),
  second = new LocalProfile(secondStorage);
await second.completeMatch({ ...example, mode: "network" }, other);
assert.equal(
  second.value.progression.totalXP,
  1230,
  "Party humans have independent awards",
);
await profile.completeMatch(example, "spectator");
assert.equal(profile.value.progression.totalXP, 2808);
// More than 256 matches: the persistent XP guard must outlive transient career notices.
for (let i = 0; i < 260; i++)
  await profile.awardXP(1, { type: "MATCH", id: crypto.randomUUID() });
await profile.completeMatch(example, id);
assert.equal(profile.value.progression.totalXP, 3068);
unsubscribe();
profile.reset();
assert.equal(
  profile.value.progression.totalXP,
  3068,
  "Identity/stat reset preserves progression and dedup ledger",
);
const failed = new LocalProfile({
  getItem: () => {
    throw Error();
  },
  setItem: () => {
    throw Error();
  },
});
await failed.completeMatch(example, id);
assert.equal(failed.persistent, false);
assert.equal(failed.value.progression.totalXP, 1404);
await failed.completeMatch(example, id);
assert.equal(failed.value.progression.totalXP, 1404);
Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: {
    request: () => Promise.reject(Error("Embedded browser denied lock")),
  },
});
const lockFallback = new LocalProfile(makeStorage());
await lockFallback.completeMatch(example, id);
assert.equal(lockFallback.value.progression.totalXP, 1404);
delete (navigator as any).locks;
const huge = await profile.awardXP(100000, {
  type: "MATCH",
  id: crypto.randomUUID(),
});
assert.ok(huge!.after.level > huge!.before.level + 3);
const animated: XPAward = {
  source: { type: "MATCH", id: crypto.randomUUID() },
  amount: 41000,
  before: progressionAt(xpAtLevel(20) + 19500),
  after: progressionAt(xpAtLevel(20) + 60500),
};
const animation = new XPAnimation(animated),
  levels: number[] = [],
  full: number[] = [];
for (let frame = 0; frame < 600 && !animation.done; frame++) {
  animation.advance(1 / 60);
  if (animation.levelUp) levels.push(animation.level);
  if (animation.xp === xpRequired(animation.level)) full.push(animation.level);
}
assert.ok(animation.done);
assert.deepEqual(levels, [21, 22, 23]);
assert.ok(
  [20, 21, 22].every((l) => full.includes(l)),
  "Each bar fills before resetting",
);
assert.equal(animation.xp, 500);
const skip = new XPAnimation(animated);
skip.advance(0.1);
skip.skip();
assert.equal(skip.level, 23);
assert.equal(skip.xp, 500);
assert.ok(new XPAnimation(animated, true).done);

await initializeSimulation();
const s = new Simulation(false, [
  { id, name: "Human", team: 0, controller: "local" },
  { id: other, name: "Bot", team: 1, controller: "bot" },
]);
const m = new Match(),
  n = neutralInput();
try {
  m.start(s, "bot");
  for (let i = 0; i < 360; i++) m.tick(s);
  s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
  assert.equal(m.phase, "playing");
  for (let i = 0; i < 36000; i++) {
    m.recordInput(id, { ...n, throttle: 1 });
    m.tick(s);
    if (i === 1200) {
      m.kickoff(s);
      for (let j = 0; j < 360; j++) m.tick(s);
      s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
    }
  }
  m.phase = "paused";
  for (let i = 0; i < 120; i++) {
    m.recordInput(id, { ...n, throttle: 1 });
    m.tick(s);
  }
  m.phase = "goal";
  m.freeze = 10;
  for (let i = 0; i < 120; i++) {
    m.recordInput(id, { ...n, throttle: 1 });
    m.tick(s);
  }
  m.phase = "replay"; // No clip: the phase itself must never accrue active time.
  for (let i = 0; i < 120; i++) {
    m.recordInput(id, { ...n, throttle: 1 });
    m.tick(s);
  }
  m.stats!.players.get(id)!.score = 540;
  m.score = [2, 1];
  m.finish();
  assert.equal(
    m.completion!.activeSeconds,
    300,
    "Only playing ticks count, excluding both countdowns",
  );
  assert.equal(m.completion!.players[0].activitySeconds, 300);
  assert.equal(matchXP(m.completion!, id)?.total, 1404);
  const finishId = m.completion!.id;
  m.finish();
  assert.equal(m.completion!.id, finishId);
  m.start(s, "bot");
  assert.equal(m.completion, null);
  m.phase = "playing";
  m.tick(s);
  m.finish();
  assert.notEqual(m.completion!.id, finishId);
  m.start(s, "network");
  m.phase = "playing";
  m.overtime = true;
  m.remaining = 0;
  for (let i = 0; i < 120; i++) m.tick(s);
  m.finish();
  assert.equal(
    m.completion!.activeSeconds,
    1,
    "Overtime counts as active play",
  );
  m.start(s, "freeplay");
  m.phase = "playing";
  m.tick(s);
  m.finish();
  assert.equal(
    m.completion,
    null,
    "Free Play/training never creates an XP completion",
  );
} finally {
  s.world.free();
}
for (const gameMode of [
  "soccar",
  "heatseeker",
  "rumble",
  "hoops",
  "dropshot",
] as const) {
  const players = [id, other].map((pid, i) => ({
    id: pid,
    name: "Human " + i,
    team: i as 0 | 1,
    controller: "remote" as const,
    preset: starter(),
  }));
  const game = new NetworkMatch(players, undefined, undefined, gameMode);
  try {
    game.match.phase = "playing";
    for (let tick = 1; tick <= 480; tick++) {
      game.accept(id, tick, { ...n, throttle: 1 }, tick * P.dt * 1000);
      game.accept(other, tick, { ...n, steer: 0.5 }, tick * P.dt * 1000);
      game.step(tick * P.dt * 1000);
    }
    game.match.score = [1, 0];
    game.match.stats!.players.get(id)!.score = 540;
    const publisher = new SnapshotPublisher();
    publisher.packet(game.snapshot(), id);
    game.match.finish();
    const snapshot = game.snapshot();
    assert.equal(snapshot.completion!.id, game.id);
    assert.equal(snapshot.completion!.activeSeconds, 4);
    assert.equal(snapshot.completion!.players[0].activitySeconds, 4);
    assert.equal(snapshot.completion!.mvpId, id);
    assert.ok(peerSnapshot(snapshot, game.id, [id, other]));
    const packet = publisher.packet(snapshot, id);
    assert.equal(
      packet.type,
      "snapshot",
      "End-of-match data is transmitted immediately",
    );
    assert.equal(matchXP(snapshot.completion!, id)?.total, 220);
    assert.equal(matchXP(snapshot.completion!, other)?.total, 16);
    const repeated = {
      ...snapshot,
      tick: snapshot.tick + 4,
      time: snapshot.time + 4 * P.dt,
    };
    const motion = publisher.packet(repeated, other);
    const restored =
      motion.type === "snapshot" ? motion : readMotionFrame(motion, snapshot)!;
    assert.deepEqual(
      restored.completion,
      snapshot.completion,
      "Compact packets preserve completion metadata",
    );
  } finally {
    game.simulation.world.free();
  }
}
const hello = helloSchema.parse({
  type: "party-hello",
  version: "0.1.2",
  profile: { localPlayerId: id, name: "Veteran", level: 23, totalXP: 999999 },
  preset: starter(),
});
assert.equal(hello.profile.level, 23);
assert.equal(
  "totalXP" in hello.profile,
  false,
  "XP totals are private local data, only level is shared",
);
const host = peerMember(hello),
  party = createPeerParty("ABCDEF", host),
  authority = new PeerPartyAuthority(party);
party.stage = "match";
authority.appearance(host.id, {
  ...hello,
  profile: { ...hello.profile, level: 24 },
});
assert.equal(
  party.members[0].level,
  24,
  "Level changes also propagate from results",
);
console.log(
  "PASS XP formula, idle/spectator/bot exclusions, level overflow/no cap, persistence/migration/dedup, stale-tab safety, animation/skip, five authoritative modes and party metadata",
);
