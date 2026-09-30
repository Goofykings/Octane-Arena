import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { configuration } from "./config.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const config = configuration(),
  target = resolve(
    process.argv[2] ??
      `backups/arena-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );
if (target === config.database || existsSync(target))
  throw Error(
    "Choose a new backup filename. Existing files will not be overwritten.",
  );
if (!existsSync(config.database)) throw Error("Database does not exist.");
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(config.database, { readOnly: true });
try {
  await backup(db, target);
  console.log(`Database backup created: ${target}`);
} finally {
  db.close();
}
