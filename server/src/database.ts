import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { inventory, starter, type Preset } from "../../shared/catalog.js";
import { defaults } from "../../shared/settings.js";
import {
  titles,
  type AccountData,
  type AccountSave,
} from "../../shared/accounts.js";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
      INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,xp INTEGER NOT NULL DEFAULT 0 CHECK(xp>=0),level INTEGER NOT NULL DEFAULT 1 CHECK(level>=1),avatar_id TEXT NOT NULL DEFAULT 'helmet',title_id TEXT NOT NULL DEFAULT 'rookie',selected_preset TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS owned_items(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,item_id TEXT NOT NULL,unlocked_at TEXT NOT NULL,PRIMARY KEY(account_id,kind,item_id));
      CREATE TABLE IF NOT EXISTS presets(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,id TEXT NOT NULL,position INTEGER NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,blue TEXT NOT NULL,orange TEXT NOT NULL,wheels TEXT NOT NULL,boost TEXT NOT NULL,topper TEXT NOT NULL,decal TEXT NOT NULL,explosion TEXT NOT NULL,PRIMARY KEY(account_id,id));
      CREATE TABLE IF NOT EXISTS settings(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,key TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(account_id,key));
      CREATE TABLE IF NOT EXISTS ratings(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,mode TEXT NOT NULL,rating INTEGER,games INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,mode));
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);
    if (
      this.db.prepare("SELECT version FROM schema_version").get()!.version !== 1
    )
      throw Error("Unsupported database schema version.");
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  create(username: string, passwordHash: string) {
    return this.transaction(() => {
      const id = randomUUID(),
        now = new Date().toISOString(),
        p = starter();
      p.id = randomUUID();
      this.db
        .prepare("INSERT INTO accounts VALUES(?,?,?,?,?)")
        .run(id, username, username.toLowerCase(), passwordHash, now);
      this.db
        .prepare("INSERT INTO profiles(account_id,selected_preset) VALUES(?,?)")
        .run(id, p.id);
      const item = this.db.prepare("INSERT INTO owned_items VALUES(?,?,?,?)");
      for (const [kind, items] of Object.entries(inventory))
        for (const value of items) item.run(id, kind, value.id, now);
      for (const title of titles.filter((t) => t.level === 1))
        item.run(id, "title", title.id, now);
      for (const mode of ["1v1", "2v2", "3v3"])
        this.db
          .prepare("INSERT INTO ratings(account_id,mode) VALUES(?,?)")
          .run(id, mode);
      this.writePresets(id, [p]);
      this.writeSettings(id, defaults());
      return id;
    });
  }
  private writePresets(id: string, presets: Preset[]) {
    this.db.prepare("DELETE FROM presets WHERE account_id=?").run(id);
    const insert = this.db.prepare(
      "INSERT INTO presets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    presets.forEach((p, i) =>
      insert.run(
        id,
        p.id,
        i,
        p.name,
        p.body,
        p.blue,
        p.orange,
        p.wheels,
        p.boost,
        p.topper,
        p.decal,
        p.explosion,
      ),
    );
  }
  private writeSettings(id: string, value: AccountData["settings"]) {
    this.db.prepare("DELETE FROM settings WHERE account_id=?").run(id);
    const insert = this.db.prepare("INSERT INTO settings VALUES(?,?,?)");
    for (const [section, v] of Object.entries(value)) {
      if (typeof v === "object")
        for (const [key, leaf] of Object.entries(v))
          insert.run(id, `${section}.${key}`, JSON.stringify(leaf));
      else insert.run(id, section, JSON.stringify(v));
    }
  }
  account(id: string): AccountData {
    const row = this.db
      .prepare(
        "SELECT a.id,a.username,a.created_at,p.* FROM accounts a JOIN profiles p ON a.id=p.account_id WHERE a.id=?",
      )
      .get(id)!;
    const owned: Record<string, string[]> = {};
    for (const item of this.db
      .prepare("SELECT kind,item_id FROM owned_items WHERE account_id=?")
      .all(id))
      (owned[String(item.kind)] ??= []).push(String(item.item_id));
    const settings = defaults();
    for (const r of this.db
      .prepare("SELECT key,value_json FROM settings WHERE account_id=?")
      .all(id)) {
      const [section, key] = String(r.key).split(".");
      if (!(section in settings)) continue;
      const value = JSON.parse(String(r.value_json));
      if (key)
        (settings as unknown as Record<string, Record<string, unknown>>)[
          section
        ][key] = value;
      else (settings as unknown as Record<string, unknown>)[section] = value;
    }
    return {
      id: String(row.id),
      username: String(row.username),
      createdAt: String(row.created_at),
      xp: Number(row.xp),
      level: Number(row.level),
      avatarId: String(row.avatar_id),
      titleId: String(row.title_id),
      revision: Number(row.revision),
      selected: String(row.selected_preset),
      owned,
      settings,
      presets: this.db
        .prepare(
          "SELECT id,name,body,blue,orange,wheels,boost,topper,decal,explosion FROM presets WHERE account_id=? ORDER BY position",
        )
        .all(id) as unknown as Preset[],
      ratings: this.db
        .prepare(
          "SELECT mode,rating,games FROM ratings WHERE account_id=? ORDER BY mode",
        )
        .all(id) as unknown as AccountData["ratings"],
    };
  }
  save(id: string, data: AccountSave): "saved" | "conflict" | "unowned" {
    return this.transaction(() => {
      const current = this.account(id);
      if (current.revision !== data.revision) return "conflict";
      if (!current.owned.title?.includes(data.titleId)) return "unowned";
      for (const p of data.presets)
        for (const kind of Object.keys(inventory) as (keyof typeof inventory)[])
          if (!current.owned[kind]?.includes(p[kind])) return "unowned";
      this.writePresets(id, data.presets);
      this.writeSettings(id, data.settings);
      this.db
        .prepare(
          "UPDATE profiles SET avatar_id=?,title_id=?,selected_preset=?,revision=revision+1 WHERE account_id=?",
        )
        .run(data.avatarId, data.titleId, data.selected, id);
      return "saved";
    });
  }
  close() {
    this.db.close();
  }
}
