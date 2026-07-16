import type Database from "better-sqlite3";
import type { AdminVisibility } from "../auth/admin-visibility";

export type AdminSessionStatus = "normal" | "missing" | "orphaned" | "index_error" | "any_issue";
export type AdminSessionSort = "modified_desc" | "modified_asc" | "created_desc" | "title_asc";
export type AdminWorkspaceSort = "last_active_desc" | "session_count_desc" | "cwd_asc";

export interface OwnerSummary {
  sessionCount: number;
  workspaceCount: number;
  missingCount: number;
  orphanedCount: number;
  indexErrorCount: number;
  lastActiveAt: string | null;
}

function ownerFilter(visibility: AdminVisibility, alias = "s"): { sql: string; params: Record<string, unknown> } {
  if (visibility.visibleOwnerUsernames.length === 0) return { sql: "1=0", params: {} };
  const params: Record<string, unknown> = {};
  const names = visibility.visibleOwnerUsernames.map((name, index) => {
    params[`owner${index}`] = name;
    return `@owner${index}`;
  });
  return { sql: `${alias}.owner_username IN (${names.join(", ")})`, params };
}

function mapSession(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    path: String(row.path),
    ownerUsername: row.owner_username === null ? null : String(row.owner_username),
    cwd: String(row.cwd),
    title: row.title === null ? null : String(row.title),
    firstMessage: row.first_message === null ? null : String(row.first_message),
    createdAt: String(row.created_at),
    modifiedAt: String(row.modified_at),
    messageCount: Number(row.message_count),
    parentSessionId: row.parent_session_id === null ? null : String(row.parent_session_id),
    parentSessionPath: row.parent_session_path === null ? null : String(row.parent_session_path),
    missing: row.missing === 1,
    orphaned: row.orphaned === 1,
    sourceMtimeMs: Number(row.source_mtime_ms),
    indexedAt: row.indexed_at === null ? null : String(row.indexed_at),
    indexError: row.index_error === null ? null : String(row.index_error),
  };
}

function mapWorkspace(row: Record<string, unknown>) {
  return {
    cwd: String(row.cwd),
    ownerUsername: row.owner_username === null ? null : String(row.owner_username),
    displayName: row.display_name === null ? null : String(row.display_name),
    sessionCount: Number(row.session_count),
    lastActiveAt: row.last_active_at === null ? null : String(row.last_active_at),
    indexedAt: row.indexed_at === null ? null : String(row.indexed_at),
  };
}

function sessionOrderBy(sort: AdminSessionSort): string {
  if (sort === "modified_asc") return "s.modified_at ASC";
  if (sort === "created_desc") return "s.created_at DESC";
  if (sort === "title_asc") return "COALESCE(s.title, s.first_message, s.id) ASC";
  return "s.modified_at DESC";
}

function workspaceOrderBy(sort: AdminWorkspaceSort): string {
  if (sort === "session_count_desc") return "w.session_count DESC, w.last_active_at DESC";
  if (sort === "cwd_asc") return "w.cwd ASC";
  return "w.last_active_at DESC";
}

export function createAdminSessionIndexStore(db: Database.Database) {
  function getOwnerSummaries(_visibility: AdminVisibility, usernames: string[]) {
    const result = new Map<string, OwnerSummary>();
    for (const username of usernames) {
      result.set(username, {
        sessionCount: 0,
        workspaceCount: 0,
        missingCount: 0,
        orphanedCount: 0,
        indexErrorCount: 0,
        lastActiveAt: null,
      });
    }
    if (usernames.length === 0) return result;
    const params: Record<string, unknown> = {};
    const names = usernames.map((name, index) => {
      params[`u${index}`] = name;
      return `@u${index}`;
    });
    const sessionRows = db.prepare(`
      SELECT owner_username,
             COUNT(*) AS sessionCount,
             MAX(modified_at) AS lastActiveAt,
             SUM(CASE WHEN missing=1 THEN 1 ELSE 0 END) AS missingCount,
             SUM(CASE WHEN orphaned=1 THEN 1 ELSE 0 END) AS orphanedCount,
             SUM(CASE WHEN index_error IS NOT NULL THEN 1 ELSE 0 END) AS indexErrorCount
      FROM sessions
      WHERE owner_username IN (${names.join(", ")})
      GROUP BY owner_username
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
    const workspaceRows = db.prepare(`
      SELECT owner_username, COUNT(*) AS workspaceCount
      FROM workspaces
      WHERE owner_username IN (${names.join(", ")})
      GROUP BY owner_username
    `).all(params) as Array<Record<string, unknown>>;
    for (const row of workspaceRows) {
      const current = result.get(String(row.owner_username));
      if (current) current.workspaceCount = Number(row.workspaceCount);
    }
    return result;
  }

  function listAdminSessions(visibility: AdminVisibility, filters: {
    username?: string;
    cwd?: string;
    q?: string;
    status?: AdminSessionStatus;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
    sort: AdminSessionSort;
  }) {
    const owner = ownerFilter(visibility, "s");
    const where = [owner.sql, "s.missing=0", "s.orphaned=0", "s.index_error IS NULL"];
    const params: Record<string, unknown> = { ...owner.params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    if (filters.username) {
      where.push("s.owner_username=@username");
      params.username = filters.username;
    }
    if (filters.cwd) {
      where.push("s.cwd LIKE @cwd");
      params.cwd = `${filters.cwd}%`;
    }
    if (filters.q) {
      where.push("(s.title LIKE @q OR s.first_message LIKE @q OR s.cwd LIKE @q)");
      params.q = `%${filters.q}%`;
    }
    if (filters.status) {
      where.splice(1, 3);
      if (filters.status === "normal") where.push("s.missing=0 AND s.orphaned=0 AND s.index_error IS NULL");
      if (filters.status === "missing") where.push("s.missing=1");
      if (filters.status === "orphaned") where.push("s.orphaned=1");
      if (filters.status === "index_error") where.push("s.index_error IS NOT NULL");
      if (filters.status === "any_issue") where.push("(s.missing=1 OR s.orphaned=1 OR s.index_error IS NOT NULL)");
    }
    if (filters.from) {
      where.push("s.modified_at>=@from");
      params.from = filters.from;
    }
    if (filters.to) {
      where.push("s.modified_at<=@to");
      params.to = filters.to;
    }
    const whereSql = where.join(" AND ");
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM sessions s WHERE ${whereSql}`).get(params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT s.*
      FROM sessions s
      WHERE ${whereSql}
      ORDER BY ${sessionOrderBy(filters.sort)}
      LIMIT @limit OFFSET @offset
    `).all(params) as Array<Record<string, unknown>>;
    return { sessions: rows.map(mapSession), total, page: filters.page, pageSize: filters.pageSize };
  }

  function searchAdminSessions(visibility: AdminVisibility, filters: { q: string; username?: string; cwd?: string; page: number; pageSize: number }) {
    const owner = ownerFilter(visibility, "s");
    const where = ["session_messages_fts MATCH @q", owner.sql, "s.missing=0", "s.orphaned=0"];
    const params: Record<string, unknown> = { ...owner.params, q: filters.q, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    if (filters.username) {
      where.push("s.owner_username=@username");
      params.username = filters.username;
    }
    if (filters.cwd) {
      where.push("s.cwd LIKE @cwd");
      params.cwd = `${filters.cwd}%`;
    }
    const whereSql = where.join(" AND ");
    const total = (db.prepare(`
      SELECT COUNT(DISTINCT s.id) AS count
      FROM session_messages_fts
      JOIN session_messages sm ON sm.id=session_messages_fts.rowid
      JOIN sessions s ON s.id=sm.session_id
      WHERE ${whereSql}
    `).get(params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT s.id AS sessionId,
             sm.entry_id AS entryId,
             s.owner_username AS ownerUsername,
             s.cwd,
             COALESCE(s.title, s.first_message, s.id) AS title,
             snippet(session_messages_fts, 0, '<mark>', '</mark>', '...', 12) AS snippet,
             sm.role,
             s.modified_at AS modifiedAt
      FROM session_messages_fts
      JOIN session_messages sm ON sm.id=session_messages_fts.rowid
      JOIN sessions s ON s.id=sm.session_id
      WHERE ${whereSql}
      ORDER BY rank
      LIMIT @limit OFFSET @offset
    `).all(params) as Array<Record<string, unknown>>;
    return { results: rows, total, page: filters.page, pageSize: filters.pageSize };
  }

  function listAdminWorkspaces(visibility: AdminVisibility, filters: { username?: string; q?: string; activeFrom?: string; page: number; pageSize: number; sort: AdminWorkspaceSort }) {
    const owner = ownerFilter(visibility, "w");
    const where = [owner.sql];
    const params: Record<string, unknown> = { ...owner.params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    if (filters.username) {
      where.push("w.owner_username=@username");
      params.username = filters.username;
    }
    if (filters.q) {
      where.push("(w.cwd LIKE @q OR w.display_name LIKE @q)");
      params.q = `%${filters.q}%`;
    }
    if (filters.activeFrom) {
      where.push("w.last_active_at>=@activeFrom");
      params.activeFrom = filters.activeFrom;
    }
    const whereSql = where.join(" AND ");
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM workspaces w WHERE ${whereSql}`).get(params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT w.*
      FROM workspaces w
      WHERE ${whereSql}
      ORDER BY ${workspaceOrderBy(filters.sort)}
      LIMIT @limit OFFSET @offset
    `).all(params) as Array<Record<string, unknown>>;
    return { workspaces: rows.map(mapWorkspace), total, page: filters.page, pageSize: filters.pageSize };
  }

  function getAdminIndexHealth(visibility: AdminVisibility, filters: { page: number; pageSize: number; staleCandidateCount?: number }) {
    const owner = ownerFilter(visibility, "s");
    const visibleWhere = `(${owner.sql}${visibility.includeUnownedIndexIssues ? " OR s.owner_username IS NULL" : ""})`;
    const issueWhere = [visibleWhere, "(s.missing=1 OR s.orphaned=1 OR s.index_error IS NOT NULL)"];
    const params: Record<string, unknown> = { ...owner.params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    const issues = db.prepare(`
      SELECT s.*
      FROM sessions s
      WHERE ${issueWhere.join(" AND ")}
      ORDER BY s.modified_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as Array<Record<string, unknown>>;
    const totals = db.prepare(`
      SELECT COUNT(*) AS totalSessions,
             SUM(CASE WHEN missing=1 THEN 1 ELSE 0 END) AS missing,
             SUM(CASE WHEN orphaned=1 THEN 1 ELSE 0 END) AS orphaned,
             SUM(CASE WHEN index_error IS NOT NULL THEN 1 ELSE 0 END) AS indexError,
             MIN(indexed_at) AS oldestIndexedAt,
             MAX(indexed_at) AS newestIndexedAt
      FROM sessions s
      WHERE ${visibleWhere}
    `).get(owner.params) as Record<string, unknown>;
    const workspaceOwner = ownerFilter(visibility, "w");
    const workspaceWhere = `(${workspaceOwner.sql}${visibility.includeUnownedIndexIssues ? " OR w.owner_username IS NULL" : ""})`;
    const totalWorkspaces = (db.prepare(`SELECT COUNT(*) AS count FROM workspaces w WHERE ${workspaceWhere}`).get(workspaceOwner.params) as { count: number }).count;
    const unowned = visibility.includeUnownedIndexIssues
      ? (db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE owner_username IS NULL AND (missing=1 OR orphaned=1 OR index_error IS NOT NULL)").get() as { count: number }).count
      : 0;
    return {
      databaseAvailable: true,
      totalSessions: Number(totals.totalSessions ?? 0),
      totalWorkspaces,
      oldestIndexedAt: totals.oldestIndexedAt === null ? null : String(totals.oldestIndexedAt),
      newestIndexedAt: totals.newestIndexedAt === null ? null : String(totals.newestIndexedAt),
      staleCandidateCount: filters.staleCandidateCount ?? 0,
      issueCounts: {
        missing: Number(totals.missing ?? 0),
        orphaned: Number(totals.orphaned ?? 0),
        indexError: Number(totals.indexError ?? 0),
        unowned,
      },
      issues: issues.map(mapSession),
      page: filters.page,
      pageSize: filters.pageSize,
    };
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
      issues: listAdminSessions(visibility, { username: targetUsername, status: "any_issue", page: 1, pageSize: 20, sort: "modified_desc" }).sessions,
    };
  }

  return {
    getOwnerSummaries,
    listAdminSessions,
    searchAdminSessions,
    listAdminWorkspaces,
    getAdminIndexHealth,
    getAdminOverview,
    getAdminUserObservability,
  };
}
