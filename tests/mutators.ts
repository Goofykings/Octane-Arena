import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import {
  DEFAULT_MUTATORS as D,
  MUTATOR_TUNING as M,
  mutatorOptions,
  mutatorKeys,
  matchMutators,
  sameMutators,
  type MatchMutators,
} from "../shared/mutators";
import { resolveMutators } from "../src/config/mutators";
import { MutatorStore } from "../src/game/mutator-store";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
import { Match } from "../src/game/match";
import { Pads } from "../src/game/pads";
import { JumpState } from "../src/car/dodge";
import { neutralInput } from "../shared/player";
import { starter, bodies } from "../shared/catalog";
import { NetworkMatch } from "../src/game/authoritative-match";
import { peerSnapshot } from "../shared/rtc";
import {
  generatePeerCode,
  createPeerParty,
  PeerPartyAuthority,
  peerMember,
  helloSchema,
  peerPartySchema,
} from "../shared/peer-party";
import { scoringTeam, goalIntersection } from "../src/game/goals";
import { predictGoal } from "../src/game/ball-prediction";
import { replayMessage, decodeReplay } from "../shared/replay";
import { captureGoalReplay } from "./replay-capture";
import { BotTeam } from "../src/ai/team";
await initializeSimulation();
const n = neutralInput(),
  baseline = JSON.stringify(P),
  config = (patch: Partial<MatchMutators>) => matchMutators({ ...D, ...patch });
const close = (a: number, b: number, eps = 1e-4) =>
  assert.ok(Math.abs(a - b) < eps, a + " vs " + b);
const fixture = (patch: Partial<MatchMutators> = {}, flat = true) => {
  const s = new Simulation(flat);
  s.configureMutators(config(patch));
  s.reset();
  return s;
};
const step = (s: Simulation, count: number, input = n) => {
  for (let i = 0; i < count; i++) s.step([input, n]);
};
assert.equal(
  resolveMutators(D),
  P,
  "all-default settings preserve exact baseline physics",
);
assert.throws(() => matchMutators({ ...D, gravity: "NONE" }));
assert.throws(() => matchMutators({ ...D, unknown: 1 }));
let saved = "";
const store = new MutatorStore({
  getItem: () => saved,
  setItem: (_, value) => (saved = value),
});
store.save(config({ gravity: "LOW" }));
assert.equal(
  new MutatorStore({ getItem: () => saved, setItem: () => {} }).value.gravity,
  "LOW",
);
assert.ok(Object.isFrozen(store.value));
for (const key of mutatorKeys)
  for (const value of mutatorOptions[key]) {
    const s = fixture({ [key]: value });
    const p = resolveMutators(s.mutators);
    close(s.world.gravity.y, -p.gravity);
    close(s.ball.mass(), p.ball.mass);
    close(s.ballCollider.radius(), p.ball.radius);
    close(s.ballCollider.restitution(), p.ball.restitution);
    for (const c of s.cars) {
      assert.equal(c.physics, s.physics);
      assert.equal(c.mutators, s.mutators);
    }
    s.cars[1].body.setEnabled(false);
    s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
    s.ball.setLinvel({ x: 7, y: 0, z: 0 }, true);
    step(s, 120);
    assert.ok(
      [
        ...Object.values(s.ball.translation()),
        ...Object.values(s.ball.linvel()),
      ].every(Number.isFinite),
      key + " " + value,
    );
    assert.equal(JSON.stringify(P), baseline, "mutators cannot leak into P");
    s.dispose();
  }
// Default matches reproduce unconfigured worlds over throttle, boost, jump and powerslide.
{
  const a = new Simulation(true),
    b = fixture();
  a.reset();
  for (let i = 0; i < 600; i++) {
    const input = {
      ...n,
      throttle: 1,
      boost: i < 170,
      steer: i > 100 && i < 270 ? 0.5 : 0,
      slide: i > 100 && i < 210,
      jump: i === 320 || i === 360,
    };
    a.step([input, n]);
    b.step([input, n]);
    close(
      new Vector3()
        .copy(a.cars[0].body.translation())
        .distanceTo(b.cars[0].body.translation()),
      0,
      1e-6,
    );
    assert.deepEqual(a.cars[0].body.rotation(), b.cars[0].body.rotation());
  }
  a.dispose();
  b.dispose();
}
for (const length of mutatorOptions.matchLength) {
  const s = fixture({ matchLength: length }),
    m = new Match();
  m.start(s, "bot");
  assert.equal(m.remaining, M.duration[length] ?? 0);
  assert.equal(m.timed, length !== "UNLIMITED");
  m.phase = "playing";
  m.score = [1, 0];
  const before = m.remaining;
  for (let i = 0; i < 360; i++) {
    s.step([n, n]);
    m.tick(s);
  }
  if (length === "UNLIMITED") {
    assert.equal(m.phase, "playing");
    assert.equal(m.overtime, false);
    assert.equal(m.remaining, 0);
  } else close(before - m.remaining, 3, 1e-6);
  s.dispose();
}
for (const mode of mutatorOptions.boostAmount) {
  const s = fixture({ boostAmount: mode }),
    pads = new Pads(),
    c = s.cars[0];
  c.reset(0, 0, 0, 10);
  c.boost = 20;
  c.applyBoostRule();
  const before = c.boost;
  step(s, 120);
  const expected =
    mode === "UNLIMITED"
      ? 100
      : mode === "NO BOOST"
        ? 0
        : mode === "RECHARGE SLOW"
          ? 25
          : mode === "RECHARGE FAST"
            ? 35
            : 20;
  close(c.boost, expected);
  c.boost = 20;
  c.applyBoostRule();
  step(s, 30, { ...n, boost: true });
  if (mode === "UNLIMITED") assert.equal(c.boost, 100);
  else if (mode === "NO BOOST") {
    assert.equal(c.boost, 0);
    assert.equal(c.boosting, false);
  } else
    assert.ok(
      c.boost < before + 1,
      "boost is consumed normally including recharge",
    );
  if (mode === "RECHARGE SLOW" || mode === "RECHARGE FAST") {
    const stopped = c.boost;
    step(s, 240);
    close(c.boost, stopped, 1e-6);
    step(s, 120);
    close(c.boost, stopped + M.recharge[mode], 1e-5);
    step(s, 1, { ...n, boost: true });
    const checkpoint = c.capturePrediction();
    const used = c.boost;
    step(s, 120);
    close(c.boost, used, 1e-6);
    c.restorePrediction(checkpoint);
    close(c.boostRechargeDelay, 2, 1e-6);
    step(s, 240);
    close(c.boost, used, 1e-6);
    step(s, 120);
    close(c.boost, used + M.recharge[mode], 1e-5);
    c.boost = 0;
    step(s, 240, { ...n, boost: true });
    close(c.boost, 0, 1e-6);
  }
  const pad = pads.items.find((p) => !p.large)!;
  c.reset(pad.x, pad.z, 0);
  c.boost = 0;
  c.applyBoostRule();
  const pickups = pads.tick([c]);
  assert.equal(
    pickups.length,
    mode === "NO BOOST" || mode === "UNLIMITED" ? 0 : 1,
  );
  if (pickups.length) assert.equal(c.boost, 12);
  else if (mode === "NO BOOST") assert.equal(c.boost, 0);
  s.dispose();
}
for (const strength of mutatorOptions.boostStrength) {
  const s = fixture({ boostStrength: strength, boostAmount: "UNLIMITED" }),
    c = s.cars[0];
  c.reset(0, 0, 0, 12);
  step(s, 24, { ...n, boost: true });
  close(
    c.body.linvel().z,
    -(P.car.boostAir * M.boostStrength[strength] + P.car.airThrottle) * 0.2,
    0.02,
  );
  close(
    c.physics.car.maxSpeed,
    P.car.maxSpeed * Math.sqrt(M.boostStrength[strength]),
  );
  assert.equal(c.physics.car.brake, P.car.brake);
  assert.equal(c.physics.car.grip, P.car.grip);
  s.dispose();
}
for (const gravity of mutatorOptions.gravity) {
  const s = fixture({ gravity });
  s.ball.setTranslation({ x: 0, y: 12, z: 0 }, true);
  step(s, 24);
  close(s.ball.linvel().y, -P.gravity * M.gravity[gravity] * 0.2, 0.03);
  s.dispose();
}
for (const jumps of mutatorOptions.airJumps) {
  const j = new JumpState();
  j.configureAirJumps(jumps);
  assert.equal(j.step({ ...n, jump: true }, true, P.dt), "first");
  j.step(n, false, P.dt);
  const count =
    jumps === "DEFAULT" ? 1 : jumps === "INFINITE" ? 12 : Number(jumps);
  for (let k = 0; k < count; k++) {
    assert.equal(j.step({ ...n, jump: true }, false, P.dt), "double");
    for (let frame = 0; frame < 10; frame++)
      assert.equal(
        j.step({ ...n, jump: true }, false, P.dt),
        null,
        "held button cannot repeat",
      );
    j.step(n, false, P.dt);
  }
  if (jumps !== "INFINITE")
    assert.equal(j.step({ ...n, jump: true }, false, P.dt), null);
  j.acquireReset();
  assert.ok(j.available);
  assert.ok(j.availableAirJumps >= 1);
  j.step(n, false, P.dt);
  assert.equal(
    j.step(
      { ...n, jump: true, yaw: -1, steer: -1, roll: 1, directionalRoll: 1 },
      false,
      P.dt,
    ),
    "dodge",
  );
  assert.equal(j.stall, true);
  assert.equal(j.flipLeft, 0);
  j.age = 1;
  j.step(n, true, P.dt);
  assert.equal(j.availableAirJumps, M.airJumps[jumps]);
  j.reset();
  j.used = true;
  j.age = 4;
  assert.equal(
    j.available,
    jumps !== "DEFAULT",
    "default time limit is preserved; custom count is retained",
  );
}
for (const speed of mutatorOptions.ballMaxSpeed) {
  const s = fixture({ ballMaxSpeed: speed });
  s.cars.forEach((c) => c.body.setEnabled(false));
  s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
  s.ball.setLinvel({ x: 300, y: 0, z: 0 }, true);
  step(s, 1);
  close(new Vector3().copy(s.ball.linvel()).length(), s.physics.ball.maxSpeed);
  assert.equal(s.physics.car.maxSpeed, P.car.maxSpeed);
  s.dispose();
}
const hitSpeeds: number[] = [],
  recoil: number[] = [];
for (const weight of [
  "VERY HEAVY",
  "HEAVY",
  "DEFAULT",
  "LIGHT",
  "VERY LIGHT",
] as const) {
  const s = fixture({ ballPhysics: weight }),
    c = s.cars[0];
  s.cars[1].body.setEnabled(false);
  c.reset(0, 0, 0);
  step(s, 60);
  s.ball.setTranslation({ x: 0, y: s.physics.ball.radius + 0.01, z: -3 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  c.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
  let hit = false;
  for (let i = 0; i < 90; i++) {
    s.step([n, n]);
    if (s.ballContacts[0].impulse.lengthSq() > 0) {
      hit = true;
      break;
    }
  }
  assert.ok(hit, weight + " physically hits the ball");
  hitSpeeds.push(-s.ball.linvel().z);
  recoil.push(-c.body.linvel().z);
  s.dispose();
}
for (let i = 1; i < hitSpeeds.length; i++) {
  assert.ok(hitSpeeds[i] > hitSpeeds[i - 1], JSON.stringify(hitSpeeds));
  assert.ok(recoil[i] > recoil[i - 1], JSON.stringify(recoil));
}
const bounces: number[] = [];
for (const bounce of mutatorOptions.ballBounciness) {
  const s = fixture({ ballBounciness: bounce });
  s.cars.forEach((c) => c.body.setEnabled(false));
  s.ball.setTranslation({ x: 0, y: s.physics.ball.radius + 1, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: -8, z: 0 }, true);
  let up = 0;
  for (let i = 0; i < 100; i++) {
    s.step([n, n]);
    up = Math.max(up, s.ball.linvel().y);
  }
  assert.ok(up > 0);
  bounces.push(up);
  s.dispose();
}
for (let i = 1; i < bounces.length; i++)
  assert.ok(bounces[i] > bounces[i - 1], JSON.stringify(bounces));
for (const size of mutatorOptions.ballSize) {
  const s = fixture({ ballSize: size }),
    r = s.physics.ball.radius;
  assert.equal(
    scoringTeam({ x: 0, y: r, z: -(P.arena.halfLength + r + 0.02) }, r),
    0,
  );
  assert.equal(
    scoringTeam({ x: 0, y: r, z: -(P.arena.halfLength + r - 0.02) }, r),
    null,
  );
  assert.equal(
    scoringTeam(
      {
        x: P.arena.goalHalf - r + 0.01,
        y: r,
        z: -(P.arena.halfLength + r + 0.1),
      },
      r,
    ),
    null,
  );
  close(
    goalIntersection({ x: 0, y: r, z: -P.arena.halfLength }, -1, r)!.radius,
    r,
  );
  assert.ok(
    predictGoal(
      {
        position: { x: 0, y: r + 0.5, z: -P.arena.halfLength + 3 },
        velocity: { x: 0, y: 0, z: -12 },
        heat: null,
        physics: s.physics,
      },
      s.world,
      2,
    ),
  );
  s.dispose();
}
// Each custom jump count also restores through actual underside/ball contact.
for (const airJumps of mutatorOptions.airJumps) {
  const s = fixture({ airJumps, ballSize: "GIGANTIC" }),
    c = s.cars[0],
    d = bodies[c.bodyId];
  s.cars[1].body.setEnabled(false);
  s.world.gravity = { x: 0, y: 0, z: 0 };
  c.reset(0, 0, 0, 8);
  c.jump.used = true;
  c.jump.second = true;
  c.jump.availableAirJumps = 0;
  s.ball.setTranslation(
    new Vector3(
      0,
      d.hitboxY - d.halfHeight - s.physics.ball.radius + 0.025,
      0,
    ).add(c.body.translation()),
    true,
  );
  step(s, 3);
  assert.equal(c.flipResetSequence, 1);
  assert.ok(c.jump.available);
  assert.ok(c.jump.availableAirJumps >= 1);
  s.dispose();
}
const combos = [
  config({
    gravity: "LOW",
    boostStrength: "10X",
    boostAmount: "UNLIMITED",
    airJumps: "INFINITE",
  }),
  config({
    ballSize: "GIGANTIC",
    ballPhysics: "VERY LIGHT",
    ballBounciness: "SUPER HIGH",
    ballMaxSpeed: "SUPER FAST",
  }),
];
for (const selected of combos) {
  const s = new Simulation(false);
  s.configureMutators(selected);
  s.reset();
  const before = s.containmentRecoveries;
  for (let i = 0; i < 2400; i++) {
    s.step([
      {
        ...n,
        throttle: 1,
        boost: i < 1200,
        steer: 0.25,
        slide: i % 600 < 120,
        jump: i % 150 === 0,
      },
      n,
    ]);
    assert.ok(
      [
        ...Object.values(s.ball.translation()),
        ...Object.values(s.cars[0].body.translation()),
      ].every(Number.isFinite),
    );
  }
  assert.equal(
    s.containmentRecoveries,
    before,
    "combination stays within the real arena shell",
  );
  s.configureMutators();
  s.reset();
  assert.equal(s.physics, P);
  close(s.ball.mass(), P.ball.mass);
  close(s.ballCollider.radius(), P.ball.radius);
  close(s.world.gravity.y, -P.gravity);
  s.dispose();
}
// The same shared settings survive host setup, worker/native authority snapshots and replays.
const member = () =>
  peerMember(
    helloSchema.parse({
      type: "party-hello",
      version: "0.1.2",
      profile: {
        localPlayerId: crypto.randomUUID(),
        name: "Pilot",
        avatarId: "helmet",
      },
      preset: starter(),
    }),
  );
const host = member(),
  guest = member(),
  party = new PeerPartyAuthority(createPeerParty(generatePeerCode(), host));
party.join(guest);
assert.throws(
  () => party.action(guest.id, "mutators", { mutators: combos[1] }),
  /HOST/,
);
party.action(host.id, "mutators", { mutators: combos[1] });
assert.deepEqual(peerPartySchema.parse(party.state).mutators, combos[1]);
party.action(host.id, "stage", { stage: "mode" });
party.action(host.id, "launch", {});
assert.throws(() => party.action(host.id, "mutators", { mutators: D }));
const players = [
  {
    id: "human",
    name: "Pilot",
    team: 0 as const,
    controller: "local" as const,
    preset: starter(),
  },
  {
    id: "opponent",
    name: "Bot",
    team: 1 as const,
    controller: "bot" as const,
    preset: starter(),
  },
];
for (const mode of ["soccar", "heatseeker", "rumble"] as const) {
  const net = new NetworkMatch(
    players,
    "city",
    crypto.randomUUID(),
    mode,
    players,
    config({ ...combos[1], boostAmount: "NO BOOST", matchLength: "UNLIMITED" }),
  );
  const s = net.simulation,
    m = net.match;
  assert.ok(
    sameMutators(
      peerSnapshot(
        net.snapshot(),
        net.id,
        players.map((p) => p.id),
      )!.mutators!,
      s.mutators,
    ),
  );
  assert.equal(m.timed, false);
  assert.ok(s.cars.every((c) => c.boost === (mode === "heatseeker" ? 100 : 0)));
  if (mode === "heatseeker") {
    assert.ok(s.ball.translation().y > s.physics.ball.radius);
    s.heatseeker!.touch("human", 0, 1);
    for (let i = 0; i < 100; i++) s.heatseeker!.touch("human", 0, i + 2);
    close(s.heatseeker!.state.speed, s.physics.ball.maxSpeed);
    step(s, 100);
    assert.ok(
      new Vector3().copy(s.ball.linvel()).length() <=
        s.physics.ball.maxSpeed + 1e-4,
    );
  }
  if (mode === "rumble") {
    m.phase = "playing";
    m.tick(s);
    assert.equal(s.rumble!.grant("human", "HAYMAKER"), true);
    s.cars[0].reset(0, 0, 0, 10);
    s.ball.setTranslation({ x: 0, y: 10, z: -8 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    assert.ok(s.rumble!.use("human"));
    assert.ok(new Vector3().copy(s.ball.linvel()).length() > 10);
  }
  net.dispose();
}
{
  const s = fixture({ ballSize: "GIGANTIC", matchLength: "UNLIMITED" }, false),
    m = new Match();
  m.start(s, "bot");
  m.phase = "playing";
  step(s, 120);
  m.tick(s);
  s.ball.setTranslation(
    {
      x: 0,
      y: s.physics.ball.radius + 0.1,
      z: -(P.arena.halfLength + s.physics.ball.radius + 0.1),
    },
    true,
  );
  m.tick(s);
  assert.equal(m.phase, "goal");
  captureGoalReplay(m, s);
  assert.deepEqual(
    decodeReplay(replayMessage("match", m.replay!.clip)).mutators,
    s.mutators,
  );
  m.phase = "replay";
  m.skipReplay("player", m.replay!.clip.goal.id, s);
  assert.equal(m.phase, "countdown");
  assert.equal(m.overtime, false);
  s.dispose();
}
{
  const s = fixture({ gravity: "LOW", boostAmount: "NO BOOST" }, false),
    bot = new BotTeam("beginner"),
    pads = new Pads();
  bot.prepare(s, pads);
  for (let i = 0; i < 300; i++) {
    const inputs = bot.inputs(s, pads);
    s.step(s.cars.map((c) => inputs.get(c.id) ?? n));
    assert.ok(s.cars.every((c) => c.boost === 0));
  }
  const m = new Match();
  m.start(s, "freeplay");
  assert.equal(s.physics, P);
  assert.ok(sameMutators(m.mutators, D));
  s.dispose();
}
assert.equal(JSON.stringify(P), baseline);
console.log(
  "PASS all mutator options, default equivalence, boost/jumps/reset/stall, mass/recoil, bounce, radius/goal/prediction, combinations/containment, authority, Heatseeker/Rumble and replay",
);
