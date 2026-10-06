import assert from "node:assert/strict";
import { arenaIds, chooseMatchArena } from "../shared/arenas";
for (const previous of [undefined, ...arenaIds]) {
  const chosen = new Set();
  for (const random of [0, 0.26, 0.51, 0.76, 0.99999]) {
    const id = chooseMatchArena(previous, () => random);
    assert.ok(arenaIds.includes(id));
    assert.notEqual(id, previous);
    assert.equal(
      id,
      chooseMatchArena(previous, () => random),
    );
    chosen.add(id);
  }
  assert.equal(chosen.size, arenaIds.length - Number(previous !== undefined));
}
console.log(
  "PASS valid soccer arena pool, deterministic random samples and no consecutive repeats",
);
