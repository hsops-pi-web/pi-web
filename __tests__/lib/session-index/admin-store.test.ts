import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSessionIndexDb, migrateSessionIndexDb } from "../../../lib/session-index/db.ts";
import { createAdminSessionIndexStore } from "../../../lib/session-index/admin-store.ts";

let db: Database.Database;
let store: ReturnType<typeof createAdminSessionIndexStore>;

const adminVisibility = {
  actorUsername: "manager",
  actorRole: "admin" as const,
  visibleOwnerUsernames: ["alice", "disabled_user"],
  includeUnownedIndexIssues: false,
};

const superVisibility = {
  actorUsername: "hsops",
  actorRole: "super_admin" as const,
  visibleOwnerUsernames: ["alice", "disabled_user", "hsops"],
  includeUnownedIndexIssues: true,
};

beforeEach(() => {
  db = createSessionIndexDb(":memory:");
  migrateSessionIndexDb(db);
  store = createAdminSessionIndexStore(db);
  const insertSession = db.prepare(`INSERT INTO sessions (id, path, cwd, owner_username, title, first_message, created_at, modified_at, message_count, missing, orphaned, index_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertSession.run("a1", "/tmp/a1", "/p/a", "alice", "Alpha", "first alpha", "2026-07-16T00:00:00.000Z", "2026-07-16T00:10:00.000Z", 2, 0, 0, null);
  insertSession.run("d1", "/tmp/d1", "/p/d", "disabled_user", "Disabled", "first disabled", "2026-07-16T00:00:00.000Z", "2026-07-16T00:20:00.000Z", 1, 0, 0, null);
  insertSession.run("h1", "/tmp/h1", "/p/h", "hsops", "Secret", "super", "2026-07-16T00:00:00.000Z", "2026-07-16T00:30:00.000Z", 1, 0, 0, null);
  insertSession.run("u1", "/tmp/u1", "/p/u", null, "Unowned", "bad", "2026-07-16T00:00:00.000Z", "2026-07-16T00:40:00.000Z", 0, 0, 1, "bad header");
  insertSession.run("m1", "/tmp/m1", "/p/a", "alice", "Missing", "missing", "2026-07-16T00:00:00.000Z", "2026-07-16T00:50:00.000Z", 0, 1, 0, null);
  insertSession.run("o1", "/tmp/o1", "/p/a", "alice", "Orphan", "orphan", "2026-07-16T00:00:00.000Z", "2026-07-16T00:55:00.000Z", 0, 0, 1, null);
  insertSession.run("x1", "/tmp/x1", "/p/a", "alice", "Index Error", "error", "2026-07-16T00:00:00.000Z", "2026-07-16T00:56:00.000Z", 0, 0, 0, "parse failed");
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/p/a", "alice", 1, "2026-07-16T00:10:00.000Z", "2026-07-16T00:11:00.000Z");
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/p/d", "disabled_user", 1, "2026-07-16T00:20:00.000Z", "2026-07-16T00:21:00.000Z");
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/p/h", "hsops", 1, "2026-07-16T00:30:00.000Z", "2026-07-16T00:31:00.000Z");
  db.prepare("INSERT INTO session_messages (session_id, entry_id, role, text, sequence) VALUES (?, ?, ?, ?, ?)").run("a1", "e1", "user", "needle public", 0);
  db.prepare("INSERT INTO session_messages (session_id, entry_id, role, text, sequence) VALUES (?, ?, ?, ?, ?)").run("h1", "e2", "user", "needle secret", 0);
});

test("admin sessions include disabled ordinary users and exclude super admin and unowned", () => {
  const result = store.listAdminSessions(adminVisibility, { page: 1, pageSize: 20, sort: "modified_desc" });
  assert.deepEqual(result.sessions.map((session) => session.id), ["d1", "a1"]);
  assert.equal(result.total, 2);
});

test("super admin index health can include unowned issues", () => {
  const result = store.getAdminIndexHealth(superVisibility, { page: 1, pageSize: 20, staleCandidateCount: 3 });
  assert.equal(result.databaseAvailable, true);
  assert.equal(result.totalSessions, 7);
  assert.equal(result.totalWorkspaces, 3);
  assert.equal(result.issueCounts.missing, 1);
  assert.equal(result.issueCounts.orphaned, 2);
  assert.equal(result.issueCounts.indexError, 2);
  assert.equal(result.staleCandidateCount, 3);
  assert.equal(result.issueCounts.unowned, 1);
  assert.equal(result.issues.some((issue) => issue.ownerUsername === null), true);
});

test("admin FTS search is permission filtered", () => {
  const result = store.searchAdminSessions(adminVisibility, { q: "needle", page: 1, pageSize: 20 });
  assert.equal(result.total, 1);
  assert.equal(result.results[0].sessionId, "a1");
});

test("user observability issues include missing orphaned and index errors", () => {
  const result = store.getAdminUserObservability(adminVisibility, "alice");
  assert.ok(result);
  assert.deepEqual(result.issues.map((session) => session.id).sort(), ["m1", "o1", "x1"]);
});

test("user summary derives lastActiveAt from max modified_at with null last", () => {
  const result = store.getOwnerSummaries(adminVisibility, ["alice", "disabled_user", "empty"]);
  assert.equal(result.get("disabled_user")?.lastActiveAt, "2026-07-16T00:20:00.000Z");
  assert.equal(result.get("empty")?.lastActiveAt, null);
});
