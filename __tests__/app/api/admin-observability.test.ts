import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAdminOverviewResponse,
  mergeUserObservabilitySummaries,
  sortAdminUsers,
} from "../../../lib/auth/admin-observability-responses.ts";

test("buildAdminOverviewResponse keeps ordinary admin user counts scoped to visible users", () => {
  const response = buildAdminOverviewResponse({
    actorRole: "admin",
    authUsers: [
      { username: "alice", role: "user", disabled: 0, created_at: "2026-07-16T00:00:00.000Z" },
      { username: "manager", role: "admin", disabled: 0, created_at: "2026-07-16T00:00:00.000Z" },
      { username: "hsops", role: "super_admin", disabled: 0, created_at: "2026-07-16T00:00:00.000Z" },
    ],
    visibleOwnerUsernames: ["alice"],
    overview: { recentUsers: [], recentSessions: [], recentWorkspaces: [], recentIssues: [] },
  });

  assert.equal(response.userStats.total, 1);
  assert.equal(response.userStats.enabled, 1);
  assert.equal(response.systemRoleCounts.admin, undefined);
});

test("mergeUserObservabilitySummaries preserves legacy user fields", () => {
  const users = [{ username: "alice", role: "user" as const, disabled: 0, created_at: "2026-07-16T00:00:00.000Z" }];
  const summaries = new Map([["alice", {
    sessionCount: 2,
    workspaceCount: 1,
    missingCount: 0,
    orphanedCount: 0,
    indexErrorCount: 0,
    lastActiveAt: "2026-07-16T00:10:00.000Z",
  }]]);
  const merged = mergeUserObservabilitySummaries(users, summaries);

  assert.equal(merged[0].username, "alice");
  assert.equal(merged[0].created_at, "2026-07-16T00:00:00.000Z");
  assert.equal(merged[0].sessionCount, 2);
});

test("sortAdminUsers keeps null lastActiveAt last", () => {
  const users = [
    { username: "empty", role: "user" as const, disabled: 0, created_at: "2026-07-16T00:00:00.000Z", sessionCount: 0, workspaceCount: 0, missingCount: 0, orphanedCount: 0, indexErrorCount: 0, lastActiveAt: null },
    { username: "active", role: "user" as const, disabled: 0, created_at: "2026-07-16T00:00:00.000Z", sessionCount: 3, workspaceCount: 1, missingCount: 0, orphanedCount: 0, indexErrorCount: 0, lastActiveAt: "2026-07-16T01:00:00.000Z" },
  ];
  assert.deepEqual(sortAdminUsers(users, "last_active_desc").map((user) => user.username), ["active", "empty"]);
});
