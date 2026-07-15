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

test("missing file is marked when indexed row exists", () => {
  db.prepare("INSERT INTO sessions (id, path, cwd, created_at, modified_at) VALUES (?, ?, ?, ?, ?)").run("missing", "/tmp/missing.jsonl", "/tmp", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z");

  markMissingSessionPath(db, "/tmp/missing.jsonl");

  const row = db.prepare("SELECT missing FROM sessions WHERE path=?").get("/tmp/missing.jsonl") as { missing: number } | undefined;
  assert.equal(row?.missing, 1);
});
