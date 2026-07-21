import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionIndexDb, migrateSessionIndexDb } from "../../../lib/session-index/db.ts";
import { cleanupDeletedUserSessionIndex } from "../../../lib/session-index/cleanup.ts";

let home = "";
let db: Database.Database;

before(() => {
  home = mkdtempSync(join(tmpdir(), "pi-session-delete-user-"));
  db = createSessionIndexDb(join(home, "session-index.db"));
  migrateSessionIndexDb(db);
  db.prepare(`INSERT INTO sessions (id, path, cwd, owner_username, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)`).run("a1", "/tmp/a1", "/p", "alice", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
  db.prepare(`INSERT INTO sessions (id, path, cwd, owner_username, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)`).run("b1", "/tmp/b1", "/p", "bob", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
  db.prepare(`INSERT INTO user_session_metadata (username, session_id, favorite, updated_at) VALUES (?, ?, 1, ?)`).run("alice", "a1", "2026-07-15T00:00:00.000Z");
  db.prepare(`INSERT INTO tags (id, username, name, created_at, updated_at) VALUES (1, ?, ?, ?, ?)`).run("alice", "release", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
  db.prepare(`INSERT INTO session_tags (username, session_id, tag_id, created_at) VALUES (?, ?, ?, ?)`).run("alice", "a1", 1, "2026-07-15T00:00:00.000Z");
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/p", "alice", 1, "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
  db.prepare(`INSERT INTO user_workspace_metadata (username, cwd, pinned, updated_at) VALUES (?, ?, 1, ?)`).run("alice", "/p", "2026-07-15T00:00:00.000Z");
});

after(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("cleans deleted user's index and metadata only", () => {
  cleanupDeletedUserSessionIndex(db, "alice", ["a1"]);

  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id='a1'").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id='b1'").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_session_metadata WHERE username='alice'").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM session_tags WHERE username='alice'").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tags WHERE username='alice'").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_workspace_metadata WHERE username='alice'").get() as { count: number }).count, 0);
});
