import Database from "better-sqlite3";
import type { ArchivedFilter, OrphanedFilter, SessionListQuery, SessionSearchQuery, SessionSort } from "./types";

interface MetadataPatch {
  favorite?: boolean;
  archived?: boolean;
  customTitle?: string | null;
  lastOpenedAt?: string | null;
}

interface TagInput {
  name: string;
  color?: string | null;
}

interface WorkspaceMetadataPatch {
  pinned?: boolean;
  displayName?: string | null;
  lastOpenedAt?: string | null;
}

interface BulkOperation {
  operation: "archive" | "unarchive" | "favorite" | "unfavorite" | "add_tag" | "remove_tag";
  tagId?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function boolToInt(value: boolean): 1 | 0 {
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean {
  return value === 1 || value === true;
}

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

function normalizeTagName(name: string): string {
  return name.trim().slice(0, 40);
}

function mapSessionRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    path: String(row.path),
    cwd: String(row.cwd),
    ownerUsername: row.owner_username === null ? null : String(row.owner_username),
    title: row.title === null ? null : String(row.title),
    firstMessage: row.first_message === null ? null : String(row.first_message),
    createdAt: String(row.created_at),
    modifiedAt: String(row.modified_at),
    messageCount: Number(row.message_count),
    parentSessionId: row.parent_session_id === null ? null : String(row.parent_session_id),
    parentSessionPath: row.parent_session_path === null ? null : String(row.parent_session_path),
    orphaned: intToBool(row.orphaned),
    missing: intToBool(row.missing),
    sourceMtimeMs: Number(row.source_mtime_ms),
    indexedAt: row.indexed_at === null ? null : String(row.indexed_at),
    indexError: row.index_error === null ? null : String(row.index_error),
    favorite: intToBool(row.favorite),
    archived: intToBool(row.archived),
    customTitle: row.customTitle === null ? null : String(row.customTitle),
  };
}

export function createSessionIndexStore(db: Database.Database) {
  function ensureMetadata(username: string, sessionId: string): void {
    db.prepare(`INSERT INTO user_session_metadata (username, session_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(username, session_id) DO NOTHING`).run(username, sessionId, nowIso());
  }

  function sessionOwned(username: string, sessionId: string): boolean {
    const row = db.prepare("SELECT 1 FROM sessions WHERE id=? AND owner_username=? AND missing=0").get(sessionId, username);
    return Boolean(row);
  }

  function workspaceOwned(username: string, cwd: string): boolean {
    const row = db.prepare("SELECT 1 FROM workspaces WHERE cwd=? AND owner_username=?").get(cwd, username);
    return Boolean(row);
  }

  function setSessionMetadata(username: string, sessionId: string, patch: MetadataPatch): boolean {
    if (!sessionOwned(username, sessionId)) return false;
    ensureMetadata(username, sessionId);
    const current = db.prepare("SELECT favorite, archived, last_opened_at, custom_title FROM user_session_metadata WHERE username=? AND session_id=?").get(username, sessionId) as {
      favorite: number;
      archived: number;
      last_opened_at: string | null;
      custom_title: string | null;
    };

    db.prepare(`
      UPDATE user_session_metadata
      SET favorite=?, archived=?, last_opened_at=?, custom_title=?, updated_at=?
      WHERE username=? AND session_id=?
    `).run(
      patch.favorite === undefined ? current.favorite : boolToInt(patch.favorite),
      patch.archived === undefined ? current.archived : boolToInt(patch.archived),
      patch.lastOpenedAt === undefined ? current.last_opened_at : patch.lastOpenedAt,
      patch.customTitle === undefined ? current.custom_title : patch.customTitle,
      nowIso(),
      username,
      sessionId,
    );
    return true;
  }

  function createTag(username: string, input: TagInput) {
    const name = normalizeTagName(input.name);
    if (!name) throw new Error("tag name is required");
    const now = nowIso();
    db.prepare(`
      INSERT INTO tags (username, name, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username, name) DO UPDATE SET color=excluded.color, updated_at=excluded.updated_at
    `).run(username, name, input.color ?? null, now, now);
    return db.prepare("SELECT id, username, name, color FROM tags WHERE username=? AND name=?").get(username, name) as { id: number; username: string; name: string; color: string | null };
  }

  function addTagToSession(username: string, sessionId: string, tagId: number): boolean {
    if (!sessionOwned(username, sessionId)) return false;
    const tag = db.prepare("SELECT id FROM tags WHERE id=? AND username=?").get(tagId, username);
    if (!tag) return false;
    db.prepare(`INSERT OR IGNORE INTO session_tags (username, session_id, tag_id, created_at) VALUES (?, ?, ?, ?)`).run(username, sessionId, tagId, nowIso());
    return true;
  }

  function removeTagFromSession(username: string, sessionId: string, tagId: number): boolean {
    if (!sessionOwned(username, sessionId)) return false;
    db.prepare("DELETE FROM session_tags WHERE username=? AND session_id=? AND tag_id=?").run(username, sessionId, tagId);
    return true;
  }

  function listSessions(query: SessionListQuery) {
    const where = ["s.owner_username=@username", "s.missing=0", archivedClause(query.archived), orphanedClause(query.orphaned)];
    const params: Record<string, unknown> = { username: query.username, limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
    if (query.cwd) {
      where.push("s.cwd=@cwd");
      params.cwd = query.cwd;
    }
    if (query.favorite !== undefined) {
      where.push("COALESCE(usm.favorite, 0)=@favorite");
      params.favorite = boolToInt(query.favorite);
    }
    if (query.q) {
      where.push("(s.title LIKE @q OR s.first_message LIKE @q OR s.cwd LIKE @q)");
      params.q = `%${query.q}%`;
    }
    if (query.tag) {
      where.push("EXISTS (SELECT 1 FROM session_tags st JOIN tags t ON t.id=st.tag_id WHERE st.session_id=s.id AND st.username=@username AND (t.name=@tag OR CAST(t.id AS TEXT)=@tag))");
      params.tag = query.tag;
    }
    const whereSql = where.join(" AND ");
    const total = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions s
      LEFT JOIN user_session_metadata usm ON usm.username=@username AND usm.session_id=s.id
      WHERE ${whereSql}
    `).get(params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT s.*, COALESCE(usm.favorite,0) AS favorite, COALESCE(usm.archived,0) AS archived, usm.custom_title AS customTitle
      FROM sessions s
      LEFT JOIN user_session_metadata usm ON usm.username=@username AND usm.session_id=s.id
      WHERE ${whereSql}
      ORDER BY ${sortSql(query.sort)}
      LIMIT @limit OFFSET @offset
    `).all(params) as Array<Record<string, unknown>>;
    return { sessions: rows.map(mapSessionRow), total, page: query.page, pageSize: query.pageSize };
  }

  function searchSessions(query: SessionSearchQuery) {
    const params: Record<string, unknown> = { username: query.username, q: query.q, limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
    const where = ["session_messages_fts MATCH @q", "s.owner_username=@username", "s.missing=0"];
    if (query.cwd) {
      where.push("s.cwd=@cwd");
      params.cwd = query.cwd;
    }
    if (query.tag) {
      where.push("EXISTS (SELECT 1 FROM session_tags st JOIN tags t ON t.id=st.tag_id WHERE st.session_id=s.id AND st.username=@username AND (t.name=@tag OR CAST(t.id AS TEXT)=@tag))");
      params.tag = query.tag;
    }
    const whereSql = where.join(" AND ");
    const total = (db.prepare(`
      SELECT COUNT(DISTINCT s.id) AS count
      FROM session_messages_fts
      JOIN session_messages sm ON sm.id=session_messages_fts.rowid
      JOIN sessions s ON s.id=sm.session_id
      WHERE ${whereSql}
    `).get(params) as { count: number }).count;
    const results = db.prepare(`
      SELECT s.id AS sessionId, sm.entry_id AS entryId, s.cwd, COALESCE(usm.custom_title, s.title, s.first_message, s.id) AS title,
             snippet(session_messages_fts, 0, '<mark>', '</mark>', '...', 12) AS snippet,
             sm.role, s.modified_at AS modifiedAt
      FROM session_messages_fts
      JOIN session_messages sm ON sm.id=session_messages_fts.rowid
      JOIN sessions s ON s.id=sm.session_id
      LEFT JOIN user_session_metadata usm ON usm.username=@username AND usm.session_id=s.id
      WHERE ${whereSql}
      ORDER BY rank
      LIMIT @limit OFFSET @offset
    `).all(params) as Array<Record<string, unknown>>;
    return { results, total, page: query.page, pageSize: query.pageSize };
  }

  function listTags(username: string) {
    return db.prepare("SELECT id, name, color FROM tags WHERE username=? ORDER BY name ASC").all(username) as Array<{ id: number; name: string; color: string | null }>;
  }

  function deleteTag(username: string, tagId: number): boolean {
    const result = db.prepare("DELETE FROM tags WHERE id=? AND username=?").run(tagId, username);
    return result.changes > 0;
  }

  function updateTag(username: string, tagId: number, patch: { name?: string; color?: string | null }): boolean {
    const tag = db.prepare("SELECT id, name, color FROM tags WHERE id=? AND username=?").get(tagId, username) as { id: number; name: string; color: string | null } | undefined;
    if (!tag) return false;
    const name = patch.name === undefined ? tag.name : normalizeTagName(patch.name);
    if (!name) return false;
    db.prepare("UPDATE tags SET name=?, color=?, updated_at=? WHERE id=? AND username=?").run(
      name,
      patch.color === undefined ? tag.color : patch.color,
      nowIso(),
      tagId,
      username,
    );
    return true;
  }

  function listWorkspaces(username: string) {
    const rows = db.prepare(`
      SELECT w.cwd, COALESCE(uwm.display_name, w.display_name) AS displayName, w.session_count AS sessionCount,
             w.last_active_at AS lastActiveAt, COALESCE(uwm.pinned, 0) AS pinned, uwm.last_opened_at AS lastOpenedAt
      FROM workspaces w
      LEFT JOIN user_workspace_metadata uwm ON uwm.username=? AND uwm.cwd=w.cwd
      WHERE w.owner_username=?
      ORDER BY COALESCE(uwm.pinned, 0) DESC, COALESCE(uwm.last_opened_at, w.last_active_at) DESC, w.cwd ASC
    `).all(username, username) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      cwd: String(row.cwd),
      displayName: row.displayName === null ? null : String(row.displayName),
      sessionCount: Number(row.sessionCount),
      lastActiveAt: row.lastActiveAt === null ? null : String(row.lastActiveAt),
      pinned: intToBool(row.pinned),
      lastOpenedAt: row.lastOpenedAt === null ? null : String(row.lastOpenedAt),
    }));
  }

  function setWorkspaceMetadata(username: string, cwd: string, patch: WorkspaceMetadataPatch): boolean {
    if (!workspaceOwned(username, cwd)) return false;
    db.prepare(`INSERT INTO user_workspace_metadata (username, cwd, updated_at) VALUES (?, ?, ?) ON CONFLICT(username, cwd) DO NOTHING`).run(username, cwd, nowIso());
    const current = db.prepare("SELECT pinned, last_opened_at, display_name FROM user_workspace_metadata WHERE username=? AND cwd=?").get(username, cwd) as {
      pinned: number;
      last_opened_at: string | null;
      display_name: string | null;
    };
    db.prepare(`
      UPDATE user_workspace_metadata
      SET pinned=?, last_opened_at=?, display_name=?, updated_at=?
      WHERE username=? AND cwd=?
    `).run(
      patch.pinned === undefined ? current.pinned : boolToInt(patch.pinned),
      patch.lastOpenedAt === undefined ? current.last_opened_at : patch.lastOpenedAt,
      patch.displayName === undefined ? current.display_name : patch.displayName,
      nowIso(),
      username,
      cwd,
    );
    return true;
  }

  function bulkUpdate(username: string, sessionIds: string[], op: BulkOperation) {
    const updated: string[] = [];
    const failed: Array<{ sessionId: string; error: string }> = [];
    for (const sessionId of sessionIds) {
      if (!sessionOwned(username, sessionId)) {
        failed.push({ sessionId, error: "not_found" });
        continue;
      }
      let ok = true;
      if (op.operation === "archive") ok = setSessionMetadata(username, sessionId, { archived: true });
      if (op.operation === "unarchive") ok = setSessionMetadata(username, sessionId, { archived: false });
      if (op.operation === "favorite") ok = setSessionMetadata(username, sessionId, { favorite: true });
      if (op.operation === "unfavorite") ok = setSessionMetadata(username, sessionId, { favorite: false });
      if (op.operation === "add_tag") ok = op.tagId !== undefined && addTagToSession(username, sessionId, op.tagId);
      if (op.operation === "remove_tag") ok = op.tagId !== undefined && removeTagFromSession(username, sessionId, op.tagId);
      if (ok) updated.push(sessionId);
      else failed.push({ sessionId, error: "failed" });
    }
    return { updated, failed };
  }

  return {
    listSessions,
    searchSessions,
    setSessionMetadata,
    createTag,
    addTagToSession,
    removeTagFromSession,
    listTags,
    updateTag,
    deleteTag,
    listWorkspaces,
    setWorkspaceMetadata,
    bulkUpdate,
  };
}
