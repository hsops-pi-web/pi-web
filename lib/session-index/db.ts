import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";

declare global {
  var __piSessionIndexDb: Database.Database | undefined;
}

export function createSessionIndexDb(dbPath: string): Database.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrateSessionIndexDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      cwd TEXT NOT NULL,
      owner_username TEXT,
      title TEXT,
      first_message TEXT,
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      parent_session_id TEXT,
      parent_session_path TEXT,
      orphaned INTEGER NOT NULL DEFAULT 0,
      missing INTEGER NOT NULL DEFAULT 0,
      source_mtime_ms INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT,
      index_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_owner_modified ON sessions(owner_username, modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_owner_cwd ON sessions(owner_username, cwd);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      entry_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, sequence);

    CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
      text,
      session_id UNINDEXED,
      entry_id UNINDEXED,
      role UNINDEXED,
      content='session_messages',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS session_messages_ai AFTER INSERT ON session_messages BEGIN
      INSERT INTO session_messages_fts(rowid, text, session_id, entry_id, role)
      VALUES (new.id, new.text, new.session_id, new.entry_id, new.role);
    END;

    CREATE TRIGGER IF NOT EXISTS session_messages_ad AFTER DELETE ON session_messages BEGIN
      INSERT INTO session_messages_fts(session_messages_fts, rowid, text, session_id, entry_id, role)
      VALUES('delete', old.id, old.text, old.session_id, old.entry_id, old.role);
    END;

    CREATE TRIGGER IF NOT EXISTS session_messages_au AFTER UPDATE ON session_messages BEGIN
      INSERT INTO session_messages_fts(session_messages_fts, rowid, text, session_id, entry_id, role)
      VALUES('delete', old.id, old.text, old.session_id, old.entry_id, old.role);
      INSERT INTO session_messages_fts(rowid, text, session_id, entry_id, role)
      VALUES (new.id, new.text, new.session_id, new.entry_id, new.role);
    END;

    CREATE TABLE IF NOT EXISTS workspaces (
      cwd TEXT PRIMARY KEY,
      owner_username TEXT,
      display_name TEXT,
      session_count INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT,
      indexed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workspaces_owner_active ON workspaces(owner_username, last_active_at DESC);

    CREATE TABLE IF NOT EXISTS user_session_metadata (
      username TEXT NOT NULL,
      session_id TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      custom_title TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (username, session_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (username, name)
    );

    CREATE TABLE IF NOT EXISTS session_tags (
      username TEXT NOT NULL,
      session_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (username, session_id, tag_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_workspace_metadata (
      username TEXT NOT NULL,
      cwd TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      display_name TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (username, cwd),
      FOREIGN KEY (cwd) REFERENCES workspaces(cwd) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS index_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function getSessionIndexDb(dbPath: string): Database.Database {
  if (globalThis.__piSessionIndexDb) return globalThis.__piSessionIndexDb;
  const db = createSessionIndexDb(dbPath);
  migrateSessionIndexDb(db);
  globalThis.__piSessionIndexDb = db;
  return db;
}
