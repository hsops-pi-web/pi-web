import Database from "better-sqlite3";
import os from "os";
import path from "path";
import { mkdirSync } from "fs";
import { SUPER_ADMIN } from "./roles";

declare global {
  // eslint-disable-next-line no-var
  var __piAuthDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (globalThis.__piAuthDb) return globalThis.__piAuthDb;
  const dir = path.join(os.homedir(), ".pi-web-auth");
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "auth.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const hasColumn = (name: string) => columns.some((column) => column.name === name);
  if (!hasColumn("role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!hasColumn("disabled")) {
    db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  }
  db.prepare("UPDATE users SET role='super_admin' WHERE username=?").run(SUPER_ADMIN);
  globalThis.__piAuthDb = db;
  return db;
}
