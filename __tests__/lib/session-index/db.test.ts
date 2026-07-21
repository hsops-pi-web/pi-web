import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionIndexDb, migrateSessionIndexDb } from "../../../lib/session-index/db.ts";

let home = "";
let db: Database.Database;

before(() => {
  home = mkdtempSync(join(tmpdir(), "pi-session-index-db-"));
  db = createSessionIndexDb(join(home, "session-index.db"));
});

after(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("migrates schema idempotently", () => {
  migrateSessionIndexDb(db);
  migrateSessionIndexDb(db);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name").all() as { name: string }[];
  const names = tables.map((row) => row.name);

  for (const expected of [
    "index_state",
    "session_messages",
    "session_messages_fts",
    "session_tags",
    "sessions",
    "tags",
    "user_session_metadata",
    "user_workspace_metadata",
    "workspaces",
  ]) {
    assert.ok(names.includes(expected), `${expected} should exist`);
  }

  const workspacePk = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string; pk: number }[];
  assert.equal(workspacePk.find((column) => column.name === "cwd")?.pk, 1);

  const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  assert.equal(mode.journal_mode.toLowerCase(), "wal");
});

test("FTS stays synchronized through triggers", () => {
  migrateSessionIndexDb(db);
  db.prepare(`INSERT INTO sessions (id, path, cwd, owner_username, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    "s1",
    "/tmp/s1.jsonl",
    "/tmp/project",
    "alice",
    "2026-07-15T00:00:00.000Z",
    "2026-07-15T00:00:00.000Z",
  );
  db.prepare(`INSERT INTO session_messages (session_id, entry_id, role, text, sequence) VALUES (?, ?, ?, ?, ?)`).run(
    "s1",
    "e1",
    "user",
    "release reliability search text",
    0,
  );

  const hit = db.prepare(`SELECT rowid FROM session_messages_fts WHERE session_messages_fts MATCH ?`).get("reliability") as { rowid: number } | undefined;
  assert.ok(hit);
});
