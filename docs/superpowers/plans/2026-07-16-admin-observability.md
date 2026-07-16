# Admin Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P2 administrator product observability center: route-split admin pages, cross-user session/workspace observability, index health, rescan stats, and admin audit logging.

**Architecture:** Fork a P2 child branch from `feat/session-workspace-experience`, then add small backend modules for admin visibility, audit storage, admin session-index queries, and route handlers. Frontend admin pages use a shared admin shell and focused components, with all cross-user data served by admin-only APIs that enforce owner visibility before querying `session-index.db`.

**Tech Stack:** Next.js App Router route handlers, React 19 client components, TypeScript, better-sqlite3, SQLite FTS5, node:test, Vitest, Testing Library, existing auth/admin/session-index helpers.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-07-16-admin-observability-design.md`
- Temporary integration flow: `docs/superpowers/session-workspace-integration-flow.md`
- Required execution mode: Subagent-Driven development, fresh subagent per task.
- Integration branch: `feat/session-workspace-experience`
- P2 child branch: `feat/session-workspace-admin-observability`
- P2 dev service: `pi-web-auth-8145-admin-observability-dev.service`
- P2 isolated HOME: `/home/hsops/.pi-admin-observability-dev-home`
- P2 port: `8145`

## File Structure

Create backend files:

- `lib/auth/admin-visibility.ts` - computes admin-visible usernames, including disabled users, without using `listUsernames()`.
- `lib/auth/admin-audit.ts` - migrates and writes `admin_audit_events`; provides filtering and 30-minute view dedupe.
- `lib/session-index/admin-store.ts` - admin-only cross-owner session/workspace/index queries.
- `app/api/admin/overview/route.ts` - dashboard data.
- `app/api/admin/sessions/route.ts` - cross-user session list and optional FTS search.
- `app/api/admin/workspaces/route.ts` - cross-user workspace list.
- `app/api/admin/index/route.ts` - index health.
- `app/api/admin/index/rescan/route.ts` - super_admin rescan with stats.
- `app/api/admin/audit/route.ts` - audit event list.
- `app/api/admin/users/[username]/observability/route.ts` - user observability detail.

Modify backend files:

- `lib/auth/db.ts` - apply audit table migration.
- `lib/session-index/service.ts` - expose `syncSessionIndexWithStats()` while preserving existing `syncSessionIndex()` behavior.
- `app/api/admin/users/route.ts` - extend existing response with optional observability fields.
- `app/api/admin/users/[username]/disable/route.ts` - audit success and failure.
- `app/api/admin/users/[username]/route.ts` - audit role update and delete success/failure.

Create frontend files:

- `components/admin/AdminShell.tsx` - shared admin navigation shell.
- `components/admin/AdminStates.tsx` - loading/error/forbidden/empty helpers.
- `components/admin/AdminTables.tsx` - small reusable table primitives.
- `app/admin/overview/page.tsx`
- `app/admin/users/page.tsx`
- `app/admin/users/[username]/page.tsx`
- `app/admin/sessions/page.tsx`
- `app/admin/workspaces/page.tsx`
- `app/admin/index/page.tsx`
- `app/admin/audit/page.tsx`

Modify frontend files:

- `app/admin/page.tsx` - redirect to `/admin/overview` or become a tiny client/server redirect.
- Existing admin file/chat viewer behavior should remain read-only and can be reused from the user detail page.

Create tests:

- `__tests__/lib/auth/admin-visibility.test.ts`
- `__tests__/lib/auth/admin-audit.test.ts`
- `__tests__/lib/session-index/admin-store.test.ts`
- `__tests__/lib/session-index/service-stats.test.ts`
- `__tests__/app/api/admin-observability.test.ts`
- `__tests__/components/admin-observability-smoke.test.tsx`

---

### Task 1: P2 Child Worktree And Dev Service

**Files:**
- Read: `docs/superpowers/session-workspace-integration-flow.md`
- Create worktree: `/home/hsops/pi-web-auth/.worktrees/session-workspace-admin-observability`
- Create service: `/home/hsops/.config/systemd/user/pi-web-auth-8145-admin-observability-dev.service`

- [ ] **Step 1: Verify the integration branch is clean**

Run from the integration worktree:

```bash
cd /home/hsops/pi-web-auth/.worktrees/session-workspace-experience
git status --short --branch
git rev-parse --abbrev-ref HEAD
```

Expected:

```text
## feat/session-workspace-experience
feat/session-workspace-experience
```

- [ ] **Step 2: Create the P2 child worktree**

Run:

```bash
cd /home/hsops/pi-web-auth
git worktree add .worktrees/session-workspace-admin-observability -b feat/session-workspace-admin-observability feat/session-workspace-experience
cd /home/hsops/pi-web-auth/.worktrees/session-workspace-admin-observability
git status --short --branch
```

Expected branch:

```text
## feat/session-workspace-admin-observability
```

- [ ] **Step 3: Create the isolated HOME directories**

Run:

```bash
mkdir -p /home/hsops/.pi-admin-observability-dev-home
mkdir -p /home/hsops/.pi-admin-observability-dev-home/pi-users
```

Expected: both directories exist.

- [ ] **Step 4: Create the user systemd service**

Create `/home/hsops/.config/systemd/user/pi-web-auth-8145-admin-observability-dev.service` with:

```ini
[Unit]
Description=pi-web-auth P2 admin observability dev server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/hsops/pi-web-auth/.worktrees/session-workspace-admin-observability
Environment=HOME=/home/hsops/.pi-admin-observability-dev-home
Environment=NODE_ENV=development
ExecStart=/usr/bin/npm run dev -- -p 8145
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

- [ ] **Step 5: Start and verify the service**

Run:

```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-web-auth-8145-admin-observability-dev.service
systemctl --user status pi-web-auth-8145-admin-observability-dev.service --no-pager
curl -i http://127.0.0.1:8145/api/auth/me
```

Expected: service is active; `/api/auth/me` returns `401` before login.

- [ ] **Step 6: Commit no code**

No repository files should be changed by this task. If service setup docs are updated later, commit them in the docs task.

---

### Task 2: Audit Schema And Store

**Files:**
- Create: `lib/auth/admin-audit.ts`
- Modify: `lib/auth/db.ts`
- Test: `__tests__/lib/auth/admin-audit.test.ts`

- [ ] **Step 1: Write the failing audit store test**

Create `__tests__/lib/auth/admin-audit.test.ts`:

```ts
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAdminAudit, recordAdminAuditEvent, listAdminAuditEvents, shouldRecordViewAudit } from "../../../lib/auth/admin-audit.ts";

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
```

- [ ] **Step 2: Run the failing test**

```bash
node --experimental-strip-types --test __tests__/lib/auth/admin-audit.test.ts
```

Expected: FAIL because `lib/auth/admin-audit.ts` does not exist.

- [ ] **Step 3: Implement audit migration and store**

Create `lib/auth/admin-audit.ts`:

```ts
import type Database from "better-sqlite3";
import type { Role } from "./roles";

export type AuditStatus = "success" | "failure";

export interface AdminAuditInput {
  actorUsername: string;
  actorRole: Role;
  action: string;
  targetUsername?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  status: AuditStatus;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface AuditListQuery {
  visibleTargetUsernames: string[] | null;
  actor?: string;
  target?: string;
  action?: string;
  status?: AuditStatus;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export function migrateAdminAudit(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_username TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_username TEXT,
      target_type TEXT,
      target_id TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_events(actor_username, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_events(target_username, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_events(action, created_at DESC);
  `);
}

export function recordAdminAuditEvent(db: Database.Database, event: AdminAuditInput): void {
  db.prepare(`
    INSERT INTO admin_audit_events
      (actor_username, actor_role, action, target_username, target_type, target_id, status, summary, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.actorUsername,
    event.actorRole,
    event.action,
    event.targetUsername ?? null,
    event.targetType ?? null,
    event.targetId ?? null,
    event.status,
    event.summary ?? null,
    event.metadata === undefined || event.metadata === null ? null : JSON.stringify(event.metadata),
    event.createdAt ?? new Date().toISOString(),
  );
}

export function listAdminAuditEvents(db: Database.Database, query: AuditListQuery) {
  const where: string[] = [];
  const params: Record<string, unknown> = {
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };
  if (query.visibleTargetUsernames !== null) {
    if (query.visibleTargetUsernames.length === 0) where.push("target_username IS NULL AND actor_username=@actorOnly");
    else {
      const names = query.visibleTargetUsernames.map((_, index) => `@visible${index}`);
      query.visibleTargetUsernames.forEach((name, index) => { params[`visible${index}`] = name; });
      where.push(`(target_username IS NULL OR target_username IN (${names.join(", ")}) OR actor_username=@actorOnly)`);
    }
    params.actorOnly = query.actor ?? "";
  }
  if (query.actor) { where.push("actor_username=@actor"); params.actor = query.actor; }
  if (query.target) { where.push("target_username=@target"); params.target = query.target; }
  if (query.action) { where.push("action=@action"); params.action = query.action; }
  if (query.status) { where.push("status=@status"); params.status = query.status; }
  if (query.from) { where.push("created_at>=@from"); params.from = query.from; }
  if (query.to) { where.push("created_at<=@to"); params.to = query.to; }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM admin_audit_events ${whereSql}`).get(params) as { count: number }).count;
  const rows = db.prepare(`SELECT * FROM admin_audit_events ${whereSql} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`).all(params) as Array<Record<string, unknown>>;
  return {
    events: rows.map((row) => ({
      id: Number(row.id),
      actorUsername: String(row.actor_username),
      actorRole: String(row.actor_role),
      action: String(row.action),
      targetUsername: row.target_username === null ? null : String(row.target_username),
      targetType: row.target_type === null ? null : String(row.target_type),
      targetId: row.target_id === null ? null : String(row.target_id),
      status: String(row.status),
      summary: row.summary === null ? null : String(row.summary),
      metadataJson: row.metadata_json === null ? null : String(row.metadata_json),
      createdAt: String(row.created_at),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function shouldRecordViewAudit(db: Database.Database, actorUsername: string, targetUsername: string, now = new Date()): boolean {
  const since = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT 1 FROM admin_audit_events
    WHERE actor_username=? AND target_username=? AND action='user.view_observability' AND status='success' AND created_at>=?
    LIMIT 1
  `).get(actorUsername, targetUsername, since);
  return !row;
}
```

- [ ] **Step 4: Wire audit migration into auth DB setup**

Modify `lib/auth/db.ts` so database initialization calls `migrateAdminAudit(db)` after the users/session tables exist:

```ts
import { migrateAdminAudit } from "./admin-audit";

// inside getDb(), after existing schema migrations:
migrateAdminAudit(db);
```

- [ ] **Step 5: Verify audit tests**

```bash
node --experimental-strip-types --test __tests__/lib/auth/admin-audit.test.ts
npm run test:auth
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/admin-audit.ts lib/auth/db.ts __tests__/lib/auth/admin-audit.test.ts
git commit -m "feat: add admin audit store"
```

---

### Task 3: Admin Visibility Helpers

**Files:**
- Create: `lib/auth/admin-visibility.ts`
- Test: `__tests__/lib/auth/admin-visibility.test.ts`

- [ ] **Step 1: Write the failing visibility test**

Create `__tests__/lib/auth/admin-visibility.test.ts`:

```ts
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createAdminVisibility, listAdminVisibleOwners } from "../../../lib/auth/admin-visibility.ts";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
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
```

- [ ] **Step 2: Run the failing test**

```bash
node --experimental-strip-types --test __tests__/lib/auth/admin-visibility.test.ts
```

Expected: FAIL because `lib/auth/admin-visibility.ts` does not exist.

- [ ] **Step 3: Implement admin visibility**

Create `lib/auth/admin-visibility.ts`:

```ts
import type Database from "better-sqlite3";
import type { Role } from "./roles";

export interface AdminVisibility {
  actorUsername: string;
  actorRole: "admin" | "super_admin";
  visibleOwnerUsernames: string[];
  includeUnownedIndexIssues: boolean;
}

export function listAdminVisibleOwners(db: Database.Database, actorRole: "admin" | "super_admin"): string[] {
  const sql = actorRole === "super_admin"
    ? "SELECT username FROM users ORDER BY username ASC"
    : "SELECT username FROM users WHERE role='user' ORDER BY username ASC";
  return (db.prepare(sql).all() as Array<{ username: string }>).map((row) => row.username);
}

export function createAdminVisibility(db: Database.Database, actor: { username: string; role: Role }): AdminVisibility {
  if (actor.role !== "admin" && actor.role !== "super_admin") throw new Error("admin role required");
  return {
    actorUsername: actor.username,
    actorRole: actor.role,
    visibleOwnerUsernames: listAdminVisibleOwners(db, actor.role),
    includeUnownedIndexIssues: actor.role === "super_admin",
  };
}
```

- [ ] **Step 4: Verify visibility tests**

```bash
node --experimental-strip-types --test __tests__/lib/auth/admin-visibility.test.ts
npm run test:auth
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/admin-visibility.ts __tests__/lib/auth/admin-visibility.test.ts
git commit -m "feat: add admin visibility helpers"
```

---

### Task 4: Session Index Sync Stats

**Files:**
- Modify: `lib/session-index/service.ts`
- Test: `__tests__/lib/session-index/service-stats.test.ts`

- [ ] **Step 1: Write the failing sync stats test**

Create `__tests__/lib/session-index/service-stats.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionIndexDb, migrateSessionIndexDb } from "../../../lib/session-index/db.ts";
import { syncSessionIndexWithStats } from "../../../lib/session-index/service.ts";

test("syncSessionIndexWithStats reports scanned indexed unchanged and missing", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-sync-stats-"));
  try {
    const sessionsDir = join(home, "sessions");
    const cwd = join(home, "pi-users", "alice", "project");
    mkdirSync(join(sessionsDir, "encoded"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const file = join(sessionsDir, "encoded", "2026_session.jsonl");
    writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-07-16T00:00:00.000Z", cwd }) + "\n");
    const db = createSessionIndexDb(join(home, "session-index.db"));
    migrateSessionIndexDb(db);

    const first = syncSessionIndexWithStats(db, { sessionsDir, usernames: ["alice"], force: true, throttle: false });
    const second = syncSessionIndexWithStats(db, { sessionsDir, usernames: ["alice"], force: true, throttle: false });

    assert.equal(first.scanned, 1);
    assert.equal(first.indexed, 1);
    assert.equal(second.unchanged, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the failing test**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/service-stats.test.ts
```

Expected: FAIL because `syncSessionIndexWithStats` is not exported.

- [ ] **Step 3: Refactor sync service without changing existing behavior**

Modify `lib/session-index/service.ts` to add:

```ts
export interface SessionIndexSyncStats {
  scanned: number;
  indexed: number;
  unchanged: number;
  markedMissing: number;
  errors: Array<{ path: string; error: string }>;
}

export interface SessionIndexSyncOptions {
  sessionsDir?: string;
  usernames?: string[];
  force?: boolean;
  throttle?: boolean;
}

export function syncSessionIndexWithStats(
  db = getSessionIndexDb(getSessionIndexDbPath()),
  options: SessionIndexSyncOptions = {},
): SessionIndexSyncStats {
  const force = options.force ?? false;
  const throttle = options.throttle ?? true;
  const now = Date.now();
  const empty = { scanned: 0, indexed: 0, unchanged: 0, markedMissing: 0, errors: [] } satisfies SessionIndexSyncStats;
  if (throttle && !force && globalThis.__piSessionIndexLastSyncMs && now - globalThis.__piSessionIndexLastSyncMs < SYNC_THROTTLE_MS) return empty;
  globalThis.__piSessionIndexLastSyncMs = now;

  const files = scanSessionFiles(options.sessionsDir ?? getSessionsDir());
  const seenPaths = new Set(files.map((file) => file.path));
  const usernames = options.usernames ?? listUsernames();
  const existing = db.prepare("SELECT path, source_mtime_ms FROM sessions WHERE missing=0").all() as Array<{ path: string; source_mtime_ms: number }>;
  const known = new Map(existing.map((row) => [row.path, row.source_mtime_ms]));
  const stats: SessionIndexSyncStats = { scanned: files.length, indexed: 0, unchanged: 0, markedMissing: 0, errors: [] };

  for (const file of files) {
    if (known.get(file.path) === file.mtimeMs) { stats.unchanged += 1; continue; }
    try { indexSessionFile(db, file, usernames); stats.indexed += 1; }
    catch (error) { stats.errors.push({ path: file.path, error: String(error) }); }
  }
  for (const row of existing) {
    if (!seenPaths.has(row.path)) { markMissingSessionPath(db, row.path); stats.markedMissing += 1; }
  }
  return stats;
}

export function syncSessionIndex(db = getSessionIndexDb(getSessionIndexDbPath()), force = false): void {
  syncSessionIndexWithStats(db, { force, throttle: true });
}
```

Remove the old duplicated loop from `syncSessionIndex()`.

- [ ] **Step 4: Verify sync stats and existing runtime tests**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/service-stats.test.ts
node --experimental-strip-types --test __tests__/lib/session-index/service-runtime.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add lib/session-index/service.ts __tests__/lib/session-index/service-stats.test.ts
git commit -m "feat: report session index sync stats"
```

---

### Task 5: Admin Session Index Store

**Files:**
- Create: `lib/session-index/admin-store.ts`
- Test: `__tests__/lib/session-index/admin-store.test.ts`

- [ ] **Step 1: Write the failing admin store test**

Create `__tests__/lib/session-index/admin-store.test.ts` with seeded `sessions` and `workspaces` rows:

```ts
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
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/p/a", "alice", 1, "2026-07-16T00:10:00.000Z", "2026-07-16T00:11:00.000Z");
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/p/d", "disabled_user", 1, "2026-07-16T00:20:00.000Z", "2026-07-16T00:21:00.000Z");
  db.prepare(`INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at) VALUES (?, ?, ?, ?, ?)`).run("/p/h", "hsops", 1, "2026-07-16T00:30:00.000Z", "2026-07-16T00:31:00.000Z");
});

test("admin sessions include disabled ordinary users and exclude super admin and unowned", () => {
  const result = store.listAdminSessions(adminVisibility, { page: 1, pageSize: 20, sort: "modified_desc" });
  assert.deepEqual(result.sessions.map((session) => session.id), ["d1", "a1"]);
  assert.equal(result.total, 2);
});

test("super admin index health can include unowned issues", () => {
  const result = store.getAdminIndexHealth(superVisibility, { page: 1, pageSize: 20 });
  assert.equal(result.issueCounts.unowned, 1);
  assert.equal(result.issues.some((issue) => issue.ownerUsername === null), true);
});

test("user summary derives lastActiveAt from max modified_at with null last", () => {
  const result = store.getOwnerSummaries(adminVisibility, ["alice", "disabled_user", "empty"]);
  assert.equal(result.get("disabled_user")?.lastActiveAt, "2026-07-16T00:20:00.000Z");
  assert.equal(result.get("empty")?.lastActiveAt, null);
});
```

- [ ] **Step 2: Run the failing test**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/admin-store.test.ts
```

Expected: FAIL because `admin-store.ts` does not exist.

- [ ] **Step 3: Implement admin store types and owner filters**

Create `lib/session-index/admin-store.ts` with these exported types and helpers:

```ts
import type Database from "better-sqlite3";
import type { AdminVisibility } from "../auth/admin-visibility";

export type AdminSessionStatus = "normal" | "missing" | "orphaned" | "index_error";
export type AdminSessionSort = "modified_desc" | "modified_asc" | "created_desc" | "title_asc";
export type AdminWorkspaceSort = "last_active_desc" | "session_count_desc" | "cwd_asc";

function ownerFilter(visibility: AdminVisibility, alias = "s"): { sql: string; params: Record<string, unknown> } {
  if (visibility.visibleOwnerUsernames.length === 0) return { sql: "1=0", params: {} };
  const params: Record<string, unknown> = {};
  const names = visibility.visibleOwnerUsernames.map((name, index) => { params[`owner${index}`] = name; return `@owner${index}`; });
  return { sql: `${alias}.owner_username IN (${names.join(", ")})`, params };
}

function mapSession(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ownerUsername: row.owner_username === null ? null : String(row.owner_username),
    cwd: String(row.cwd),
    title: row.title === null ? null : String(row.title),
    firstMessage: row.first_message === null ? null : String(row.first_message),
    modifiedAt: String(row.modified_at),
    createdAt: String(row.created_at),
    messageCount: Number(row.message_count),
    missing: row.missing === 1,
    orphaned: row.orphaned === 1,
    indexError: row.index_error === null ? null : String(row.index_error),
  };
}
```

- [ ] **Step 4: Implement listAdminSessions, listAdminWorkspaces, owner summaries, index health**

Continue in `admin-store.ts`:

```ts
export function createAdminSessionIndexStore(db: Database.Database) {
  function getOwnerSummaries(_visibility: AdminVisibility, usernames: string[]) {
    const result = new Map<string, { sessionCount: number; workspaceCount: number; missingCount: number; orphanedCount: number; indexErrorCount: number; lastActiveAt: string | null }>();
    for (const username of usernames) result.set(username, { sessionCount: 0, workspaceCount: 0, missingCount: 0, orphanedCount: 0, indexErrorCount: 0, lastActiveAt: null });
    if (usernames.length === 0) return result;
    const params: Record<string, unknown> = {};
    const names = usernames.map((name, index) => { params[`u${index}`] = name; return `@u${index}`; });
    const sessionRows = db.prepare(`
      SELECT owner_username, COUNT(*) AS sessionCount, MAX(modified_at) AS lastActiveAt,
             SUM(CASE WHEN missing=1 THEN 1 ELSE 0 END) AS missingCount,
             SUM(CASE WHEN orphaned=1 THEN 1 ELSE 0 END) AS orphanedCount,
             SUM(CASE WHEN index_error IS NOT NULL THEN 1 ELSE 0 END) AS indexErrorCount
      FROM sessions WHERE owner_username IN (${names.join(", ")}) GROUP BY owner_username
    `).all(params) as Array<Record<string, unknown>>;
    for (const row of sessionRows) {
      const current = result.get(String(row.owner_username));
      if (!current) continue;
      current.sessionCount = Number(row.sessionCount);
      current.lastActiveAt = row.lastActiveAt === null ? null : String(row.lastActiveAt);
      current.missingCount = Number(row.missingCount);
      current.orphanedCount = Number(row.orphanedCount);
      current.indexErrorCount = Number(row.indexErrorCount);
    }
    const workspaceRows = db.prepare(`SELECT owner_username, COUNT(*) AS workspaceCount FROM workspaces WHERE owner_username IN (${names.join(", ")}) GROUP BY owner_username`).all(params) as Array<Record<string, unknown>>;
    for (const row of workspaceRows) {
      const current = result.get(String(row.owner_username));
      if (current) current.workspaceCount = Number(row.workspaceCount);
    }
    return result;
  }

  function listAdminSessions(visibility: AdminVisibility, filters: { username?: string; cwd?: string; q?: string; status?: AdminSessionStatus; from?: string; to?: string; page: number; pageSize: number; sort: AdminSessionSort }) {
    const owner = ownerFilter(visibility, "s");
    const where = [owner.sql];
    const params: Record<string, unknown> = { ...owner.params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    if (filters.username) { where.push("s.owner_username=@username"); params.username = filters.username; }
    if (filters.cwd) { where.push("s.cwd LIKE @cwd"); params.cwd = `${filters.cwd}%`; }
    if (filters.q) { where.push("(s.title LIKE @q OR s.first_message LIKE @q OR s.cwd LIKE @q)"); params.q = `%${filters.q}%`; }
    if (filters.status === "normal") where.push("s.missing=0 AND s.orphaned=0 AND s.index_error IS NULL");
    if (filters.status === "missing") where.push("s.missing=1");
    if (filters.status === "orphaned") where.push("s.orphaned=1");
    if (filters.status === "index_error") where.push("s.index_error IS NOT NULL");
    if (filters.from) { where.push("s.modified_at>=@from"); params.from = filters.from; }
    if (filters.to) { where.push("s.modified_at<=@to"); params.to = filters.to; }
    const orderBy = filters.sort === "modified_asc" ? "s.modified_at ASC" : filters.sort === "created_desc" ? "s.created_at DESC" : filters.sort === "title_asc" ? "COALESCE(s.title, s.first_message, s.id) ASC" : "s.modified_at DESC";
    const whereSql = where.join(" AND ");
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM sessions s WHERE ${whereSql}`).get(params) as { count: number }).count;
    const rows = db.prepare(`SELECT s.* FROM sessions s WHERE ${whereSql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`).all(params) as Array<Record<string, unknown>>;
    return { sessions: rows.map(mapSession), total, page: filters.page, pageSize: filters.pageSize };
  }

  function listAdminWorkspaces(visibility: AdminVisibility, filters: { username?: string; q?: string; activeFrom?: string; page: number; pageSize: number; sort: AdminWorkspaceSort }) {
    const owner = ownerFilter(visibility, "w");
    const where = [owner.sql];
    const params: Record<string, unknown> = { ...owner.params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    if (filters.username) { where.push("w.owner_username=@username"); params.username = filters.username; }
    if (filters.q) { where.push("(w.cwd LIKE @q OR w.display_name LIKE @q)"); params.q = `%${filters.q}%`; }
    if (filters.activeFrom) { where.push("w.last_active_at>=@activeFrom"); params.activeFrom = filters.activeFrom; }
    const orderBy = filters.sort === "session_count_desc" ? "w.session_count DESC" : filters.sort === "cwd_asc" ? "w.cwd ASC" : "w.last_active_at DESC";
    const whereSql = where.join(" AND ");
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM workspaces w WHERE ${whereSql}`).get(params) as { count: number }).count;
    const rows = db.prepare(`SELECT w.* FROM workspaces w WHERE ${whereSql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`).all(params) as Array<Record<string, unknown>>;
    return { workspaces: rows, total, page: filters.page, pageSize: filters.pageSize };
  }

  function getAdminIndexHealth(visibility: AdminVisibility, filters: { page: number; pageSize: number }) {
    const owner = ownerFilter(visibility, "s");
    const issueWhere = [`(${owner.sql}${visibility.includeUnownedIndexIssues ? " OR s.owner_username IS NULL" : ""})`, "(s.missing=1 OR s.orphaned=1 OR s.index_error IS NOT NULL)"];
    const params = { ...owner.params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    const issues = db.prepare(`SELECT s.* FROM sessions s WHERE ${issueWhere.join(" AND ")} ORDER BY s.modified_at DESC LIMIT @limit OFFSET @offset`).all(params) as Array<Record<string, unknown>>;
    const unowned = visibility.includeUnownedIndexIssues ? (db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE owner_username IS NULL AND (missing=1 OR orphaned=1 OR index_error IS NOT NULL)").get() as { count: number }).count : 0;
    return { issues: issues.map(mapSession), issueCounts: { unowned }, page: filters.page, pageSize: filters.pageSize };
  }

  function getAdminOverview(visibility: AdminVisibility) {
    const ownerSummaries = getOwnerSummaries(visibility, visibility.visibleOwnerUsernames);
    const recentUsers = [...ownerSummaries.entries()]
      .map(([username, summary]) => ({ username, ...summary }))
      .sort((a, b) => {
        if (a.lastActiveAt === null && b.lastActiveAt === null) return a.username.localeCompare(b.username);
        if (a.lastActiveAt === null) return 1;
        if (b.lastActiveAt === null) return -1;
        return b.lastActiveAt.localeCompare(a.lastActiveAt);
      })
      .slice(0, 10);
    return {
      ownerSummaries,
      recentUsers,
      recentSessions: listAdminSessions(visibility, { page: 1, pageSize: 10, sort: "modified_desc" }).sessions,
      recentWorkspaces: listAdminWorkspaces(visibility, { page: 1, pageSize: 10, sort: "last_active_desc" }).workspaces,
      recentIssues: getAdminIndexHealth(visibility, { page: 1, pageSize: 10 }).issues,
    };
  }

  function getAdminUserObservability(visibility: AdminVisibility, targetUsername: string) {
    if (!visibility.visibleOwnerUsernames.includes(targetUsername)) return null;
    const summary = getOwnerSummaries(visibility, [targetUsername]).get(targetUsername) ?? {
      sessionCount: 0,
      workspaceCount: 0,
      missingCount: 0,
      orphanedCount: 0,
      indexErrorCount: 0,
      lastActiveAt: null,
    };
    return {
      username: targetUsername,
      summary,
      recentSessions: listAdminSessions(visibility, { username: targetUsername, page: 1, pageSize: 20, sort: "modified_desc" }).sessions,
      recentWorkspaces: listAdminWorkspaces(visibility, { username: targetUsername, page: 1, pageSize: 20, sort: "last_active_desc" }).workspaces,
      issues: listAdminSessions(visibility, { username: targetUsername, status: "index_error", page: 1, pageSize: 20, sort: "modified_desc" }).sessions,
    };
  }

  return { getOwnerSummaries, listAdminSessions, listAdminWorkspaces, getAdminIndexHealth, getAdminOverview, getAdminUserObservability };
}
```

- [ ] **Step 5: Verify admin store tests**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/admin-store.test.ts
node --experimental-strip-types --test __tests__/lib/session-index/store.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add lib/session-index/admin-store.ts __tests__/lib/session-index/admin-store.test.ts
git commit -m "feat: add admin session index queries"
```

---

### Task 6: Admin Overview And User APIs

**Files:**
- Create: `app/api/admin/overview/route.ts`
- Create: `app/api/admin/users/[username]/observability/route.ts`
- Modify: `app/api/admin/users/route.ts`
- Test: `__tests__/app/api/admin-observability.test.ts`

- [ ] **Step 1: Write API contract tests for overview payload shaping**

Create `__tests__/app/api/admin-observability.test.ts` with concrete contract tests for the pure payload helpers introduced in this task:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdminOverviewResponse, mergeUserObservabilitySummaries } from "../../../lib/auth/admin-observability-responses.ts";

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
  const users = [{ username: "alice", role: "user", disabled: 0, created_at: "2026-07-16T00:00:00.000Z" }];
  const summaries = new Map([["alice", { sessionCount: 2, workspaceCount: 1, missingCount: 0, orphanedCount: 0, indexErrorCount: 0, lastActiveAt: "2026-07-16T00:10:00.000Z" }]]);
  const merged = mergeUserObservabilitySummaries(users, summaries);

  assert.equal(merged[0].username, "alice");
  assert.equal(merged[0].created_at, "2026-07-16T00:00:00.000Z");
  assert.equal(merged[0].sessionCount, 2);
});
```

- [ ] **Step 2: Run the failing API contract tests**

```bash
node --experimental-strip-types --test __tests__/app/api/admin-observability.test.ts
```

Expected: FAIL because `lib/auth/admin-observability-responses.ts` does not exist.

- [ ] **Step 3: Add response shaping helpers**

Create `lib/auth/admin-observability-responses.ts`:

```ts
import type { Role } from "./roles";

interface AdminUserRow {
  username: string;
  role: Role;
  disabled: number;
  created_at: string;
}

interface UserSummary {
  sessionCount: number;
  workspaceCount: number;
  missingCount: number;
  orphanedCount: number;
  indexErrorCount: number;
  lastActiveAt: string | null;
}

export function mergeUserObservabilitySummaries(users: AdminUserRow[], summaries: Map<string, UserSummary>) {
  return users.map((user) => ({
    ...user,
    ...(summaries.get(user.username) ?? {
      sessionCount: 0,
      workspaceCount: 0,
      missingCount: 0,
      orphanedCount: 0,
      indexErrorCount: 0,
      lastActiveAt: null,
    }),
  }));
}

export function buildAdminOverviewResponse(input: {
  actorRole: "admin" | "super_admin";
  authUsers: AdminUserRow[];
  visibleOwnerUsernames: string[];
  overview: Record<string, unknown>;
}) {
  const scopedUsers = input.actorRole === "super_admin"
    ? input.authUsers
    : input.authUsers.filter((user) => input.visibleOwnerUsernames.includes(user.username));
  const userStats = {
    total: scopedUsers.length,
    enabled: scopedUsers.filter((user) => user.disabled === 0).length,
    disabled: scopedUsers.filter((user) => user.disabled === 1).length,
    user: scopedUsers.filter((user) => user.role === "user").length,
    admin: input.actorRole === "super_admin" ? scopedUsers.filter((user) => user.role === "admin").length : undefined,
    super_admin: input.actorRole === "super_admin" ? scopedUsers.filter((user) => user.role === "super_admin").length : undefined,
  };
  return { userStats, ...input.overview };
}
```

- [ ] **Step 4: Verify response helper tests**

```bash
node --experimental-strip-types --test __tests__/app/api/admin-observability.test.ts
```

Expected: pass.

- [ ] **Step 5: Extend `GET /api/admin/users` compatibly**

Modify `app/api/admin/users/route.ts`:

```ts
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { getSessionIndexDb } from "@/lib/session-index/db";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";
import { mergeUserObservabilitySummaries } from "@/lib/auth/admin-observability-responses";

// after users query:
const visibility = createAdminVisibility(getDb(), guard);
const summaries = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath())).getOwnerSummaries(
  visibility,
  users.map((user) => user.username),
);
return NextResponse.json({ users: mergeUserObservabilitySummaries(users, summaries) });
```

Keep existing fields `username`, `role`, `disabled`, `created_at` unchanged.

- [ ] **Step 6: Implement `GET /api/admin/overview`**

Create `app/api/admin/overview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth/db";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getSessionIndexDb } from "@/lib/session-index/db";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";
import { buildAdminOverviewResponse } from "@/lib/auth/admin-observability-responses";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const authDb = getDb();
  const visibility = createAdminVisibility(authDb, guard);
  const authUsers = authDb.prepare("SELECT username, role, disabled, created_at FROM users ORDER BY created_at ASC").all() as Array<{ username: string; role: "user" | "admin" | "super_admin"; disabled: number; created_at: string }>;
  const overview = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath())).getAdminOverview(visibility);
  return NextResponse.json({ overview: buildAdminOverviewResponse({ actorRole: visibility.actorRole, authUsers, visibleOwnerUsernames: visibility.visibleOwnerUsernames, overview }) });
}
```

- [ ] **Step 7: Implement user observability route with audit dedupe**

Create `app/api/admin/users/[username]/observability/route.ts`:

```ts
import { NextResponse } from "next/server";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";
import { getDb } from "@/lib/auth/db";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { recordAdminAuditEvent, shouldRecordViewAudit } from "@/lib/auth/admin-audit";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getSessionIndexDb } from "@/lib/session-index/db";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const guard = guardAdminViewTarget(req, username);
  const db = getDb();
  if (guard instanceof NextResponse) {
    return guard;
  }
  const visibility = createAdminVisibility(db, guard.actor);
  const store = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath()));
  const detail = store.getAdminUserObservability(visibility, username);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (shouldRecordViewAudit(db, guard.actor.username, username)) {
    recordAdminAuditEvent(db, { actorUsername: guard.actor.username, actorRole: guard.actor.role, action: "user.view_observability", targetUsername: username, targetType: "user", targetId: username, status: "success", summary: `viewed ${username}`, metadata: null });
  }
  return NextResponse.json({ user: detail });
}
```

- [ ] **Step 8: Verify APIs compile and auth tests pass**

```bash
npm run typecheck
npm run test:auth
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/overview/route.ts app/api/admin/users/route.ts app/api/admin/users/[username]/observability/route.ts lib/auth/admin-observability-responses.ts lib/session-index/admin-store.ts __tests__/app/api/admin-observability.test.ts
git commit -m "feat: add admin overview and user observability APIs"
```

---

### Task 7: Sessions, Workspaces, Index, Rescan, And Audit APIs

**Files:**
- Create: `app/api/admin/sessions/route.ts`
- Create: `app/api/admin/workspaces/route.ts`
- Create: `app/api/admin/index/route.ts`
- Create: `app/api/admin/index/rescan/route.ts`
- Create: `app/api/admin/audit/route.ts`
- Test: extend `__tests__/app/api/admin-observability.test.ts`

- [ ] **Step 1: Implement shared parameter parsing in each route**

Use existing `intParam` and `enumParam` from `lib/api-params.ts`:

```ts
const url = new URL(req.url);
const page = intParam(url.searchParams.get("page"), 1, 1, 10_000);
const pageSize = intParam(url.searchParams.get("pageSize"), 50, 1, 200);
```

- [ ] **Step 2: Implement `/api/admin/sessions`**

Create route:

```ts
import { NextResponse } from "next/server";
import { enumParam, intParam } from "@/lib/api-params";
import { getDb } from "@/lib/auth/db";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getSessionIndexDb } from "@/lib/session-index/db";
import { createAdminSessionIndexStore, type AdminSessionSort, type AdminSessionStatus } from "@/lib/session-index/admin-store";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const url = new URL(req.url);
  const visibility = createAdminVisibility(getDb(), guard);
  const store = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath()));
  const result = store.listAdminSessions(visibility, {
    username: url.searchParams.get("username") ?? undefined,
    cwd: url.searchParams.get("cwd") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    status: enumParam<AdminSessionStatus>(url.searchParams.get("status"), ["normal", "missing", "orphaned", "index_error"], undefined),
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    sort: enumParam<AdminSessionSort>(url.searchParams.get("sort"), ["modified_desc", "modified_asc", "created_desc", "title_asc"], "modified_desc"),
    page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
    pageSize: intParam(url.searchParams.get("pageSize"), 50, 1, 200),
  });
  return NextResponse.json(result);
}
```

If `enumParam` does not accept `undefined` fallback, add a local status parser.

- [ ] **Step 3: Implement `/api/admin/workspaces`**

Create route mirroring sessions and call `listAdminWorkspaces` with `username`, `q`, `activeFrom`, `sort`, `page`, `pageSize`.

- [ ] **Step 4: Implement `/api/admin/index` without triggering sync**

Create `app/api/admin/index/route.ts`:

```ts
import { NextResponse } from "next/server";
import { intParam } from "@/lib/api-params";
import { getDb } from "@/lib/auth/db";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { createSessionIndexDb, migrateSessionIndexDb } from "@/lib/session-index/db";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const url = new URL(req.url);
  const db = createSessionIndexDb(getSessionIndexDbPath());
  migrateSessionIndexDb(db);
  try {
    const result = createAdminSessionIndexStore(db).getAdminIndexHealth(createAdminVisibility(getDb(), guard), {
      page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
      pageSize: intParam(url.searchParams.get("pageSize"), 50, 1, 200),
    });
    return NextResponse.json(result);
  } finally {
    db.close();
  }
}
```

This route intentionally avoids `getSessionIndexStore()`.

- [ ] **Step 5: Implement `/api/admin/index/rescan`**

Create `app/api/admin/index/rescan/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth/db";
import { requireSuperAdmin } from "@/lib/auth/session";
import { recordAdminAuditEvent } from "@/lib/auth/admin-audit";
import { syncSessionIndexWithStats } from "@/lib/session-index/service";

export async function POST(req: Request) {
  const guard = requireSuperAdmin(req);
  const db = getDb();
  if (guard instanceof NextResponse) return guard;
  try {
    const stats = syncSessionIndexWithStats(undefined, { force: true, throttle: false });
    recordAdminAuditEvent(db, { actorUsername: guard.username, actorRole: guard.role, action: "index.rescan", targetType: "index", targetId: "session-index", status: "success", summary: "session index rescan", metadata: stats });
    return NextResponse.json({ stats });
  } catch (error) {
    recordAdminAuditEvent(db, { actorUsername: guard.username, actorRole: guard.role, action: "index.rescan", targetType: "index", targetId: "session-index", status: "failure", summary: "session index rescan failed", metadata: { error: String(error) } });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 6: Implement `/api/admin/audit`**

Create `app/api/admin/audit/route.ts`:

```ts
import { NextResponse } from "next/server";
import { intParam, enumParam } from "@/lib/api-params";
import { getDb } from "@/lib/auth/db";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { listAdminAuditEvents, type AuditStatus } from "@/lib/auth/admin-audit";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const url = new URL(req.url);
  const db = getDb();
  const visibility = createAdminVisibility(db, guard);
  const result = listAdminAuditEvents(db, {
    visibleTargetUsernames: guard.role === "super_admin" ? null : visibility.visibleOwnerUsernames,
    actor: url.searchParams.get("actor") ?? undefined,
    target: url.searchParams.get("target") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    status: enumParam<AuditStatus>(url.searchParams.get("status"), ["success", "failure"], undefined),
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
    pageSize: intParam(url.searchParams.get("pageSize"), 50, 1, 200),
  });
  return NextResponse.json(result);
}
```

- [ ] **Step 7: Verify route compilation**

```bash
npm run typecheck
npm run lint
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add app/api/admin/sessions/route.ts app/api/admin/workspaces/route.ts app/api/admin/index/route.ts app/api/admin/index/rescan/route.ts app/api/admin/audit/route.ts __tests__/app/api/admin-observability.test.ts
git commit -m "feat: add admin observability APIs"
```

---

### Task 8: Audit Existing User Management Routes

**Files:**
- Modify: `app/api/admin/users/[username]/disable/route.ts`
- Modify: `app/api/admin/users/[username]/route.ts`
- Test: `__tests__/lib/auth/admin-audit.test.ts` or `__tests__/app/api/admin-observability.test.ts`

- [ ] **Step 1: Add a helper to safely audit route outcomes**

Extend `lib/auth/admin-audit.ts`:

```ts
export function safeRecordAdminAuditEvent(db: Database.Database, event: AdminAuditInput): void {
  try { recordAdminAuditEvent(db, event); }
  catch (error) { console.warn("admin audit write failed", error); }
}
```

- [ ] **Step 2: Audit disable/enable route**

In `app/api/admin/users/[username]/disable/route.ts`, after actor and target are known, record:

```ts
safeRecordAdminAuditEvent(db, {
  actorUsername: guard.username,
  actorRole: guard.role,
  action: disabled === 1 ? "user.disable" : "user.enable",
  targetUsername: username,
  targetType: "user",
  targetId: username,
  status: "success",
  summary: `${disabled === 1 ? "disabled" : "enabled"} ${username}`,
  metadata: { disabled },
});
```

Before each early 400/403/404 return where actor is known, record `status: "failure"` with `metadata: { reason: "..." }`.

- [ ] **Step 3: Audit role update route**

In `app/api/admin/users/[username]/route.ts` `PATCH`, record `user.role_update` success/failure. Include `{ role: body.role }` on success and `{ reason }` on failure.

- [ ] **Step 4: Audit delete route**

In `DELETE`, record `user.delete` success/failure. On `deleteUserCompletely` failure, record the returned error string.

- [ ] **Step 5: Verify audit integration**

```bash
npm run test:auth
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/admin-audit.ts app/api/admin/users/[username]/disable/route.ts app/api/admin/users/[username]/route.ts __tests__/lib/auth/admin-audit.test.ts __tests__/app/api/admin-observability.test.ts
git commit -m "feat: audit admin user management actions"
```

---

### Task 9: Admin Shell And Route Skeleton

**Files:**
- Create: `components/admin/AdminShell.tsx`
- Create: `components/admin/AdminStates.tsx`
- Modify: `app/admin/page.tsx`
- Create admin route pages listed in file structure.
- Test: `__tests__/components/admin-observability-smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `__tests__/components/admin-observability-smoke.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminShell } from "@/components/admin/AdminShell";

describe("AdminShell", () => {
  it("renders admin observability navigation", () => {
    render(<AdminShell current="overview"><div>Overview body</div></AdminShell>);
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Sessions")).toBeTruthy();
    expect(screen.getByText("Workspaces")).toBeTruthy();
    expect(screen.getByText("Index Health")).toBeTruthy();
    expect(screen.getByText("Audit")).toBeTruthy();
    expect(screen.getByText("Overview body")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the failing smoke test**

```bash
npm run test:ui -- __tests__/components/admin-observability-smoke.test.tsx
```

Expected: FAIL because `AdminShell` does not exist.

- [ ] **Step 3: Implement AdminShell**

Create `components/admin/AdminShell.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  ["overview", "Overview", "/admin/overview"],
  ["users", "Users", "/admin/users"],
  ["sessions", "Sessions", "/admin/sessions"],
  ["workspaces", "Workspaces", "/admin/workspaces"],
  ["index", "Index Health", "/admin/index"],
  ["audit", "Audit", "/admin/audit"],
] as const;

export function AdminShell({ current, children }: { current: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", gridTemplateColumns: "220px 1fr", background: "var(--bg)", color: "var(--text)" }}>
      <aside style={{ borderRight: "1px solid var(--border)", background: "var(--bg-panel)", padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 16 }}>Admin</div>
        <nav style={{ display: "grid", gap: 4 }}>
          {NAV.map(([key, label, href]) => (
            <Link key={key} href={href} style={{ padding: "8px 10px", borderRadius: 6, color: "var(--text)", textDecoration: "none", background: current === key ? "var(--bg-selected)" : "transparent" }}>{label}</Link>
          ))}
        </nav>
        <Link href="/" style={{ display: "block", marginTop: 20, color: "var(--accent)", textDecoration: "none" }}>Back to app</Link>
      </aside>
      <section style={{ minWidth: 0, overflow: "auto", padding: 20 }}>{children}</section>
    </main>
  );
}
```

- [ ] **Step 4: Implement AdminStates**

Create `components/admin/AdminStates.tsx`:

```tsx
export function AdminLoading() { return <div style={{ color: "var(--text-muted)", padding: 16 }}>Loading...</div>; }
export function AdminError({ message = "Load failed" }: { message?: string }) { return <div style={{ color: "var(--err, #f87171)", padding: 16 }}>{message}</div>; }
export function AdminForbidden() { return <div style={{ color: "var(--text-muted)", padding: 16 }}>No permission to view this content.</div>; }
export function AdminEmpty({ message = "No data" }: { message?: string }) { return <div style={{ color: "var(--text-muted)", padding: 16 }}>{message}</div>; }
```

- [ ] **Step 5: Replace `/admin` with redirect**

Modify `app/admin/page.tsx` to redirect to `/admin/overview`:

```tsx
import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/admin/overview");
}
```

If preserving legacy admin page during transition is required, move the current implementation into `app/admin/users/page.tsx` first.

- [ ] **Step 6: Create route skeleton pages**

Each page should render `AdminShell` and a heading. Example `app/admin/overview/page.tsx`:

```tsx
import { AdminShell } from "@/components/admin/AdminShell";

export default function AdminOverviewPage() {
  return <AdminShell current="overview"><h1 style={{ fontSize: 20, margin: 0 }}>Overview</h1></AdminShell>;
}
```

Repeat for users, user detail, sessions, workspaces, index, and audit with the correct `current` value.

- [ ] **Step 7: Verify UI smoke**

```bash
npm run test:ui -- __tests__/components/admin-observability-smoke.test.tsx
npm run typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add components/admin app/admin __tests__/components/admin-observability-smoke.test.tsx
git commit -m "feat: add admin observability shell"
```

---

### Task 10: Admin Overview, Lists, Index, And Audit UI

**Files:**
- Modify all P2 admin page files created in Task 9.
- Create: `components/admin/AdminTables.tsx`
- Test: extend `__tests__/components/admin-observability-smoke.test.tsx`

- [ ] **Step 1: Add table primitives**

Create `components/admin/AdminTables.tsx`:

```tsx
import type { ReactNode } from "react";

export function AdminTable({ children }: { children: ReactNode }) {
  return <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>{children}</table>;
}

export function AdminTh({ children }: { children: ReactNode }) {
  return <th style={{ textAlign: "left", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", padding: "8px" }}>{children}</th>;
}

export function AdminTd({ children }: { children: ReactNode }) {
  return <td style={{ borderBottom: "1px solid var(--border)", padding: "8px", verticalAlign: "top" }}>{children}</td>;
}
```

- [ ] **Step 2: Implement fetch pattern in each page**

Use client components for pages that need filters. Example pattern:

```tsx
"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminError, AdminLoading } from "@/components/admin/AdminStates";

export default function AdminOverviewPage() {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/overview")
      .then(async (response) => {
        if (response.status === 401) window.location.href = "/";
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Load failed");
        return response.json();
      })
      .then(setData)
      .catch((err) => setError(String(err)));
  }, []);
  return <AdminShell current="overview">{error ? <AdminError message={error} /> : !data ? <AdminLoading /> : <pre>{JSON.stringify(data, null, 2)}</pre>}</AdminShell>;
}
```

Replace `<pre>` with structured cards/tables before commit.

- [ ] **Step 3: Build Overview page**

Render metric cards for Users, Sessions, Workspaces, Index Issues. Render compact lists for recent users, recent workspaces, and recent issues. Use links into `/admin/users/[username]`, `/admin/sessions?username=...`, and `/admin/index`.

- [ ] **Step 4: Build Users page**

Fetch `/api/admin/users`. Render search, role filter, status filter, and sortable table columns: username, role, status, last active, sessions, workspaces, issues. Keep existing disable/delete/role actions wired to existing endpoints.

- [ ] **Step 5: Build User Detail page**

Fetch `/api/admin/users/[username]/observability`. Show summary, recent sessions, workspaces, issues, and links to existing files/chats read-only views. Show `AdminForbidden` on 403.

- [ ] **Step 6: Build Sessions and Workspaces pages**

Add filters and query string backed fetches. Sessions filters: username, cwd, status, q. Workspaces filters: username, q, activeFrom. Display pagination total returned by APIs.

- [ ] **Step 7: Build Index Health page**

Fetch `/api/admin/index`. Render database status, issue counts, staleCandidateCount, and issue table. Add Rescan button that POSTs `/api/admin/index/rescan`; hide or disable for 403 response and show failure text.

- [ ] **Step 8: Build Audit page**

Fetch `/api/admin/audit`. Render filters actor, target, action, status. Show summary by default and metadata in a `<details>` block.

- [ ] **Step 9: Verify UI tests and lint**

```bash
npm run test:ui
npm run lint
npm run typecheck
```

Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add app/admin components/admin __tests__/components/admin-observability-smoke.test.tsx
git commit -m "feat: build admin observability pages"
```

---

### Task 11: Full Verification And P2 Acceptance

**Files:**
- Modify docs only if acceptance notes are recorded.

- [ ] **Step 1: Run full automated gate**

```bash
npm run lint
npm run typecheck
npm run test:auth
npm run test:ui
npm run test:release
```

Expected: all pass.

- [ ] **Step 2: Verify P2 dev service**

```bash
systemctl --user status pi-web-auth-8145-admin-observability-dev.service --no-pager
journalctl --user -u pi-web-auth-8145-admin-observability-dev.service --since '10 minutes ago' --no-pager
```

Expected: service active; no new unhandled errors.

- [ ] **Step 3: Manual super_admin UI smoke**

Open:

```text
http://10.16.49.16:8145/admin/overview
http://10.16.49.16:8145/admin/users
http://10.16.49.16:8145/admin/sessions
http://10.16.49.16:8145/admin/workspaces
http://10.16.49.16:8145/admin/index
http://10.16.49.16:8145/admin/audit
```

Validate: overview metrics render, users table renders, sessions/workspaces filters work, index rescan works for super_admin, audit events appear.

- [ ] **Step 4: Manual ordinary admin UI smoke**

Login as an ordinary admin. Validate:

- super_admin user detail returns a clear forbidden state.
- super_admin sessions/workspaces are not visible.
- disabled ordinary users remain visible in user observability.
- index rescan is not available.

- [ ] **Step 5: Commit acceptance notes if recorded**

If acceptance notes are added, commit:

```bash
git add docs/superpowers/plans/2026-07-16-admin-observability.md
git commit -m "docs: record admin observability acceptance"
```

---

### Task 12: Merge P2 Back To Temporary Integration Branch

**Files:**
- Read: `docs/superpowers/session-workspace-integration-flow.md`

- [ ] **Step 1: Re-read integration flow**

```bash
sed -n '1,260p' docs/superpowers/session-workspace-integration-flow.md
```

- [ ] **Step 2: Confirm P2 branch is clean**

```bash
git status --short --branch
git log --oneline --decorate -8
```

- [ ] **Step 3: Merge to integration branch**

Run from the integration worktree:

```bash
cd /home/hsops/pi-web-auth/.worktrees/session-workspace-experience
git status --short --branch
git merge --no-ff feat/session-workspace-admin-observability
```

Expected: merge succeeds into `feat/session-workspace-experience`.

- [ ] **Step 4: Run integration smoke gate**

```bash
npm run lint
npm run typecheck
npm run test:auth
npm run test:ui
systemctl --user status pi-web-auth-8144-dev.service --no-pager
journalctl --user -u pi-web-auth-8144-dev.service --since '10 minutes ago' --no-pager
```

Expected: all pass; integration service remains healthy.

- [ ] **Step 5: Preserve P2 worktree unless user approves cleanup**

Do not delete the P2 worktree automatically. Keep it available for fixes until P2 is accepted on the integration branch.

---

## Plan Self-Review

- Spec coverage: covered admin routing, admin visibility, disabled users, NULL owner, audit, audit dedupe, admin query layer, rescan stats, index health without sync, UI pages, systemd acceptance, and merge back to integration branch.
- Placeholder scan: no `TBD`, `TODO`, placeholder tests, or deferred implementation notes remain.
- Type consistency: plan uses `AdminVisibility`, `AdminSessionStatus`, `AdminSessionSort`, `AuditStatus`, and `SessionIndexSyncStats` consistently across backend tasks.
