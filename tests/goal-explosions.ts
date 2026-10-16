import assert from "node:assert/strict";
import * as T from "three";
import { inventory, starter, goalExplosionId } from "../shared/catalog";
import { presetSchema } from "../shared/accounts";
import { Garage } from "../src/game/inventory";
import {
  GoalExplosion,
  goalExplosionStyles,
} from "../src/effects/goal-explosion";
import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../src/game/authoritative-match";
import { Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { peerSnapshot } from "../shared/rtc";
import { decodeReplay, replayMessage } from "../shared/replay";
import { captureGoalReplay } from "./replay-capture";
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  },
});
assert.equal(inventory.explosion.length, 10);
assert.equal("decal" in inventory, false);
assert.equal("decal" in starter(), false);
const legacy = { ...starter(), decal: "circuit" };
delete (legacy as Partial<typeof legacy>).explosion;
const migrated = presetSchema.parse(legacy);
assert.equal(migrated.explosion, "pulse");
assert.equal("decal" in migrated, false);
assert.equal(
  presetSchema.parse({ ...starter(), explosion: "retired" }).explosion,
  "pulse",
);
assert.equal(
  presetSchema.safeParse({ ...starter(), wheels: "invalid", decal: "circuit" })
    .success,
  false,
  "other cosmetic validation remains strict",
);
store.set(
  "octane-arena-garage",
  JSON.stringify({ presets: [legacy], index: 0 }),
);
const garage = new Garage();
assert.equal("decal" in garage.current, false);
assert.equal(garage.current.explosion, "pulse");
garage.save();
assert.equal(
  "decal" in JSON.parse(store.get("octane-arena-garage")!).presets[0],
  false,
);
const signatures = new Set<string>();
for (const item of inventory.explosion) {
  assert.equal(goalExplosionId(item.id), item.id);
  garage.current.explosion = item.id;
  garage.save();
  assert.equal(new Garage().current.explosion, item.id);
  const scene = new T.Scene(),
    floor = new T.Mesh(
      new T.PlaneGeometry(100, 100),
      new T.MeshBasicMaterial({ color: 0x1b514b }),
    );
  scene.add(floor);
  const originalColor = floor.material.color.getHex(),
    e = new GoalExplosion(scene);
  e.trigger({ x: 0, y: 2, z: -52 }, 0x69e9ff, item.id);
  assert.equal(e.selectedId, item.id);
  assert.ok(e.active);
  assert.equal(e.washStrength, 0);
  const layers: T.InstancedMesh[] = [];
  const geos: T.BufferGeometry[] = [];
  scene.traverse((o) => {
    if (o instanceof T.InstancedMesh) layers.push(o);
    if (o instanceof T.Mesh) geos.push(o.geometry);
  });
  const buffers = layers.map((l) => l.instanceMatrix),
    colors = layers.map((l) => l.instanceColor);
  signatures.add(
    geos.map((g) => g.type + ":" + g.getAttribute("position").count).join("/") +
      ":" +
      goalExplosionStyles[item.id].kind,
  );
  e.update(0.5);
  const wash = item.id.endsWith("wash");
  assert.equal(e.washStrength > 0, wash);
  if (wash)
    assert.ok(
      e.washStrength >= 0.95,
      "special wash almost obscures the arena during hold",
    );
  assert.ok(e.washStrength <= 0.96, "strong bounded full-map flood");
  for (let i = 0; i < 360; i++) {
    e.update(1 / 120);
    layers.forEach((l, k) => {
      assert.equal(l.instanceMatrix, buffers[k]);
      assert.equal(l.instanceColor, colors[k]);
      assert.ok(Array.from(l.instanceMatrix.array).every(Number.isFinite));
    });
  }
  assert.equal(
    floor.material.color.getHex(),
    originalColor,
    "no permanent material mutation",
  );
  e.update(2);
  assert.equal(e.active, false);
  assert.equal(e.washStrength, 0);
  assert.equal(scene.getObjectByName("goal-arena-wash")!.visible, false);
  e.trigger({ x: 0, y: 2, z: 52 }, 0xffb654, item.id);
  e.update(0.7);
  e.reset();
  assert.equal(e.washStrength, 0);
  assert.equal(e.active, false);
  e.dispose();
  assert.equal(
    scene.children.length,
    1,
    "no abandoned light/overlay resources",
  );
  floor.geometry.dispose();
  floor.material.dispose();
}
assert.ok(
  signatures.size >= 8,
  "distinct meshes and effect families, not recolored spheres",
);
assert.equal(
  Object.values(goalExplosionStyles).filter((s) => s.kind === "wash").length,
  2,
);
await initializeMatchPhysics();
for (const mode of ["soccar", "heatseeker", "rumble"] as const)
  for (const team of [0, 1] as const) {
    const players = [0, 1].map((i) => ({
      id: "unique-" + i,
      name: "Same Name",
      team: i as 0 | 1,
      controller: "remote" as const,
      preset: { ...starter(), explosion: i ? "confetti" : "blue-wash" },
    }));
    const game = new NetworkMatch(players, "city", undefined, mode);
    try {
      const s = game.simulation,
        m = game.match;
      m.phase = "playing";
      s.lastTouchId = players[team].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 2, z: team ? 53.6 : -53.6 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: team ? 20 : -20 }, true);
      game.step(0);
      assert.equal(m.phase, "goal");
      const selected = players[team].preset.explosion;
      assert.equal(m.lastGoal!.scorerId, players[team].id);
      assert.equal(m.lastGoal!.explosion, selected);
      assert.equal(m.recorder.pendingGoal!.explosion, selected);
      const wire = peerSnapshot(
        game.snapshot(),
        game.id,
        players.map((p) => p.id),
      )!;
      assert.ok(wire);
      assert.equal(wire.lastGoal!.explosion, selected);
      players[team].preset.explosion = "pulse";
      captureGoalReplay(m, s, game.pads);
      assert.equal(
        m.replay!.clip.goal.explosion,
        selected,
        "scorer effect frozen at goal, not read from changed menu metadata",
      );
      assert.equal(
        decodeReplay(replayMessage(game.id, m.replay!.clip)).goal.explosion,
        selected,
      );
    } finally {
      game.dispose();
    }
  }
const s = new Simulation(),
  m = new Match();
try {
  m.explosionFor = (id) => (id === s.cars[0].id ? "violet-wash" : "pulse");
  m.start(s, "freeplay");
  s.lastTouchId = s.cars[0].id;
  s.ball.setTranslation({ x: 0, y: 2, z: -53.6 }, true);
  m.tick(s);
  assert.equal(m.recorder.pendingGoal!.neutral, true);
  assert.equal(m.recorder.pendingGoal!.explosion, "violet-wash");
} finally {
  s.dispose();
}
console.log(
  "PASS ten goal effects, two temporary readable/resettable map washes, fixed buffers/resources, retired-decal migration, preset defaults/persistence, stable-ID scorer selection in Soccar/Heatseeker/Rumble, authoritative wire and replay capture, changed-preset isolation and Free Play",
);
