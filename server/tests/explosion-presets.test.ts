import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database.js";
test("retired decal columns/items migrate without losing presets or new explosion saves", () => {
  mkdirSync("../.tools", { recursive: true });
  const file = resolve(
    "../.tools/explosion-legacy-" + randomUUID() + ".sqlite",
  );
  let db: Store | undefined;
  try {
    db = new Store(file);
    const id = db.create("MigrationTest", "not-an-auth-test");
    const before = db.account(id);
    db.db.exec(
      "ALTER TABLE presets ADD COLUMN decal TEXT NOT NULL DEFAULT 'circuit'",
    );
    db.db
      .prepare("INSERT INTO owned_items VALUES(?,?,?,?)")
      .run(id, "decal", "circuit", new Date().toISOString());
    db.close();
    db = new Store(file);
    assert.equal(
      db.db
        .prepare("PRAGMA table_info(presets)")
        .all()
        .some((c) => c.name === "decal"),
      false,
    );
    const after = db.account(id);
    assert.deepEqual(after.presets, before.presets);
    assert.equal(after.owned.decal, undefined);
    const changed = { ...after.presets[0], explosion: "blue-wash" };
    assert.equal(
      db.save(id, {
        revision: after.revision,
        avatarId: after.avatarId,
        titleId: after.titleId,
        selected: after.selected,
        presets: [changed],
        settings: after.settings,
      }),
      "saved",
    );
    assert.equal(db.account(id).presets[0].explosion, "blue-wash");
    assert.equal("decal" in db.account(id).presets[0], false);
  } finally {
    db?.close();
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(file + suffix)) unlinkSync(file + suffix);
  }
});
