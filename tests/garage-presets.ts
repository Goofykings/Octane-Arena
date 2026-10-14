import assert from "node:assert/strict";
import { Garage, PRESET_NAME_MAX } from "../src/game/inventory";
let storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  },
});
const g = new Garage(),
  first = g.current.id;
g.duplicate();
const second = g.current.id;
g.duplicate();
const third = g.current.id;
assert.equal(new Set(g.presets.map((p) => p.id)).size, 3);
g.rename(second, "  Midnight Circuit  ");
assert.equal(g.presets.find((p) => p.id === second)!.name, "Midnight Circuit");
assert.throws(() => g.rename(second, "   "));
assert.throws(() => g.rename(second, "x".repeat(PRESET_NAME_MAX + 1)));
assert.throws(() => g.rename(second, "bad\u0000name"));
const loaded = new Garage();
assert.equal(
  loaded.presets.find((p) => p.id === second)!.name,
  "Midnight Circuit",
);
assert.equal(loaded.selected, third);
assert.equal(loaded.delete(second), true);
assert.deepEqual(
  loaded.presets.map((p) => p.id),
  [first, third],
);
assert.equal(loaded.selected, third);
assert.equal(loaded.delete(third), true);
assert.equal(loaded.current.id, first);
assert.equal(loaded.delete(first), false);
assert.equal(loaded.delete("missing"), false);
assert.equal(new Garage().current.id, first);
const raw = JSON.parse(storage.get("octane-arena-garage")!);
raw.presets = [raw.presets[0], { ...raw.presets[0] }];
storage.set("octane-arena-garage", JSON.stringify(raw));
assert.equal(
  new Set(new Garage().presets.map((p) => p.id)).size,
  2,
  "duplicate saved IDs cannot overwrite another preset",
);
console.log(
  "PASS preset names/IDs, trimming/validation, persistence, deletion by ID, equipped fallback and final-preset guard",
);
