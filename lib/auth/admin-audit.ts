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

export interface AdminAuditEvent {
  id: number;
  actorUsername: string;
  actorRole: string;
  action: string;
  targetUsername: string | null;
  targetType: string | null;
  targetId: string | null;
  status: string;
  summary: string | null;
  metadataJson: string | null;
  createdAt: string;
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

function mapAuditEvent(row: Record<string, unknown>): AdminAuditEvent {
  return {
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
  };
}

export function listAdminAuditEvents(db: Database.Database, query: AuditListQuery) {
  const where: string[] = [];
  const params: Record<string, unknown> = {
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };

  if (query.visibleTargetUsernames !== null) {
    if (query.visibleTargetUsernames.length === 0) {
      where.push("target_username IS NULL");
    } else {
      const names = query.visibleTargetUsernames.map((name, index) => {
        params[`visible${index}`] = name;
        return `@visible${index}`;
      });
      where.push(`(target_username IS NULL OR target_username IN (${names.join(", ")}))`);
    }
  }
  if (query.actor) {
    where.push("actor_username=@actor");
    params.actor = query.actor;
  }
  if (query.target) {
    where.push("target_username=@target");
    params.target = query.target;
  }
  if (query.action) {
    where.push("action=@action");
    params.action = query.action;
  }
  if (query.status) {
    where.push("status=@status");
    params.status = query.status;
  }
  if (query.from) {
    where.push("created_at>=@from");
    params.from = query.from;
  }
  if (query.to) {
    where.push("created_at<=@to");
    params.to = query.to;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM admin_audit_events ${whereSql}`).get(params) as { count: number }).count;
  const rows = db.prepare(`
    SELECT * FROM admin_audit_events ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all(params) as Array<Record<string, unknown>>;

  return {
    events: rows.map(mapAuditEvent),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function shouldRecordViewAudit(
  db: Database.Database,
  actorUsername: string,
  targetUsername: string,
  now = new Date(),
): boolean {
  const since = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT 1 FROM admin_audit_events
    WHERE actor_username=?
      AND target_username=?
      AND action='user.view_observability'
      AND status='success'
      AND created_at>=?
    LIMIT 1
  `).get(actorUsername, targetUsername, since);
  return !row;
}
