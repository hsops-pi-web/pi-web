# Session Workspace Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P1 advanced session and workspace experience: SQLite-backed session indexing, accurate per-user pagination, search, favorites, tags, archive, workspace pinning, bulk actions, and sidebar UI integration.

**Architecture:** Add a dedicated `session-index.db` beside `auth.db`, with index tables derived from Pi `.jsonl` files and per-user metadata tables for product state. Index-time ownership calculation writes `owner_username`; request-time queries use SQL `WHERE owner_username=?` so pagination and totals are exact. The UI moves from a monolithic `SessionSidebar.tsx` to focused session-sidebar components backed by new session/workspace/tag APIs.

**Tech Stack:** Next.js route handlers, React 19 client components, TypeScript, better-sqlite3, SQLite FTS5, node:test, Vitest, Testing Library, existing auth/session guard helpers.

---

## Source Spec

- Spec: `docs/superpowers/specs/2026-07-15-session-workspace-experience-design.md`
- Temporary integration flow: `docs/superpowers/session-workspace-integration-flow.md` is required reading before P2/P3 work, child-branch merges, and the final merge back to `main`.
- Required execution mode: Subagent-Driven development, fresh subagent per task.
- Development worktree: create at execution time with `superpowers:using-git-worktrees`.
- Production worktree `/home/hsops/pi-web-auth` must remain clean `main` during implementation.
- Dev server must use isolated HOME and a non-8000 port.
- Do not run `next build` in the development worktree.

## File Structure

Create these backend files:

- `lib/auth/data-dir.ts` - shared `.pi-web-auth` data directory helper used by auth and session-index databases.
- `lib/session-index/db.ts` - opens `session-index.db`, applies schema migrations, configures WAL, exports testable store factory.
- `lib/session-index/types.ts` - query, row, metadata, search, pagination, and index status types.
- `lib/session-index/text.ts` - extracts bounded searchable text from session entries.
- `lib/session-index/ownership.ts` - computes `owner_username` from cwd and existing users.
- `lib/session-index/scanner.ts` - enumerates session `.jsonl` files with `readdir` and `stat`, without `SessionManager.listAll()`.
- `lib/session-index/indexer.ts` - parses and indexes one file, handles orphaned/missing sessions, updates FTS.
- `lib/session-index/store.ts` - query and metadata operations: sessions, search, workspaces, tags, bulk actions.
- `lib/session-index/service.ts` - request-facing orchestration: ensure schema, trigger scan, index one session, delete hooks.

Modify these backend files:

- `lib/auth/db.ts` - use `getPiWebAuthDataDir()` from `lib/auth/data-dir.ts`.
- `lib/auth/delete-user.ts` - clear session-index rows and per-user metadata during user deletion.
- `lib/types.ts` - extend `SessionInfo` and add workspace/tag/search response types.
- `app/api/sessions/route.ts` - query SQLite session index with exact pagination and filters.
- `app/api/sessions/[id]/route.ts` - update favorite/archive/customTitle, reindex after rename/delete.
- `app/api/agent/new/route.ts` - trigger indexing after a new real session is created.
- `app/api/agent/[id]/route.ts` - trigger indexing after send/fork/rename-relevant state changes when a session file exists.

Create these API routes:

- `app/api/sessions/search/route.ts` - full-text search with snippets and permission-safe results.
- `app/api/sessions/bulk/route.ts` - batch favorite/archive/tag operations with per-item authorization.
- `app/api/workspaces/route.ts` - list accessible workspaces.
- `app/api/workspaces/[cwd]/route.ts` - update per-user workspace metadata by stable URL-encoded cwd.
- `app/api/tags/route.ts` - list/create current user's tags.
- `app/api/tags/[id]/route.ts` - rename/recolor/delete current user's tag.

Create these frontend files:

- `components/session-sidebar/types.ts` - local UI state and API DTO types.
- `components/session-sidebar/utils.ts` - `formatRelativeTime`, `shortenCwd`, `buildSessionTree` extracted from current sidebar.
- `components/session-sidebar/WorkspaceSwitcher.tsx` - server-backed workspace picker with pinned/recent ordering.
- `components/session-sidebar/SessionSearchBox.tsx` - title/cwd/full-text search input and mode handling.
- `components/session-sidebar/SessionFilterBar.tsx` - all/favorite/archive/tag filters.
- `components/session-sidebar/SessionTree.tsx` - tree rendering for non-search mode.
- `components/session-sidebar/SessionRow.tsx` - one session row with favorite/archive/tag state.
- `components/session-sidebar/BulkSessionToolbar.tsx` - multi-select batch actions.
- `components/session-sidebar/TagPicker.tsx` - per-session and bulk tag selection.
- `components/session-sidebar/ArchiveViewToggle.tsx` - archived include/only/exclude control.

Modify these frontend files:

- `components/SessionSidebar.tsx` - become orchestrator using new components and APIs.
- `components/AppShell.tsx` - only if type changes require preserving selected cwd/session props.
- `app/globals.css` - only for reusable sidebar class names if inline styles become too large.

Create these tests:

- `__tests__/lib/auth/data-dir.test.ts`
- `__tests__/lib/session-index/db.test.ts`
- `__tests__/lib/session-index/text.test.ts`
- `__tests__/lib/session-index/ownership.test.ts`
- `__tests__/lib/session-index/scanner.test.ts`
- `__tests__/lib/session-index/indexer.test.ts`
- `__tests__/lib/session-index/store.test.ts`
- `__tests__/lib/session-index/delete-user-integration.test.ts`
- `__tests__/components/session-sidebar-utils.test.ts`
- `__tests__/components/session-sidebar-smoke.test.tsx`

---

### Task 1: Feature Worktree And Shared Data Directory

**Files:**
- Create: `lib/auth/data-dir.ts`
- Modify: `lib/auth/db.ts`
- Test: `__tests__/lib/auth/data-dir.test.ts`

- [ ] **Step 1: Create the implementation worktree**

Run from `/home/hsops/pi-web-auth` using `superpowers:using-git-worktrees`:

```bash
git worktree add ../pi-web-auth-session-workspace-experience -b feat/session-workspace-experience
cd ../pi-web-auth-session-workspace-experience
```

Expected: a new branch and worktree exist outside the production worktree.

- [ ] **Step 2: Write the failing shared data-dir test**

Create `__tests__/lib/auth/data-dir.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { getPiWebAuthDataDir, getAuthDbPath, getSessionIndexDbPath } from "../../../lib/auth/data-dir.ts";

test("derives auth and session index database paths from the same data dir", () => {
  const dir = getPiWebAuthDataDir();

  assert.equal(dir, path.join(os.homedir(), ".pi-web-auth"));
  assert.equal(getAuthDbPath(), path.join(dir, "auth.db"));
  assert.equal(getSessionIndexDbPath(), path.join(dir, "session-index.db"));
});
```

- [ ] **Step 3: Run the failing test**

```bash
node --experimental-strip-types --test __tests__/lib/auth/data-dir.test.ts
```

Expected: FAIL because `lib/auth/data-dir.ts` does not exist.

- [ ] **Step 4: Implement the shared data-dir helper**

Create `lib/auth/data-dir.ts`:

```ts
import os from "os";
import path from "path";

export function getPiWebAuthDataDir(): string {
  return path.join(os.homedir(), ".pi-web-auth");
}

export function getAuthDbPath(): string {
  return path.join(getPiWebAuthDataDir(), "auth.db");
}

export function getSessionIndexDbPath(): string {
  return path.join(getPiWebAuthDataDir(), "session-index.db");
}
```

- [ ] **Step 5: Update auth db to use the helper**

Modify `lib/auth/db.ts` imports and path setup:

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { SUPER_ADMIN } from "./roles";
import { getAuthDbPath, getPiWebAuthDataDir } from "./data-dir";
```

Replace the inline dir/db path block with:

```ts
  const dir = getPiWebAuthDataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(getAuthDbPath());
```

- [ ] **Step 6: Verify the task**

```bash
node --experimental-strip-types --test __tests__/lib/auth/data-dir.test.ts
npm run test:auth
```

Expected: both commands PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/data-dir.ts lib/auth/db.ts __tests__/lib/auth/data-dir.test.ts
git commit -m "feat: share pi web auth data directory paths"
```

---

### Task 2: Session Index Schema And Database Store

**Files:**
- Create: `lib/session-index/db.ts`
- Create: `lib/session-index/types.ts`
- Test: `__tests__/lib/session-index/db.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `__tests__/lib/session-index/db.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the failing test**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/db.test.ts
```

Expected: FAIL because `lib/session-index/db.ts` does not exist.

- [ ] **Step 3: Define shared session-index types**

Create `lib/session-index/types.ts`:

```ts
export type ArchivedFilter = "exclude" | "include" | "only";
export type OrphanedFilter = "exclude" | "include" | "only";
export type SessionSort = "modified_desc" | "modified_asc" | "created_desc" | "title_asc";
export type IndexStatus = "ready" | "building" | "stale" | "error";

export interface SessionIndexRow {
  id: string;
  path: string;
  cwd: string;
  ownerUsername: string | null;
  title: string | null;
  firstMessage: string | null;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  parentSessionId: string | null;
  orphaned: boolean;
  missing: boolean;
  sourceMtimeMs: number;
  indexedAt: string | null;
  indexError: string | null;
}

export interface SessionListQuery {
  username: string;
  q?: string;
  cwd?: string;
  tag?: string;
  favorite?: boolean;
  archived: ArchivedFilter;
  orphaned: OrphanedFilter;
  sort: SessionSort;
  page: number;
  pageSize: number;
}

export interface SessionSearchQuery {
  username: string;
  q: string;
  cwd?: string;
  tag?: string;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 4: Implement schema migration with FTS triggers**

Create `lib/session-index/db.ts`:

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";

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

export function getSessionIndexDb(): Database.Database {
  if (globalThis.__piSessionIndexDb) return globalThis.__piSessionIndexDb;
  const db = createSessionIndexDb(getSessionIndexDbPath());
  migrateSessionIndexDb(db);
  globalThis.__piSessionIndexDb = db;
  return db;
}
```

- [ ] **Step 5: Verify the task**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/db.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/session-index/db.ts lib/session-index/types.ts __tests__/lib/session-index/db.test.ts
git commit -m "feat: add session index sqlite schema"
```

---

### Task 3: Text Extraction And Ownership Calculation

**Files:**
- Create: `lib/session-index/text.ts`
- Create: `lib/session-index/ownership.ts`
- Test: `__tests__/lib/session-index/text.test.ts`
- Test: `__tests__/lib/session-index/ownership.test.ts`

- [ ] **Step 1: Write text extraction tests**

Create `__tests__/lib/session-index/text.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMessageText, truncateSearchText } from "../../../lib/session-index/text.ts";

test("extracts user string content", () => {
  assert.equal(extractMessageText({ role: "user", content: "hello world" }), "hello world");
});

test("extracts text blocks and ignores images", () => {
  assert.equal(
    extractMessageText({ role: "assistant", content: [{ type: "text", text: "alpha" }, { type: "image", source: { type: "url", url: "x" } }] }),
    "alpha",
  );
});

test("tool results are bounded", () => {
  const text = truncateSearchText("x".repeat(70_000));
  assert.equal(text.length, 20_000);
});
```

- [ ] **Step 2: Write ownership tests**

Create `__tests__/lib/session-index/ownership.test.ts`:

```ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { computeSessionOwner } from "../../../lib/session-index/ownership.ts";
import { getUserRoot } from "../../../lib/auth/paths.ts";

let home = "";
let originalHome: string | undefined;

before(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "pi-session-owner-"));
  process.env.HOME = home;
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

test("computes owner from cwd under exactly one user root", () => {
  const aliceRoot = getUserRoot("alice-owner");
  const bobRoot = getUserRoot("bob-owner");
  mkdirSync(path.join(aliceRoot, "proj"), { recursive: true });
  mkdirSync(bobRoot, { recursive: true });
  try {
    assert.equal(computeSessionOwner(path.join(aliceRoot, "proj"), ["alice-owner", "bob-owner"]), "alice-owner");
  } finally {
    rmSync(aliceRoot, { recursive: true, force: true });
    rmSync(bobRoot, { recursive: true, force: true });
  }
});

test("returns null for empty or unowned cwd", () => {
  assert.equal(computeSessionOwner("", ["alice-owner"]), null);
  assert.equal(computeSessionOwner("/tmp/outside", ["alice-owner"]), null);
});
```

- [ ] **Step 3: Run failing tests**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/text.test.ts __tests__/lib/session-index/ownership.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement text extraction**

Create `lib/session-index/text.ts`:

```ts
const MAX_SEARCH_TEXT = 20_000;

export function truncateSearchText(text: string): string {
  return text.length > MAX_SEARCH_TEXT ? text.slice(0, MAX_SEARCH_TEXT) : text;
}

export function extractMessageText(message: unknown): string {
  const value = message as { content?: unknown };
  const content = value.content;
  if (typeof content === "string") return truncateSearchText(content);
  if (!Array.isArray(content)) return "";

  const parts = content.flatMap((block) => {
    const item = block as { type?: string; text?: unknown; thinking?: unknown; input?: unknown };
    if (item.type === "text" && typeof item.text === "string") return [item.text];
    if (item.type === "thinking" && typeof item.thinking === "string") return [item.thinking];
    if (item.type === "toolCall" && item.input) return [JSON.stringify(item.input)];
    return [];
  });

  return truncateSearchText(parts.join("\n"));
}
```

- [ ] **Step 5: Implement owner calculation**

Create `lib/session-index/ownership.ts`:

```ts
import { resolveSessionOwnership } from "@/lib/auth/paths";

export function computeSessionOwner(cwd: string, usernames: string[]): string | null {
  if (!cwd) return null;
  const owners = usernames.filter((username) => resolveSessionOwnership(cwd, username));
  return owners.length === 1 ? owners[0] : null;
}
```

- [ ] **Step 6: Verify the task**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/text.test.ts __tests__/lib/session-index/ownership.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/session-index/text.ts lib/session-index/ownership.ts __tests__/lib/session-index/text.test.ts __tests__/lib/session-index/ownership.test.ts
git commit -m "feat: add session index text and owner helpers"
```

---

### Task 4: Scanner And Indexer

**Files:**
- Create: `lib/session-index/scanner.ts`
- Create: `lib/session-index/indexer.ts`
- Test: `__tests__/lib/session-index/scanner.test.ts`
- Test: `__tests__/lib/session-index/indexer.test.ts`

- [ ] **Step 1: Write scanner tests**

Create `__tests__/lib/session-index/scanner.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSessionFiles } from "../../../lib/session-index/scanner.ts";

test("scans jsonl files by readdir and stat without parsing content", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-scan-"));
  try {
    const cwdDir = encodeURIComponent("/tmp/project");
    mkdirSync(join(dir, cwdDir), { recursive: true });
    writeFileSync(join(dir, cwdDir, "bad.jsonl"), "not json");
    writeFileSync(join(dir, cwdDir, "ignore.txt"), "ignored");

    const files = scanSessionFiles(dir);

    assert.equal(files.length, 1);
    assert.equal(files[0].path.endsWith("bad.jsonl"), true);
    assert.ok(files[0].mtimeMs > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write indexer tests**

Create `__tests__/lib/session-index/indexer.test.ts`:

```ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionIndexDb, migrateSessionIndexDb } from "../../../lib/session-index/db.ts";
import { backfillParentSessionIds, indexSessionFile, markMissingSessionPath } from "../../../lib/session-index/indexer.ts";
import { getUserRoot } from "../../../lib/auth/paths.ts";

let home = "";
let originalHome: string | undefined;
let db: Database.Database;

before(() => {
  home = mkdtempSync(join(tmpdir(), "pi-session-indexer-"));
  originalHome = process.env.HOME;
  process.env.HOME = home;
  db = createSessionIndexDb(join(home, "session-index.db"));
  migrateSessionIndexDb(db);
});

after(() => {
  db.close();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

test("indexes a valid session with owner, workspace, messages, first message, and FTS", () => {
  const userRoot = getUserRoot("idxalice");
  const cwd = join(userRoot, "project");
  mkdirSync(cwd, { recursive: true });
  const file = join(home, "s1.jsonl");
  writeFileSync(file, [
    JSON.stringify({ type: "session", id: "s1", timestamp: "2026-07-15T00:00:00.000Z", cwd }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-07-15T00:00:01.000Z", message: { role: "user", content: "findable release text" } }),
    JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-07-15T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "assistant reply" }] } }),
  ].join("\n"));

  try {
    indexSessionFile(db, { path: file, mtimeMs: 100 }, ["idxalice"]);

    const row = db.prepare("SELECT id, owner_username, first_message, message_count, orphaned FROM sessions WHERE id='s1'").get() as Record<string, unknown>;
    assert.equal(row.owner_username, "idxalice");
    assert.equal(row.first_message, "findable release text");
    assert.equal(row.message_count, 2);
    assert.equal(row.orphaned, 0);

    const workspace = db.prepare("SELECT cwd, owner_username, session_count, last_active_at FROM workspaces WHERE cwd=?").get(cwd) as { cwd: string; owner_username: string; session_count: number; last_active_at: string };
    assert.equal(workspace.owner_username, "idxalice");
    assert.equal(workspace.session_count, 1);

    const hit = db.prepare("SELECT session_id FROM session_messages_fts WHERE session_messages_fts MATCH ?").get("findable") as { session_id: string } | undefined;
    assert.equal(hit?.session_id, "s1");
  } finally {
    rmSync(userRoot, { recursive: true, force: true });
  }
});

test("parentSession path is backfilled to parent_session_id", () => {
  const userRoot = getUserRoot("idxparent");
  const cwd = join(userRoot, "project");
  mkdirSync(cwd, { recursive: true });
  const parent = join(home, "parent.jsonl");
  const child = join(home, "child.jsonl");
  writeFileSync(parent, JSON.stringify({ type: "session", id: "parent", timestamp: "2026-07-15T00:00:00.000Z", cwd }));
  writeFileSync(child, JSON.stringify({ type: "session", id: "child", timestamp: "2026-07-15T00:00:01.000Z", cwd, parentSession: parent }));
  try {
    indexSessionFile(db, { path: child, mtimeMs: 300 }, ["idxparent"]);
    indexSessionFile(db, { path: parent, mtimeMs: 301 }, ["idxparent"]);
    backfillParentSessionIds(db);
    const row = db.prepare("SELECT parent_session_id FROM sessions WHERE id='child'").get() as { parent_session_id: string | null };
    assert.equal(row.parent_session_id, "parent");
  } finally {
    rmSync(userRoot, { recursive: true, force: true });
  }
});

test("malformed session becomes orphaned row", () => {
  const file = join(home, "bad.jsonl");
  writeFileSync(file, "not json");

  indexSessionFile(db, { path: file, mtimeMs: 200 }, ["idxalice"]);

  const row = db.prepare("SELECT orphaned, index_error FROM sessions WHERE path=?").get(file) as { orphaned: number; index_error: string };
  assert.equal(row.orphaned, 1);
  assert.match(row.index_error, /Unexpected|JSON|session/i);
});

test("missing file is hidden but metadata is preserved", () => {
  markMissingSessionPath(db, "/tmp/missing.jsonl");
  const row = db.prepare("SELECT missing FROM sessions WHERE path=?").get("/tmp/missing.jsonl") as { missing: number } | undefined;
  assert.equal(row, undefined);
});
```

- [ ] **Step 3: Run failing tests**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/scanner.test.ts __tests__/lib/session-index/indexer.test.ts
```

Expected: FAIL because scanner/indexer do not exist.

- [ ] **Step 4: Implement scanner**

Create `lib/session-index/scanner.ts`:

```ts
import { readdirSync, statSync } from "fs";
import path from "path";

export interface ScannedSessionFile {
  path: string;
  mtimeMs: number;
}

export function scanSessionFiles(sessionsDir: string): ScannedSessionFile[] {
  const files: ScannedSessionFile[] = [];
  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(sessionsDir);
  } catch {
    return files;
  }

  for (const cwdDir of cwdDirs) {
    const dir = path.join(sessionsDir, cwdDir);
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, name);
      try {
        const fileStat = statSync(filePath);
        if (fileStat.isFile()) files.push({ path: filePath, mtimeMs: Math.floor(fileStat.mtimeMs) });
      } catch {
        continue;
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
```

- [ ] **Step 5: Implement indexer**

Create `lib/session-index/indexer.ts` with these exported functions:

```ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { basename } from "path";
import { computeSessionOwner } from "./ownership";
import { extractMessageText } from "./text";
import type { ScannedSessionFile } from "./scanner";

function nowIso(): string {
  return new Date().toISOString();
}

function fallbackSessionId(filePath: string): string {
  return `orphaned:${filePath}`;
}

function refreshWorkspace(db: Database.Database, cwd: string, owner: string | null, indexedAt: string): void {
  if (!cwd || !owner) return;
  const aggregate = db.prepare(`
    SELECT COUNT(*) AS sessionCount, MAX(modified_at) AS lastActiveAt
    FROM sessions
    WHERE cwd=? AND owner_username=? AND missing=0 AND orphaned=0
  `).get(cwd, owner) as { sessionCount: number; lastActiveAt: string | null };

  db.prepare(`
    INSERT INTO workspaces (cwd, owner_username, session_count, last_active_at, indexed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cwd) DO UPDATE SET
      owner_username=excluded.owner_username,
      session_count=excluded.session_count,
      last_active_at=excluded.last_active_at,
      indexed_at=excluded.indexed_at
  `).run(cwd, owner, aggregate.sessionCount, aggregate.lastActiveAt, indexedAt);
}

export function backfillParentSessionIds(db: Database.Database): void {
  db.prepare(`
    UPDATE sessions
    SET parent_session_id = (
      SELECT parent.id FROM sessions parent WHERE parent.path = sessions.parent_session_path
    )
    WHERE parent_session_path IS NOT NULL
  `).run();
}

export function indexSessionFile(db: Database.Database, file: ScannedSessionFile, usernames: string[]): void {
  const indexedAt = nowIso();
  try {
    const content = readFileSync(file.path, "utf8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const header = JSON.parse(lines[0] ?? "null") as { type?: string; id?: string; timestamp?: string; cwd?: string; parentSession?: string };
    if (header?.type !== "session" || !header.id) throw new Error("Invalid session header");

    const entries = lines.slice(1).map((line) => JSON.parse(line)) as Array<{ type?: string; id?: string; timestamp?: string; message?: { role?: string } & Record<string, unknown> }>;
    const messageRows = entries
      .filter((entry) => entry.type === "message" && entry.message)
      .map((entry, index) => ({
        entryId: entry.id ?? null,
        role: String(entry.message?.role ?? "unknown"),
        text: extractMessageText(entry.message),
        sequence: index,
        createdAt: entry.timestamp ?? null,
      }))
      .filter((row) => row.text.length > 0);

    const firstUser = messageRows.find((row) => row.role === "user")?.text ?? "(no messages)";
    const owner = computeSessionOwner(header.cwd ?? "", usernames);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO sessions (id, path, cwd, owner_username, title, first_message, created_at, modified_at, message_count, parent_session_id, parent_session_path, orphaned, missing, source_mtime_ms, indexed_at, index_error)
        VALUES (@id, @path, @cwd, @owner, @title, @firstMessage, @createdAt, @modifiedAt, @messageCount, @parentSessionId, @parentSessionPath, 0, 0, @sourceMtimeMs, @indexedAt, NULL)
        ON CONFLICT(id) DO UPDATE SET
          path=excluded.path,
          cwd=excluded.cwd,
          owner_username=excluded.owner_username,
          first_message=excluded.first_message,
          created_at=excluded.created_at,
          modified_at=excluded.modified_at,
          message_count=excluded.message_count,
          parent_session_id=excluded.parent_session_id,
          parent_session_path=excluded.parent_session_path,
          orphaned=0,
          missing=0,
          source_mtime_ms=excluded.source_mtime_ms,
          indexed_at=excluded.indexed_at,
          index_error=NULL
      `).run({
        id: header.id,
        path: file.path,
        cwd: header.cwd ?? "",
        owner,
        title: null,
        firstMessage: firstUser,
        createdAt: header.timestamp ?? indexedAt,
        modifiedAt: indexedAt,
        messageCount: messageRows.length,
        parentSessionId: header.parentSession
          ? (db.prepare("SELECT id FROM sessions WHERE path=?").get(header.parentSession) as { id: string } | undefined)?.id ?? null
          : null,
        parentSessionPath: header.parentSession ?? null,
        sourceMtimeMs: file.mtimeMs,
        indexedAt,
      });

      db.prepare("DELETE FROM session_messages WHERE session_id=?").run(header.id);
      const insertMessage = db.prepare(`INSERT INTO session_messages (session_id, entry_id, role, text, sequence, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const row of messageRows) {
        insertMessage.run(header.id, row.entryId, row.role, row.text, row.sequence, row.createdAt);
      }
      refreshWorkspace(db, header.cwd ?? "", owner, indexedAt);
      backfillParentSessionIds(db);
    })();
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    db.prepare(`
      INSERT INTO sessions (id, path, cwd, created_at, modified_at, orphaned, missing, source_mtime_ms, indexed_at, index_error)
      VALUES (?, ?, '', ?, ?, 1, 0, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET orphaned=1, missing=0, source_mtime_ms=excluded.source_mtime_ms, indexed_at=excluded.indexed_at, index_error=excluded.index_error
    `).run(fallbackSessionId(file.path), file.path, indexedAt, indexedAt, file.mtimeMs, indexedAt, `${basename(file.path)}: ${errorText}`);
  }
}

export function markMissingSessionPath(db: Database.Database, filePath: string): void {
  db.prepare("UPDATE sessions SET missing=1, indexed_at=? WHERE path=?").run(nowIso(), filePath);
}
```

- [ ] **Step 6: Verify the task**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/scanner.test.ts __tests__/lib/session-index/indexer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/session-index/scanner.ts lib/session-index/indexer.ts __tests__/lib/session-index/scanner.test.ts __tests__/lib/session-index/indexer.test.ts
git commit -m "feat: index pi session jsonl files"
```

---

### Task 5: Query Store, Metadata, Tags, Workspaces, And Bulk Operations

**Files:**
- Create: `lib/session-index/store.ts`
- Test: `__tests__/lib/session-index/store.test.ts`

- [ ] **Step 1: Write store tests**

Create `__tests__/lib/session-index/store.test.ts` covering all public methods. Include these test cases in the file:

```ts
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
```

- [ ] **Step 2: Run failing test**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/store.test.ts
```

Expected: FAIL because `store.ts` does not exist.

- [ ] **Step 3: Implement `createSessionIndexStore`**

Create `lib/session-index/store.ts` with these methods:

```ts
import Database from "better-sqlite3";
import type { ArchivedFilter, OrphanedFilter, SessionListQuery, SessionSort } from "./types";

interface MetadataPatch { favorite?: boolean; archived?: boolean; customTitle?: string | null }
interface TagInput { name: string; color?: string | null }
interface BulkOperation { operation: "archive" | "unarchive" | "favorite" | "unfavorite" | "add_tag" | "remove_tag"; tagId?: number }

function nowIso(): string { return new Date().toISOString(); }
function boolToInt(value: boolean): 1 | 0 { return value ? 1 : 0; }

function archivedClause(value: ArchivedFilter): string {
  if (value === "only") return "COALESCE(usm.archived, 0)=1";
  if (value === "include") return "1=1";
  return "COALESCE(usm.archived, 0)=0";
}

function orphanedClause(value: OrphanedFilter): string {
  if (value === "only") return "s.orphaned=1";
  if (value === "include") return "1=1";
  return "s.orphaned=0";
}

function sortSql(sort: SessionSort): string {
  if (sort === "modified_asc") return "s.modified_at ASC";
  if (sort === "created_desc") return "s.created_at DESC";
  if (sort === "title_asc") return "COALESCE(usm.custom_title, s.title, s.first_message, s.id) ASC";
  return "s.modified_at DESC";
}

export function createSessionIndexStore(db: Database.Database) {
  function ensureMetadata(username: string, sessionId: string): void {
    db.prepare(`INSERT INTO user_session_metadata (username, session_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(username, session_id) DO NOTHING`).run(username, sessionId, nowIso());
  }

  function sessionOwned(username: string, sessionId: string): boolean {
    const row = db.prepare("SELECT 1 FROM sessions WHERE id=? AND owner_username=? AND missing=0").get(sessionId, username);
    return Boolean(row);
  }

  function setSessionMetadata(username: string, sessionId: string, patch: MetadataPatch) {
    if (!sessionOwned(username, sessionId)) return false;
    ensureMetadata(username, sessionId);
    const current = db.prepare("SELECT favorite, archived, custom_title FROM user_session_metadata WHERE username=? AND session_id=?").get(username, sessionId) as { favorite: number; archived: number; custom_title: string | null };
    db.prepare(`UPDATE user_session_metadata SET favorite=?, archived=?, custom_title=?, updated_at=? WHERE username=? AND session_id=?`).run(
      patch.favorite === undefined ? current.favorite : boolToInt(patch.favorite),
      patch.archived === undefined ? current.archived : boolToInt(patch.archived),
      patch.customTitle === undefined ? current.custom_title : patch.customTitle,
      nowIso(), username, sessionId,
    );
    return true;
  }

  function addTagToSession(username: string, sessionId: string, tagId: number) {
    if (!sessionOwned(username, sessionId)) return false;
    const tag = db.prepare("SELECT id FROM tags WHERE id=? AND username=?").get(tagId, username);
    if (!tag) return false;
    db.prepare(`INSERT OR IGNORE INTO session_tags (username, session_id, tag_id, created_at) VALUES (?, ?, ?, ?)`).run(username, sessionId, tagId, nowIso());
    return true;
  }

  return {
    listSessions(query: SessionListQuery) {
      const where = ["s.owner_username=@username", "s.missing=0", archivedClause(query.archived), orphanedClause(query.orphaned)];
      const params: Record<string, unknown> = { username: query.username, limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
      if (query.cwd) { where.push("s.cwd=@cwd"); params.cwd = query.cwd; }
      if (query.favorite !== undefined) { where.push("COALESCE(usm.favorite, 0)=@favorite"); params.favorite = boolToInt(query.favorite); }
      if (query.q) { where.push("(s.title LIKE @q OR s.first_message LIKE @q OR s.cwd LIKE @q)"); params.q = `%${query.q}%`; }
      if (query.tag) { where.push("EXISTS (SELECT 1 FROM session_tags st JOIN tags t ON t.id=st.tag_id WHERE st.session_id=s.id AND st.username=@username AND (t.name=@tag OR CAST(t.id AS TEXT)=@tag))"); params.tag = query.tag; }
      const whereSql = where.join(" AND ");
      const total = (db.prepare(`SELECT COUNT(*) AS count FROM sessions s LEFT JOIN user_session_metadata usm ON usm.username=@username AND usm.session_id=s.id WHERE ${whereSql}`).get(params) as { count: number }).count;
      const rows = db.prepare(`
        SELECT s.*, COALESCE(usm.favorite,0) AS favorite, COALESCE(usm.archived,0) AS archived, usm.custom_title AS customTitle
        FROM sessions s
        LEFT JOIN user_session_metadata usm ON usm.username=@username AND usm.session_id=s.id
        WHERE ${whereSql}
        ORDER BY ${sortSql(query.sort)}
        LIMIT @limit OFFSET @offset
      `).all(params);
      return { sessions: rows, total, page: query.page, pageSize: query.pageSize };
    },

    setSessionMetadata,

    createTag(username: string, input: TagInput) {
      const name = input.name.trim().slice(0, 40);
      if (!name) throw new Error("tag name is required");
      db.prepare(`INSERT INTO tags (username, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username, name) DO UPDATE SET color=excluded.color, updated_at=excluded.updated_at`).run(username, name, input.color ?? null, nowIso(), nowIso());
      return db.prepare("SELECT id, username, name, color FROM tags WHERE username=? AND name=?").get(username, name) as { id: number; username: string; name: string; color: string | null };
    },

    addTagToSession,

    listTags(username: string) {
      return db.prepare("SELECT id, name, color FROM tags WHERE username=? ORDER BY name ASC").all(username);
    },

    searchSessions(query: { username: string; q: string; cwd?: string; tag?: string; page: number; pageSize: number }) {
      const params: Record<string, unknown> = { username: query.username, q: query.q, limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
      const where = ["session_messages_fts MATCH @q", "s.owner_username=@username", "s.missing=0"];
      if (query.cwd) { where.push("s.cwd=@cwd"); params.cwd = query.cwd; }
      if (query.tag) { where.push("EXISTS (SELECT 1 FROM session_tags st JOIN tags t ON t.id=st.tag_id WHERE st.session_id=s.id AND st.username=@username AND (t.name=@tag OR CAST(t.id AS TEXT)=@tag))"); params.tag = query.tag; }
      const whereSql = where.join(" AND ");
      const total = (db.prepare(`
        SELECT COUNT(*) AS count
        FROM session_messages_fts
        JOIN session_messages sm ON sm.id=session_messages_fts.rowid
        JOIN sessions s ON s.id=sm.session_id
        WHERE ${whereSql}
      `).get(params) as { count: number }).count;
      const results = db.prepare(`
        SELECT s.id AS sessionId, sm.entry_id AS entryId, s.cwd, COALESCE(usm.custom_title, s.title, s.first_message, s.id) AS title,
               snippet(session_messages_fts, 0, '<mark>', '</mark>', '...', 12) AS snippet,
               sm.role, s.modified_at AS modified
        FROM session_messages_fts
        JOIN session_messages sm ON sm.id=session_messages_fts.rowid
        JOIN sessions s ON s.id=sm.session_id
        LEFT JOIN user_session_metadata usm ON usm.username=@username AND usm.session_id=s.id
        WHERE ${whereSql}
        ORDER BY rank
        LIMIT @limit OFFSET @offset
      `).all(params);
      return { results, total, page: query.page, pageSize: query.pageSize };
    },

    bulkUpdate(username: string, sessionIds: string[], op: BulkOperation) {
      const updated: string[] = [];
      const failed: Array<{ sessionId: string; error: string }> = [];
      for (const sessionId of sessionIds) {
        if (!sessionOwned(username, sessionId)) { failed.push({ sessionId, error: "not_found" }); continue; }
        let ok = true;
        if (op.operation === "archive") ok = setSessionMetadata(username, sessionId, { archived: true });
        if (op.operation === "unarchive") ok = setSessionMetadata(username, sessionId, { archived: false });
        if (op.operation === "favorite") ok = setSessionMetadata(username, sessionId, { favorite: true });
        if (op.operation === "unfavorite") ok = setSessionMetadata(username, sessionId, { favorite: false });
        if (op.operation === "add_tag") ok = op.tagId !== undefined && addTagToSession(username, sessionId, op.tagId);
        if (op.operation === "remove_tag") { db.prepare("DELETE FROM session_tags WHERE username=? AND session_id=? AND tag_id=?").run(username, sessionId, op.tagId); ok = true; }
        if (ok) updated.push(sessionId); else failed.push({ sessionId, error: "failed" });
      }
      return { updated, failed };
    },
  };
}
```

- [ ] **Step 4: Verify the task**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/session-index/store.ts __tests__/lib/session-index/store.test.ts
git commit -m "feat: add session index query store"
```

---

### Task 6: Session Index Service And Delete-User Integration

**Files:**
- Create: `lib/session-index/service.ts`
- Modify: `lib/auth/delete-user.ts`
- Test: `__tests__/lib/session-index/delete-user-integration.test.ts`

- [ ] **Step 1: Write delete-user integration test**

Create `__tests__/lib/session-index/delete-user-integration.test.ts` with an isolated database. The test should call the new cleanup function directly, not the full destructive user delete flow:

```ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionIndexDb, migrateSessionIndexDb } from "../../../lib/session-index/db.ts";
import { cleanupDeletedUserSessionIndex } from "../../../lib/session-index/service.ts";

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
});

after(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("cleans deleted user's index and metadata only", () => {
  cleanupDeletedUserSessionIndex(db, "alice", ["a1"]);

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id='a1'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id='b1'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_session_metadata WHERE username='alice'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tags WHERE username='alice'").get().count, 0);
});
```

- [ ] **Step 2: Run failing test**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/delete-user-integration.test.ts
```

Expected: FAIL because `service.ts` does not exist.

- [ ] **Step 3: Implement service cleanup and orchestration exports**

Create `lib/session-index/service.ts`:

```ts
import Database from "better-sqlite3";
import { getSessionIndexDb } from "./db";
import { createSessionIndexStore } from "./store";

export function getSessionIndexStore() {
  return createSessionIndexStore(getSessionIndexDb());
}

export function cleanupDeletedUserSessionIndex(db: Database.Database, username: string, deletedSessionIds: string[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM user_session_metadata WHERE username=?").run(username);
    db.prepare("DELETE FROM session_tags WHERE username=?").run(username);
    db.prepare("DELETE FROM tags WHERE username=?").run(username);
    db.prepare("DELETE FROM user_workspace_metadata WHERE username=?").run(username);
    const deleteSession = db.prepare("DELETE FROM sessions WHERE id=? AND owner_username=?");
    for (const sessionId of deletedSessionIds) deleteSession.run(sessionId, username);
  })();
}

export function cleanupDeletedUserSessionIndexGlobal(username: string, deletedSessionIds: string[]): void {
  cleanupDeletedUserSessionIndex(getSessionIndexDb(), username, deletedSessionIds);
}
```

- [ ] **Step 4: Integrate with user deletion**

Modify `lib/auth/delete-user.ts` imports:

```ts
import { cleanupDeletedUserSessionIndexGlobal } from "@/lib/session-index/service";
```

After deleting jsonl files and collecting `idByPath`, collect deleted ids:

```ts
    const deletedSessionIds: string[] = [];
    for (const file of jsonlFiles) {
      rmSync(file, { force: true });
      const id = idByPath.get(file);
      if (id) {
        deletedSessionIds.push(id);
        invalidateSessionPathCache(id);
      }
    }
```

Inside the final transaction before deleting `users`, call:

```ts
      cleanupDeletedUserSessionIndexGlobal(username, deletedSessionIds);
```

- [ ] **Step 5: Verify the task**

```bash
node --experimental-strip-types --test __tests__/lib/session-index/delete-user-integration.test.ts
npm run test:auth
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/session-index/service.ts lib/auth/delete-user.ts __tests__/lib/session-index/delete-user-integration.test.ts
git commit -m "feat: clean session index during user deletion"
```

---

### Task 7: Sessions API Migration To SQLite Index

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/api/sessions/route.ts`
- Modify: `app/api/sessions/[id]/route.ts`
- Create: `app/api/sessions/search/route.ts`
- Create: `app/api/sessions/bulk/route.ts`

- [ ] **Step 1: Extend shared types**

Modify `lib/types.ts` `SessionInfo` to include optional user metadata without breaking existing callers:

```ts
export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string;
  favorite?: boolean;
  archived?: boolean;
  customTitle?: string | null;
  tags?: { id: number; name: string; color: string | null }[];
  orphaned?: boolean;
  missing?: boolean;
  indexError?: string | null;
}

export interface PaginatedSessionsResponse {
  sessions: SessionInfo[];
  indexStatus: "ready" | "building" | "stale" | "error";
  pagination: { total: number; page: number; pageSize: number };
}
```

- [ ] **Step 2: Replace `/api/sessions` list logic**

Modify `app/api/sessions/route.ts` to parse query params and call `getSessionIndexStore().listSessions()`. Preserve auth behavior:

```ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";
import type { ArchivedFilter, OrphanedFilter, SessionSort } from "@/lib/session-index/types";

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export async function GET(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const url = new URL(req.url);
    const store = getSessionIndexStore();
    const result = store.listSessions({
      username,
      q: url.searchParams.get("q") ?? undefined,
      cwd: url.searchParams.get("cwd") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      favorite: url.searchParams.has("favorite") ? url.searchParams.get("favorite") === "true" : undefined,
      archived: (url.searchParams.get("archived") ?? "exclude") as ArchivedFilter,
      orphaned: (url.searchParams.get("orphaned") ?? "include") as OrphanedFilter,
      sort: (url.searchParams.get("sort") ?? "modified_desc") as SessionSort,
      page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
      pageSize: intParam(url.searchParams.get("pageSize"), 100, 1, 200),
    });
    return NextResponse.json({ sessions: result.sessions, indexStatus: "ready", pagination: { total: result.total, page: result.page, pageSize: result.pageSize } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Extend session PATCH for metadata**

Modify `app/api/sessions/[id]/route.ts` PATCH body parsing so `name` remains optional if metadata is present. After `checkSessionOwnership`, write SQLite metadata first, then append `.jsonl` session_info if `name` is present.

Use this validation rule:

```ts
type PatchBody = { name?: string; favorite?: boolean; archived?: boolean; customTitle?: string | null };

const body = await req.json() as PatchBody;
const hasMetadata = typeof body.favorite === "boolean" || typeof body.archived === "boolean" || typeof body.customTitle === "string" || body.customTitle === null;
if (body.name !== undefined && typeof body.name !== "string") return NextResponse.json({ error: "name must be a string" }, { status: 400 });
if (!hasMetadata && body.name === undefined) return NextResponse.json({ error: "no patch fields provided" }, { status: 400 });
```

Use this failure contract:

```ts
if (hasMetadata) {
  const ok = getSessionIndexStore().setSessionMetadata(guard.username, id, {
    favorite: body.favorite,
    archived: body.archived,
    customTitle: body.customTitle,
  });
  if (!ok) return NextResponse.json({ error: "Session not found" }, { status: 404 });
}

if (body.name !== undefined) {
  try {
    await withCwdOperationGuard(guard.cwd, async () => {
      const sm = SessionManager.open(guard.filePath);
      sm.appendSessionInfo(body.name!.trim());
    });
  } catch (error) {
    const payload = hasMetadata
      ? { error: String(error), partialFailure: "metadata_saved_name_failed" }
      : { error: String(error) };
    return NextResponse.json(payload, { status: 500 });
  }
}

return NextResponse.json({ ok: true });
```

- [ ] **Step 4: Add search route**

Create `app/api/sessions/search/route.ts` that requires login, requires non-empty `q`, calls a store `searchSessions()` method, and returns `{ results, indexStatus, pagination }`. Add `searchSessions()` to `store.ts` using FTS:

```sql
SELECT s.id AS sessionId, sm.entry_id AS entryId, s.cwd, COALESCE(usm.custom_title, s.title, s.first_message, s.id) AS title,
       snippet(session_messages_fts, 0, '<mark>', '</mark>', '...', 12) AS snippet,
       sm.role, s.modified_at AS modified
FROM session_messages_fts
JOIN session_messages sm ON sm.id=session_messages_fts.rowid
JOIN sessions s ON s.id=sm.session_id
LEFT JOIN user_session_metadata usm ON usm.username=@username AND usm.session_id=s.id
WHERE session_messages_fts MATCH @q AND s.owner_username=@username AND s.missing=0
ORDER BY rank
LIMIT @limit OFFSET @offset
```

- [ ] **Step 5: Add bulk route**

Create `app/api/sessions/bulk/route.ts` that validates:

```ts
type BulkBody = {
  sessionIds?: string[];
  operation?: "archive" | "unarchive" | "favorite" | "unfavorite" | "add_tag" | "remove_tag";
  tagId?: number;
};
```

Return 400 for empty `sessionIds`, invalid operation, or tag operations without numeric `tagId`. Return store result `{ updated, failed }`.

- [ ] **Step 6: Verify API type safety**

```bash
npm run typecheck:app
```

Expected: PASS or only pre-existing test-project issues outside app typecheck. Fix any app errors in this task before committing.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts app/api/sessions/route.ts app/api/sessions/[id]/route.ts app/api/sessions/search/route.ts app/api/sessions/bulk/route.ts lib/session-index/store.ts
git commit -m "feat: serve sessions from sqlite index"
```

---

### Task 8: Workspace And Tag APIs

**Files:**
- Create: `app/api/workspaces/route.ts`
- Create: `app/api/workspaces/[cwd]/route.ts`
- Create: `app/api/tags/route.ts`
- Create: `app/api/tags/[id]/route.ts`
- Modify: `lib/session-index/store.ts`

- [ ] **Step 1: Add store methods for workspaces and tag mutation**

Extend `createSessionIndexStore` with:

```ts
listWorkspaces(username: string) {
  return db.prepare(`
    SELECT w.cwd, COALESCE(uwm.display_name, w.display_name) AS displayName,
           w.session_count AS sessionCount, w.last_active_at AS lastActiveAt,
           COALESCE(uwm.pinned,0) AS pinned, uwm.last_opened_at AS lastOpenedAt
    FROM workspaces w
    LEFT JOIN user_workspace_metadata uwm ON uwm.username=? AND uwm.cwd=w.cwd
    WHERE w.owner_username=?
    ORDER BY COALESCE(uwm.pinned,0) DESC, uwm.last_opened_at DESC, w.last_active_at DESC
  `).all(username, username);
},

setWorkspaceMetadata(username: string, cwd: string, patch: { pinned?: boolean; displayName?: string | null }) {
  const workspace = db.prepare("SELECT cwd FROM workspaces WHERE cwd=? AND owner_username=?").get(cwd, username);
  if (!workspace) return false;
  db.prepare(`INSERT INTO user_workspace_metadata (username, cwd, updated_at) VALUES (?, ?, ?) ON CONFLICT(username, cwd) DO NOTHING`).run(username, cwd, nowIso());
  const current = db.prepare("SELECT pinned, display_name FROM user_workspace_metadata WHERE username=? AND cwd=?").get(username, cwd) as { pinned: number; display_name: string | null };
  db.prepare("UPDATE user_workspace_metadata SET pinned=?, display_name=?, updated_at=? WHERE username=? AND cwd=?").run(
    patch.pinned === undefined ? current.pinned : boolToInt(patch.pinned),
    patch.displayName === undefined ? current.display_name : patch.displayName,
    nowIso(), username, cwd,
  );
  return true;
},

updateTag(username: string, tagId: number, patch: { name?: string; color?: string | null }) {
  const tag = db.prepare("SELECT id, name, color FROM tags WHERE id=? AND username=?").get(tagId, username) as { id: number; name: string; color: string | null } | undefined;
  if (!tag) return false;
  db.prepare("UPDATE tags SET name=?, color=?, updated_at=? WHERE id=? AND username=?").run(
    patch.name === undefined ? tag.name : patch.name.trim().slice(0, 40),
    patch.color === undefined ? tag.color : patch.color,
    nowIso(), tagId, username,
  );
  return true;
},

deleteTag(username: string, tagId: number) {
  const result = db.prepare("DELETE FROM tags WHERE id=? AND username=?").run(tagId, username);
  return result.changes > 0;
}
```

- [ ] **Step 2: Create workspaces list route**

Create `app/api/workspaces/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";

export async function GET(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ workspaces: getSessionIndexStore().listWorkspaces(username) });
}
```

- [ ] **Step 3: Create workspace metadata route**

Create `app/api/workspaces/[cwd]/route.ts` with PATCH support. Decode the route param with `decodeURIComponent`; require body `pinned?: boolean`, `displayName?: string | null`; return 404 if store returns false.

- [ ] **Step 4: Create tags collection route**

Create `app/api/tags/route.ts` with GET and POST. GET returns `getSessionIndexStore().listTags(username)`. POST validates `name` is non-empty string and calls `createTag(username, { name, color })`.

- [ ] **Step 5: Create tag item route**

Create `app/api/tags/[id]/route.ts` with PATCH and DELETE. PATCH validates at least one of `name` or `color`; DELETE calls `deleteTag(username, tagId)`.

- [ ] **Step 6: Verify route type safety**

```bash
npm run typecheck:app
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/workspaces app/api/tags lib/session-index/store.ts
git commit -m "feat: add workspace and tag APIs"
```

---

### Task 9: Agent And Session Lifecycle Reindex Hooks

**Files:**
- Modify: `lib/session-index/service.ts`
- Create: `lib/auth/users.ts`
- Modify: `app/api/agent/new/route.ts`
- Modify: `app/api/agent/[id]/route.ts`
- Modify: `app/api/sessions/[id]/route.ts`

- [ ] **Step 1: Add an auth username helper**

Create `lib/auth/users.ts`:

```ts
import { getDb } from "./db";

export function listUsernames(): string[] {
  const rows = getDb().prepare("SELECT username FROM users WHERE disabled=0 ORDER BY username ASC").all() as { username: string }[];
  return rows.map((row) => row.username);
}
```

- [ ] **Step 2: Add service hooks**

Extend `lib/session-index/service.ts` with no-throw hooks:

```ts
import { statSync } from "fs";
import { listUsernames } from "@/lib/auth/users";
import { indexSessionFile } from "./indexer";

export function scheduleIndexSessionFile(filePath: string): void {
  try {
    const stat = statSync(filePath);
    indexSessionFile(getSessionIndexDb(), { path: filePath, mtimeMs: Math.floor(stat.mtimeMs) }, listUsernames());
  } catch (error) {
    console.warn("session index hook failed", error);
  }
}

export function deleteIndexedSessionAfterFileDelete(sessionId: string, username: string): void {
  try {
    cleanupDeletedUserSessionIndexGlobal(username, [sessionId]);
  } catch (error) {
    console.warn("session index delete hook failed", error);
  }
}
```

- [ ] **Step 3: Hook new session creation**

In `app/api/agent/new/route.ts`, after the real session exists and a session file path is known, call `scheduleIndexSessionFile(filePath)`. If the route only has session id initially, resolve the file path after creation using existing wrapper state or `resolveSessionPath()`.

- [ ] **Step 4: Hook existing session POST**

In `app/api/agent/[id]/route.ts`, after successful commands that can append messages, fork, or change metadata, call `scheduleIndexSessionFile()` for the current session file. For fork responses with a new session id/path, schedule both original and new file when available.

- [ ] **Step 5: Hook session rename and delete**

In `app/api/sessions/[id]/route.ts`:

- After successful `appendSessionInfo`, schedule reindex for `guard.filePath`.
- After successful delete and `invalidateSessionPathCache(id)`, call `deleteIndexedSessionAfterFileDelete(id, guard.username)`.

- [ ] **Step 6: Verify app type safety**

```bash
npm run typecheck:app
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/users.ts lib/session-index/service.ts app/api/agent/new/route.ts app/api/agent/[id]/route.ts app/api/sessions/[id]/route.ts
git commit -m "feat: keep session index current from session APIs"
```

---

### Task 10: Sidebar Utilities And Component Extraction

**Files:**
- Create: `components/session-sidebar/types.ts`
- Create: `components/session-sidebar/utils.ts`
- Create: `__tests__/components/session-sidebar-utils.test.ts`
- Modify: `components/SessionSidebar.tsx`

- [ ] **Step 1: Write utility tests**

Create `__tests__/components/session-sidebar-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSessionTree, shortenCwd } from "@/components/session-sidebar/utils";
import type { SessionInfo } from "@/lib/types";

function session(id: string, parentSessionId?: string): SessionInfo {
  return { id, parentSessionId, path: `/tmp/${id}.jsonl`, cwd: "/p", created: "2026-07-15T00:00:00.000Z", modified: `2026-07-15T00:00:0${id.length}.000Z`, messageCount: 1, firstMessage: id };
}

describe("session sidebar utils", () => {
  it("shortens cwd relative to home", () => {
    expect(shortenCwd("/home/hsops/pi-users/alice/project", "/home/hsops")).toBe(".../alice/project".replace("...", "…"));
  });

  it("shortens non-home cwd using the last two path segments", () => {
    expect(shortenCwd("/srv/apps/pi-web-auth", "/home/hsops")).toBe("…/pi-web-auth");
  });

  it("builds tree through nearest existing ancestor", () => {
    const tree = buildSessionTree([session("root"), session("child", "root")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].session.id).toBe("child");
  });
});
```

- [ ] **Step 2: Run failing utility tests**

```bash
npm run test:ui -- __tests__/components/session-sidebar-utils.test.ts
```

Expected: FAIL because `components/session-sidebar/utils.ts` does not exist.

- [ ] **Step 3: Extract types and utilities**

Create `components/session-sidebar/types.ts`:

```ts
import type { SessionInfo } from "@/lib/types";

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

export type ArchiveFilter = "exclude" | "include" | "only";

export interface WorkspaceSummary {
  cwd: string;
  displayName: string | null;
  sessionCount: number;
  lastActiveAt: string | null;
  pinned: boolean | number;
  lastOpenedAt: string | null;
}
```

Create `components/session-sidebar/utils.ts`:

```ts
import type { SessionInfo } from "@/lib/types";
import type { SessionTreeNode } from "./types";

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function shortenCwd(cwd: string, homeDir?: string): string {
  const displayPath = homeDir && cwd.startsWith(homeDir) ? "~" + cwd.slice(homeDir.length) : cwd;
  const sep = displayPath.includes("/") ? "/" : "\\";
  const parts = displayPath.split(sep).filter(Boolean);
  if (parts.length <= 2) return displayPath;
  return "…/" + parts.slice(-2).join(sep);
}

export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const session of sessions) byId.set(session.id, { session, children: [] });

  const parentOf = new Map<string, string>();
  for (const session of sessions) {
    if (session.parentSessionId) parentOf.set(session.id, session.parentSessionId);
  }

  function resolveAncestor(id: string): string | null {
    let current = parentOf.get(id);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      if (byId.has(current)) return current;
      current = parentOf.get(current);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) byId.get(ancestor)!.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((left, right) => right.session.modified.localeCompare(left.session.modified));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}
```

- [ ] **Step 4: Update `SessionSidebar.tsx` imports**

Remove local definitions of those utilities and import:

```ts
import { buildSessionTree, formatRelativeTime, shortenCwd } from "./session-sidebar/utils";
```

- [ ] **Step 5: Verify utility extraction**

```bash
npm run test:ui -- __tests__/components/session-sidebar-utils.test.ts
npm run typecheck:app
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/session-sidebar/types.ts components/session-sidebar/utils.ts components/SessionSidebar.tsx __tests__/components/session-sidebar-utils.test.ts
git commit -m "refactor: extract session sidebar utilities"
```

---

### Task 11: Workspace Switcher And Server-Backed Recent Workspaces

**Files:**
- Create: `components/session-sidebar/WorkspaceSwitcher.tsx`
- Modify: `components/SessionSidebar.tsx`

- [ ] **Step 1: Create WorkspaceSwitcher component**

Create `components/session-sidebar/WorkspaceSwitcher.tsx`:

```tsx
"use client";

import type { WorkspaceSummary } from "./types";
import { shortenCwd } from "./utils";

interface Props {
  workspaces: WorkspaceSummary[];
  selectedCwd: string | null;
  homeDir: string;
  open: boolean;
  customPathOpen: boolean;
  customPathValue: string;
  onToggleOpen: () => void;
  onSelect: (cwd: string) => void;
  onPin: (cwd: string, pinned: boolean) => void;
  onDefaultCwd: () => void;
  onCustomPathOpen: () => void;
  onCustomPathValueChange: (value: string) => void;
  onCommitCustomPath: () => void;
}

export function WorkspaceSwitcher(props: Props) {
  return (
    <div style={{ position: "relative" }}>
      <button onClick={props.onToggleOpen} style={{ width: "100%", display: "flex", alignItems: "center", padding: "6px 10px", background: props.selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)", border: props.selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "var(--text)", textAlign: "left" }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11 }} title={props.selectedCwd ?? ""}>
          {props.selectedCwd ? shortenCwd(props.selectedCwd, props.homeDir) : "Select project..."}
        </span>
      </button>
      {props.open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.10)", overflow: "hidden" }}>
          {props.workspaces.map((workspace) => (
            <div key={workspace.cwd} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)", background: workspace.cwd === props.selectedCwd ? "var(--bg-selected)" : "none" }}>
              <button onClick={() => props.onSelect(workspace.cwd)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={workspace.cwd}>
                {workspace.displayName || shortenCwd(workspace.cwd, props.homeDir)}
              </button>
              <button onClick={() => props.onPin(workspace.cwd, !Boolean(workspace.pinned))} title={workspace.pinned ? "Unpin workspace" : "Pin workspace"} style={{ width: 24, height: 24, border: "1px solid var(--border)", background: workspace.pinned ? "var(--bg-selected)" : "var(--bg-hover)", color: workspace.pinned ? "var(--accent)" : "var(--text-muted)", borderRadius: 6, cursor: "pointer" }}>★</button>
            </div>
          ))}
          <button onClick={props.onDefaultCwd} style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", textAlign: "left", cursor: "pointer", fontSize: 12 }}>Use default directory</button>
          {props.customPathOpen ? (
            <div style={{ display: "flex", gap: 6, padding: 8 }}>
              <input value={props.customPathValue} onChange={(event) => props.onCustomPathValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onCommitCustomPath(); }} style={{ flex: 1, minWidth: 0, background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "6px 8px", fontSize: 11 }} />
              <button onClick={props.onCommitCustomPath} style={{ border: "1px solid var(--border)", background: "var(--bg-hover)", color: "var(--text)", borderRadius: 6, padding: "0 8px" }}>Go</button>
            </div>
          ) : (
            <button onClick={props.onCustomPathOpen} style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", textAlign: "left", cursor: "pointer", fontSize: 12 }}>Open path...</button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Load server workspaces in SessionSidebar**

Add state to `components/SessionSidebar.tsx`:

```ts
const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
```

Add loader:

```ts
const loadWorkspaces = useCallback(async () => {
  const res = await authFetch("/api/workspaces");
  if (!res.ok) return;
  const data = await res.json() as { workspaces: WorkspaceSummary[] };
  setWorkspaces(data.workspaces);
}, []);
```

Call it with `useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces, refreshKey]);`.

- [ ] **Step 3: Replace cwd picker JSX**

Replace the current cwd dropdown block with `WorkspaceSwitcher`. Keep custom path and default cwd behavior. When selecting a workspace, call `setSelectedCwd(cwd)`. For pinning, call `PATCH /api/workspaces/${encodeURIComponent(cwd)}`; do not call `useRecentCwds().addCwd` for server workspaces.

- [ ] **Step 4: Verify**

```bash
npm run typecheck:app
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/session-sidebar/WorkspaceSwitcher.tsx components/SessionSidebar.tsx
git commit -m "feat: add server backed workspace switcher"
```

---

### Task 12: Session Search, Filters, Rows, Tags, And Bulk UI

**Files:**
- Create: `components/session-sidebar/SessionSearchBox.tsx`
- Create: `components/session-sidebar/SessionFilterBar.tsx`
- Create: `components/session-sidebar/SessionTree.tsx`
- Create: `components/session-sidebar/SessionRow.tsx`
- Create: `components/session-sidebar/BulkSessionToolbar.tsx`
- Create: `components/session-sidebar/TagPicker.tsx`
- Create: `components/session-sidebar/ArchiveViewToggle.tsx`
- Modify: `components/SessionSidebar.tsx`
- Test: `__tests__/components/session-sidebar-smoke.test.tsx`

- [ ] **Step 1: Write smoke test for sidebar controls**

Create `__tests__/components/session-sidebar-smoke.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionSidebar } from "@/components/SessionSidebar";

vi.mock("@/lib/client-auth-fetch", () => ({ authFetch: vi.fn() }));
import { authFetch } from "@/lib/client-auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);

beforeEach(() => {
  mockAuthFetch.mockImplementation(async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.startsWith("/api/sessions/search")) return new Response(JSON.stringify({ results: [], indexStatus: "ready", pagination: { total: 0, page: 1, pageSize: 20 } }), { status: 200 });
    if (value.startsWith("/api/sessions")) return new Response(JSON.stringify({ sessions: [{ id: "s1", path: "/tmp/s1", cwd: "/p", created: "2026-07-15T00:00:00.000Z", modified: "2026-07-15T00:00:00.000Z", messageCount: 1, firstMessage: "hello", favorite: false, archived: false }], indexStatus: "ready", pagination: { total: 1, page: 1, pageSize: 100 } }), { status: 200 });
    if (value.startsWith("/api/workspaces")) return new Response(JSON.stringify({ workspaces: [{ cwd: "/p", displayName: null, sessionCount: 1, lastActiveAt: "2026-07-15T00:00:00.000Z", pinned: false, lastOpenedAt: null }] }), { status: 200 });
    if (value.startsWith("/api/tags")) return new Response(JSON.stringify({ tags: [] }), { status: 200 });
    if (value.startsWith("/api/home")) return new Response(JSON.stringify({ home: "/home/hsops" }), { status: 200 });
    if (value.startsWith("/api/default-cwd")) return new Response(JSON.stringify({ cwd: "/p" }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

describe("SessionSidebar advanced controls", () => {
  it("renders search, filters, workspace and session row", async () => {
    render(<SessionSidebar selectedSessionId={null} onSelectSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/hello/)).toBeTruthy());
    expect(screen.getByPlaceholderText(/Search sessions/)).toBeTruthy();
    expect(screen.getByTitle(/Favorite/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing smoke test**

```bash
npm run test:ui -- __tests__/components/session-sidebar-smoke.test.tsx
```

Expected: FAIL because the new controls do not exist.

- [ ] **Step 3: Add search and filter components**

Create `SessionSearchBox.tsx`, `SessionFilterBar.tsx`, and `ArchiveViewToggle.tsx` as controlled components. Required props:

```ts
SessionSearchBox: { value: string; onChange(value: string): void; onSubmit(): void; searching: boolean }
SessionFilterBar: { favoriteOnly: boolean; onFavoriteOnlyChange(value: boolean): void; selectedTag: string | null; tags: Array<{ id: number; name: string; color: string | null }>; onTagChange(value: string | null): void }
ArchiveViewToggle: { value: "exclude" | "include" | "only"; onChange(value): void }
```

Use compact buttons, inputs with stable height, no nested cards, no horizontal overflow.

- [ ] **Step 4: Add row/tree/tag/bulk components**

Create `SessionRow.tsx`, `SessionTree.tsx`, `TagPicker.tsx`, and `BulkSessionToolbar.tsx`. Required behavior:

- `SessionRow` renders title, cwd-short first message, relative time, favorite button, archive button, orphaned badge, tag chips, checkbox in multi-select mode.
- `SessionTree` recursively renders `SessionTreeNode[]` and delegates row actions.
- `TagPicker` lists current user tags and calls `onToggleTag(tagId)`.
- `BulkSessionToolbar` renders selected count and buttons for favorite, archive, tag, clear.

- [ ] **Step 5: Wire SessionSidebar state to APIs**

Modify `components/SessionSidebar.tsx`:

- Load `/api/sessions` with query params for `cwd`, `q`, `favorite`, `archived`, `tag`.
- Load `/api/tags` once and after tag mutations.
- Call `PATCH /api/sessions/[id]` for favorite/archive row actions.
- Call `POST /api/sessions/bulk` for bulk actions.
- Show search results as a flat list when `q` is non-empty; show tree otherwise.
- Keep `onSelectSession(session)` behavior unchanged.

- [ ] **Step 6: Verify UI tests and typecheck**

```bash
npm run test:ui -- __tests__/components/session-sidebar-utils.test.ts __tests__/components/session-sidebar-smoke.test.tsx
npm run typecheck:app
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/session-sidebar components/SessionSidebar.tsx __tests__/components/session-sidebar-smoke.test.tsx
git commit -m "feat: add advanced session sidebar controls"
```

---

### Task 13: Backup/Release Integration And Health Visibility

**Files:**
- Modify: `scripts/backup-production.mjs`
- Modify: `__tests__/release/release-scripts.test.ts`

- [ ] **Step 1: Add session-index backup helpers**

Modify `scripts/backup-production.mjs`:

- Add `session-index.db`, `session-index.db-wal`, and `session-index.db-shm` to the `.pi-web-auth` rsync exclude list.
- Add `backupOptionalDatabase(source, destination)` that returns `{ status: "missing" }` when the source does not exist and otherwise uses `backupDatabase()` then `inspectSessionIndexDatabase()`.
- Add `inspectSessionIndexDatabase(path)` that opens the copied SQLite file, runs `PRAGMA integrity_check`, and returns `{ status: "ok", integrityCheck: "ok" }` when valid.

Use this helper code:

```js
function inspectSessionIndexDatabase(path) {
  if (!existsSync(path)) return { status: "missing" };
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrityCheck = db.pragma("integrity_check", { simple: true });
    if (integrityCheck !== "ok") throw new Error("session index integrity check failed");
    return { status: "ok", integrityCheck };
  } finally {
    db.close();
  }
}

async function backupOptionalDatabase(source, destination) {
  if (!existsSync(source)) return { status: "missing" };
  await backupDatabase(source, destination);
  return inspectSessionIndexDatabase(destination);
}
```

- [ ] **Step 2: Include session-index in prepare, finalize, validate, and manifest**

In `prepare(options)`, after backing up `auth.db`, call:

```js
await backupOptionalDatabase(join(paths.sourceAuth, "session-index.db"), join(paths.incomplete, ".pi-web-auth", "session-index.db"));
```

In `finalize(options)`, after backing up `auth.db`, call the same helper and store the result:

```js
const sessionIndex = skipFinal
  ? inspectSessionIndexDatabase(join(paths.incomplete, ".pi-web-auth", "session-index.db"))
  : await backupOptionalDatabase(join(paths.sourceAuth, "session-index.db"), join(paths.incomplete, ".pi-web-auth", "session-index.db"));
```

Add this field to `manifest`:

```json
{
  "sessionIndex": {
    "status": "ok",
    "integrityCheck": "ok"
  }
}
```

If the file does not exist, the field must be `{ "status": "missing" }` and backup validation must still pass.

In `validate(options)`, inspect the copied `session-index.db` and fail if the manifest says `status:"ok"` but the copied database integrity is not `ok`.

- [ ] **Step 3: Add release test coverage**

Extend `__tests__/release/release-scripts.test.ts` by adding a `session-index.db` to the existing `productionHome(root)` fixture. Use `better-sqlite3` to create this file:

```ts
const sessionIndex = new Database(join(home, ".pi-web-auth", "session-index.db"));
sessionIndex.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions (id) VALUES ('s1');");
sessionIndex.close();
```

Then extend the existing `prepare plus finalize creates an atomic verified backup manifest` test with:

```ts
assert.equal(manifest.sessionIndex.status, "ok");
assert.equal(manifest.sessionIndex.integrityCheck, "ok");
assert.equal(existsSync(join(backupRoot, "backup-1", ".pi-web-auth", "session-index.db")), true);
```

Add a separate test for missing session index:

```ts
test("backup manifest allows missing session index before feature deployment", async () => {
  const root = tempRoot();
  const home = await productionHome(root);
  rmSync(join(home, ".pi-web-auth", "session-index.db"), { force: true });
  const backupRoot = join(root, "backups");
  const common = ["scripts/backup-production.mjs", "--home", home, "--backup-root", backupRoot, "--backup-id", "backup-missing-index", "--release-id", "release-1", "--commit", "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86"];
  assert.equal(spawnSync(process.execPath, [common[0], "prepare", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [common[0], "finalize", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  const manifest = JSON.parse(readFileSync(join(backupRoot, "backup-missing-index", "backup.json"), "utf8"));
  assert.deepEqual(manifest.sessionIndex, { status: "missing" });
});
```

- [ ] **Step 4: Verify release tests**

```bash
npm run test:release
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup-production.mjs __tests__/release/release-scripts.test.ts
git commit -m "feat: include session index in production backups"
```

---

### Task 14: End-To-End Verification In Isolated HOME

**Files:**
- Modify only files needed to fix verification failures from prior tasks.

- [ ] **Step 1: Run backend tests**

```bash
npm run test:auth
node --experimental-strip-types --test "__tests__/lib/session-index/**/*.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run UI tests**

```bash
npm run test:ui
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: PASS. If repository-existing test type issues reappear, document the exact pre-existing errors and still fix all new app/source errors.

- [ ] **Step 4: Start isolated dev server**

```bash
HOME=/home/hsops/.pi-session-workspace-dev-home npm run dev -- -p 8144
```

Expected: server starts on `http://127.0.0.1:8144`. Keep production `http://127.0.0.1:8000` untouched.

- [ ] **Step 5: Manual acceptance checklist**

In the browser on port 8144 verify:

- Create/login admin, user A, user B.
- User A sees server-backed workspace list.
- User A can favorite, archive, tag, pin workspace, refresh, and retain state.
- User B does not see User A favorite/tag/archive/pin state.
- Search by title/first message/cwd works.
- Full-text search returns message snippets and opens the session.
- Batch favorite/archive/tag updates only selected sessions.
- Orphaned malformed session appears as incomplete and does not crash the list.
- Mobile viewport has no horizontal overflow in search/filter/bulk/row controls.

- [ ] **Step 6: Stop dev server and verify production still responds**

```bash
curl -I http://127.0.0.1:8000/login
```

Expected: HTTP 200 or redirect consistent with current production behavior.

- [ ] **Step 7: Final verification command**

```bash
npm run verify
```

Expected: PASS before requesting code review or release preparation.

- [ ] **Step 8: Commit verification fixes if files changed**

Run:

```bash
git status --short
```

If the output is empty, no commit is needed. If files changed while fixing verification failures, inspect the exact files and commit only those related fixes:

```bash
git diff --stat
```

Then return to the task whose verification failed, update that task's implementation commit with a small follow-up commit using the same file scope and a message that names the failed area, for example `fix: stabilize session index search tests` or `fix: correct workspace sidebar state`.
