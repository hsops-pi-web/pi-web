import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { SUPER_ADMIN } from "./roles";
import { getAuthDbPath, getPiWebAuthDataDir } from "./data-dir";

declare global {
  var __piAuthDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (globalThis.__piAuthDb) return globalThis.__piAuthDb;
  const dir = getPiWebAuthDataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(getAuthDbPath());
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
    CREATE TABLE IF NOT EXISTS user_model_preferences (
      username TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
