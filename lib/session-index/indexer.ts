import Database from "better-sqlite3";
import { lstatSync, readFileSync, realpathSync } from "fs";
import os from "os";
import path, { basename } from "path";
import type { ScannedSessionFile } from "./scanner";

const MAX_SEARCH_TEXT = 20_000;

function nowIso(): string {
  return new Date().toISOString();
}

function fallbackSessionId(filePath: string): string {
  return `orphaned:${filePath}`;
}

function truncateSearchText(text: string): string {
  return text.length > MAX_SEARCH_TEXT ? text.slice(0, MAX_SEARCH_TEXT) : text;
}

function extractMessageText(message: unknown): string {
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

function getUserRoot(username: string): string {
  return path.join(os.homedir(), "pi-users", username);
}

function isInsideUserRoot(target: string, username: string): boolean {
  const root = getUserRoot(username);
  const normalized = path.resolve(target);
  return normalized === root || normalized.startsWith(root + path.sep);
}

function canonicalizeExistingPrefix(target: string): string {
  const absolute = path.resolve(target);
  const segments = absolute.split(path.sep).filter(Boolean);

  for (let index = segments.length; index >= 0; index--) {
    const prefix = path.sep + segments.slice(0, index).join(path.sep);
    let exists = index === 0;
    if (!exists) {
      try {
        lstatSync(prefix);
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!exists) continue;

    const realPrefix = index === 0 ? path.sep : realpathSync(prefix);
    const remainder = segments.slice(index);
    return remainder.length ? path.join(realPrefix, ...remainder) : realPrefix;
  }

  return absolute;
}

function ownsSessionCwd(cwd: string, username: string): boolean {
  if (!cwd) return false;
  try {
    return isInsideUserRoot(canonicalizeExistingPrefix(cwd), username);
  } catch {
    return false;
  }
}

function computeSessionOwner(cwd: string, usernames: string[]): string | null {
  if (!cwd) return null;
  const owners = usernames.filter((username) => ownsSessionCwd(cwd, username));
  return owners.length === 1 ? owners[0] : null;
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
    const parentSessionId = header.parentSession
      ? (db.prepare("SELECT id FROM sessions WHERE path=?").get(header.parentSession) as { id: string } | undefined)?.id ?? null
      : null;

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
        parentSessionId,
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
