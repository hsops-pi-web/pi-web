import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createAdminVisibility, listAdminVisibleOwners } from "../../../lib/auth/admin-visibility.ts";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      username TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    INSERT INTO users (username, role, disabled, created_at) VALUES
      ('alice', 'user', 0, '2026-07-16T00:00:00.000Z'),
      ('disabled_user', 'user', 1, '2026-07-16T00:00:00.000Z'),
      ('manager', 'admin', 0, '2026-07-16T00:00:00.000Z'),
      ('hsops', 'super_admin', 0, '2026-07-16T00:00:00.000Z');
  `);
});

test("ordinary admin sees enabled and disabled ordinary users only", () => {
  assert.deepEqual(listAdminVisibleOwners(db, "admin"), ["alice", "disabled_user"]);
  assert.deepEqual(createAdminVisibility(db, { username: "manager", role: "admin" }), {
    actorUsername: "manager",
    actorRole: "admin",
    visibleOwnerUsernames: ["alice", "disabled_user"],
    includeUnownedIndexIssues: false,
  });
});

test("super admin sees all existing users and unowned index issues", () => {
  assert.deepEqual(listAdminVisibleOwners(db, "super_admin"), ["alice", "disabled_user", "hsops", "manager"]);
  assert.equal(createAdminVisibility(db, { username: "hsops", role: "super_admin" }).includeUnownedIndexIssues, true);
});

test("non admin actors are rejected", () => {
  assert.throws(() => createAdminVisibility(db, { username: "alice", role: "user" }), /admin role required/);
});
