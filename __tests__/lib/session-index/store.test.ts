import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionIndexDb, migrateSessionIndexDb } from "../../../lib/session-index/db.ts";
import { createSessionIndexStore } from "../../../lib/session-index/store.ts";

let home = "";
let db: Database.Database;
let store: ReturnType<typeof createSessionIndexStore>;

before(() => {
  home = mkdtempSync(join(tmpdir(), "pi-session-store-"));
  db = createSessionIndexDb(join(home, "session-index.db"));
  migrateSessionIndexDb(db);
  store = createSessionIndexStore(db);

  db.prepare(`INSERT INTO sessions (id, path, cwd, owner_username, title, first_message, created_at, modified_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("a1", "/tmp/a1", "/home/x/pi-users/alice/p", "alice", "Alpha", "first alpha", "2026-07-15T00:00:00.000Z", "2026-07-15T00:10:00.000Z", 1);
  db.prepare(`INSERT INTO sessions (id, path, cwd, owner_username, title, first_message, created_at, modified_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("a2", "/tmp/a2", "/home/x/pi-users/alice/p", "alice", "Beta", "first beta", "2026-07-15T00:00:00.000Z", "2026-07-15T00:20:00.000Z", 1);
  db.prepare(`INSERT INTO sessions (id, path, cwd, owner_username, title, first_message, created_at, modified_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("b1", "/tmp/b1", "/home/x/pi-users/bob/p", "bob", "Bob", "hidden", "2026-07-15T00:00:00.000Z", "2026-07-15T00:30:00.000Z", 1);
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/home/x/pi-users/alice/p", "alice", 2, "2026-07-15T00:20:00.000Z", "2026-07-15T00:20:01.000Z");
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/home/x/pi-users/bob/p", "bob", 1, "2026-07-15T00:30:00.000Z", "2026-07-15T00:30:01.000Z");
});

after(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("listSessions uses SQL owner filter with exact total", () => {
  const result = store.listSessions({ username: "alice", archived: "exclude", orphaned: "exclude", sort: "modified_desc", page: 1, pageSize: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, "a2");
});

test("favorite and archive are isolated per user", () => {
  store.setSessionMetadata("alice", "a1", { favorite: true, archived: true });
  assert.equal(store.listSessions({ username: "alice", favorite: true, archived: "include", orphaned: "exclude", sort: "modified_desc", page: 1, pageSize: 20 }).total, 1);
  assert.equal(store.listSessions({ username: "bob", favorite: true, archived: "include", orphaned: "exclude", sort: "modified_desc", page: 1, pageSize: 20 }).total, 0);
});

test("tags are isolated per user and filter sessions", () => {
  const tag = store.createTag("alice", { name: "release", color: "#2563eb" });
  store.addTagToSession("alice", "a2", tag.id);
  const result = store.listSessions({ username: "alice", tag: "release", archived: "exclude", orphaned: "exclude", sort: "modified_desc", page: 1, pageSize: 20 });
  assert.equal(result.total, 1);
  assert.equal(result.sessions[0].id, "a2");
});

test("bulk operations report successes and failures", () => {
  const result = store.bulkUpdate("alice", ["a1", "missing"], { operation: "favorite" });
  assert.deepEqual(result.updated, ["a1"]);
  assert.deepEqual(result.failed, [{ sessionId: "missing", error: "not_found" }]);
});

test("searchSessions returns permission-filtered FTS hits", () => {
  db.prepare("INSERT INTO session_messages (session_id, entry_id, role, text, sequence) VALUES (?, ?, ?, ?, ?)").run("a1", "m1", "user", "needle alpha", 0);
  db.prepare("INSERT INTO session_messages (session_id, entry_id, role, text, sequence) VALUES (?, ?, ?, ?, ?)").run("b1", "m2", "user", "needle hidden", 0);
  const result = store.searchSessions({ username: "alice", q: "needle", page: 1, pageSize: 20 });
  assert.equal(result.total, 1);
  assert.equal(result.results[0].sessionId, "a1");
});

test("workspace metadata uses stable cwd and is isolated per user", () => {
  assert.equal(store.setWorkspaceMetadata("alice", "/home/x/pi-users/alice/p", { pinned: true, displayName: "Main" }), true);
  assert.equal(store.setWorkspaceMetadata("bob", "/home/x/pi-users/alice/p", { pinned: true }), false);

  const workspaces = store.listWorkspaces("alice");
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].cwd, "/home/x/pi-users/alice/p");
  assert.equal(workspaces[0].pinned, true);
  assert.equal(workspaces[0].displayName, "Main");
});
