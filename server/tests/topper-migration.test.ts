import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/database.js";
import { retiredToppers } from "../../shared/catalog.js";

test("retired topper accounts migrate idempotently without losing ownership or preset fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "octane-topper-test-"));
  const path = join(directory, "test.sqlite");
  let store: Store | undefined;
  try {
    store = new Store(path);
    const accounts = Object.entries(retiredToppers).map(([oldId, newId], i) => {
      const id = store!.create("Migration" + i, "fixture-hash");
      store!.db
        .prepare("DELETE FROM owned_items WHERE account_id=? AND kind='topper'")
        .run(id);
      store!.db
        .prepare("INSERT INTO owned_items VALUES(?,'topper',?,'2025-01-01')")
        .run(id, oldId);
      store!.db
        .prepare(
          "UPDATE presets SET topper=?,name='Keep my preset',boost='sparkles' WHERE account_id=?",
        )
        .run(oldId, id);
      return { id, oldId, newId, before: store!.account(id) };
    });
    store.close();
    for (let repeat = 0; repeat < 2; repeat++) {
      store = new Store(path);
      for (const { id, oldId, newId, before } of accounts) {
        const account = store.account(id);
        assert.equal(account.presets[0].topper, newId);
        assert.ok(account.owned.topper.includes(newId));
        assert.ok(
          account.owned.topper.includes(oldId),
          "archive the original entitlement",
        );
        assert.deepEqual(
          { ...account.presets[0] },
          { ...before.presets[0], topper: newId },
        );
        assert.equal(account.revision, before.revision);
        assert.equal(account.selected, before.selected);
        assert.equal(account.owned.topper.filter((x) => x === newId).length, 1);
      }
      store.close();
      store = undefined;
    }
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
