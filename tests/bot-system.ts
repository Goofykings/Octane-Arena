import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { Pads } from "../src/game/pads";
import { BotTeam } from "../src/ai/team";
import { BOT_TUNING } from "../src/ai/perception";
import { botRoster, botSizes, botDifficulties } from "../shared/bots";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const local = {
    id: "human-uuid",
    name: "Human",
    team: 0 as const,
    controller: "local" as const,
  },
  n = neutralInput();
for (const name of ["Rivet", "Aster", "Vanta", "Kestrel", "Flux", "vanta"])
  for (const size of botSizes) {
    const roster = botRoster(size, { ...local, name });
    assert.equal(new Set(roster.map((p) => p.name.toLowerCase())).size, roster.length,
      "Bot names never repeat another bot or the human's name");
  }
for (const size of botSizes)
  for (const difficulty of botDifficulties) {
    const roster = botRoster(size, local),
      [a, b] = size.split("v").map(Number),
      s = new Simulation(false, roster),
      match = new Match(),
      brain = new BotTeam(difficulty),
      pads = new Pads();
    try {
      assert.equal(s.cars.length, a + b);
      assert.equal(new Set(roster.map((p) => p.id)).size, a + b);
      assert.equal(new Set(roster.filter((p) => p.controller === "bot").map((p) => p.name)).size, a + b - 1);
      assert.deepEqual(s.cars.map((c) => [c.id, c.displayName, c.team]), roster.map((p) => [p.id, p.name, p.team]));
      assert.equal(roster.filter((p) => p.team === 0).length, a);
      assert.equal(roster.filter((p) => p.team === 1).length, b);
      match.start(s, "bot");
      assert.equal(s.cars.filter((c) => c.body.isEnabled()).length, a + b);
      assert.ok(match.kickoffFormationId);
      s.cars.forEach((c) => {
        assert.equal(c.body.mass(), P.car.mass);
        assert.equal(c.boost, 33);
      });
      const snapshot = s.world.takeSnapshot();
      brain.inputs(s, pads);
      assert.deepEqual([...brain.targets.keys()].sort(), roster.filter((p) => p.controller === "bot").map((p) => p.id).sort());
      assert.deepEqual(
        s.world.takeSnapshot(),
        snapshot,
        "AI reads the world and emits inputs; no physics mutations",
      );
      const initial = s.cars.map((c) =>
        new Vector3().copy(c.body.translation()),
      );
      for (let i = 0; i < 240; i++) {
        const inputs = brain.inputs(s, pads);
        inputs.set(local.id, n);
        s.step(inputs);
        pads.tick(s.cars);
        s.cars.forEach((c) =>
          assert.ok(
            new Vector3().copy(c.body.linvel()).length() <=
              P.car.maxSpeed + 0.01,
          ),
        );
      }
      for (let i = 1; i < s.cars.length; i++)
        assert.ok(
          initial[i].distanceTo(s.cars[i].body.translation()) > 3,
          `${size}/${difficulty}: every bot moves with real controls`,
        );
      for (const team of [0, 1]) {
        const roles = s.cars
          .filter((c) => c.team === team)
          .map((c) => brain.decision.roles.get(c.id));
        assert.equal(
          roles.filter((r) => r === "first").length,
          1,
          "Only one challenger per team",
        );
      }
      assert.ok(
        brain.perception.updates <= BOT_TUNING[difficulty].hz * 2 + 2,
        "Cached decision rate, not render/physics rate",
      );
      assert.ok(
        brain.perception.updates >= BOT_TUNING[difficulty].hz * 1.5,
        "Difficulty's configured reaction rate is actually exercised",
      );
      s.ball.setTranslation({ x: 0, y: 2, z: -P.arena.halfLength - 2 }, true);
      match.phase = "playing";
      match.tick(s);
      assert.equal(match.score[0], 1);
      assert.equal(match.stats!.players.size, a + b);
      assert.deepEqual([...match.stats!.players.keys()].sort(), roster.map((p) => p.id).sort());
      for (let i = 0; i < 120; i++) {
        s.step(s.cars.map(() => n));
        match.tick(s, pads);
      }
      assert.ok(match.replay);
      assert.equal(match.replay.clip.carIds.length, a + b);
      assert.deepEqual([...match.replay.clip.carIds].sort(), roster.map((p) => p.id).sort());
    } finally {
      s.dispose();
    }
  }
// Dynamic teammates, defender-side targeting, boost/threat priority and horizons.
const s = new Simulation(false, botRoster("3v3", local)),
  brain = new BotTeam("advanced"),
  pads = new Pads();
try {
  s.ball.setTranslation({ x: 0, y: 1, z: 0 }, true);
  s.ball.setLinvel({ x: 6, y: 3, z: -7 }, true);
  s.cars[0].reset(0, 5, 0);
  s.cars[1].reset(0, 20, 0);
  s.cars[2].reset(6, 30, 0);
  s.cars[3].reset(-6, -P.arena.halfLength + 5, 0);
  brain.inputs(s, pads);
  assert.equal(
    brain.decision.roles.get(local.id),
    "first",
    "Human is recognized as closer challenger",
  );
  assert.equal(brain.targets.get("ally-0")!.intent, "support");
  assert.ok(
    brain.targets.get("ally-0")!.shot.x > 0,
    "Prefer open side away from defender",
  );
  s.cars[0].reset(25, 40, 0);
  s.cars[1].reset(0, 4, 0);
  s.clock += 0.2;
  brain.inputs(s, pads);
  assert.equal(
    brain.decision.roles.get("ally-0"),
    "first",
    "Roles rotate with position",
  );
  s.cars[1].boost = 0;
  s.ball.setTranslation({ x: 0, y: 1, z: 30 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 20 }, true);
  s.clock += 0.2;
  brain.inputs(s, pads);
  assert.equal(brain.perception.goal?.team, 0);
  for (const c of s.cars.filter((c) => c.team === 0 && c.id !== local.id))
    assert.notEqual(
      brain.targets.get(c.id)?.intent,
      "boost",
      "Never abandon threatened goal for pads",
    );
  assert.ok(
    BOT_TUNING.advanced.horizon > BOT_TUNING.intermediate.horizon &&
      BOT_TUNING.intermediate.horizon > BOT_TUNING.beginner.horizon,
  );
} finally {
  s.dispose();
}
console.log(
  "PASS all 15 size/difficulty matches, correct six-car teams/kickoffs/real movement/physics caps/replays/stats, rate budgets, one challenger, human support, dynamic rotation, open-side targeting and defensive boost priority",
);
