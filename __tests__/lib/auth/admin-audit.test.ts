import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  listAdminAuditEvents,
  migrateAdminAudit,
  recordAdminAuditEvent,
  shouldRecordViewAudit,
} from "../../../lib/auth/admin-audit.ts";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrateAdminAudit(db);
});

test("records and filters audit events", () => {
  recordAdminAuditEvent(db, {
    actorUsername: "root",
    actorRole: "super_admin",
    action: "user.disable",
    targetUsername: "alice",
    targetType: "user",
    targetId: "alice",
    status: "success",
    summary: "disabled alice",
    metadata: { disabled: 1 },
  });

  const result = listAdminAuditEvents(db, {
    visibleTargetUsernames: ["alice"],
    actor: undefined,
    target: "alice",
    action: "user.disable",
    status: "success",
    page: 1,
    pageSize: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.events[0].actorUsername, "root");
  assert.equal(result.events[0].metadataJson, JSON.stringify({ disabled: 1 }));
});

test("ordinary admin audit filtering does not leak invisible targets", () => {
  recordAdminAuditEvent(db, {
    actorUsername: "manager",
    actorRole: "admin",
    action: "user.role_update",
    targetUsername: "hsops",
    targetType: "user",
    targetId: "hsops",
    status: "failure",
    summary: "denied",
  });

  const result = listAdminAuditEvents(db, {
    visibleTargetUsernames: ["alice"],
    actor: "manager",
    page: 1,
    pageSize: 10,
  });

  assert.equal(result.total, 0);
});

test("view audit dedupes within a thirty minute window", () => {
  const first = shouldRecordViewAudit(db, "admin", "alice", new Date("2026-07-16T00:00:00.000Z"));
  assert.equal(first, true);
  recordAdminAuditEvent(db, {
    actorUsername: "admin",
    actorRole: "admin",
    action: "user.view_observability",
    targetUsername: "alice",
    targetType: "user",
    targetId: "alice",
    status: "success",
    summary: "viewed alice",
    metadata: null,
    createdAt: "2026-07-16T00:00:00.000Z",
  });
  const second = shouldRecordViewAudit(db, "admin", "alice", new Date("2026-07-16T00:20:00.000Z"));
  const third = shouldRecordViewAudit(db, "admin", "alice", new Date("2026-07-16T00:31:00.000Z"));
  assert.equal(second, false);
  assert.equal(third, true);
});
