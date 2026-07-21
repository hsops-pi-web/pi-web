import { NextResponse } from "next/server";
import { getUserRole } from "@/lib/auth/admin-guard";
import { safeRecordAdminAuditEvent } from "@/lib/auth/admin-audit";
import { getDb } from "@/lib/auth/db";
import { canManage } from "@/lib/auth/roles";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { username } = await params;
  const db = getDb();
  const auditFailure = (reason: string) => safeRecordAdminAuditEvent(db, {
    actorUsername: guard.username,
    actorRole: guard.role,
    action: "user.disable",
    targetUsername: username,
    targetType: "user",
    targetId: username,
    status: "failure",
    summary: `failed to update disabled state for ${username}`,
    metadata: { reason },
  });
  const targetRole = getUserRole(username);
  if (!targetRole) {
    auditFailure("not_found");
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (username === guard.username) {
    auditFailure("self_disable");
    return NextResponse.json({ error: "不能禁用自己" }, { status: 403 });
  }
  if (!canManage(guard.role, targetRole)) {
    auditFailure("forbidden");
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { disabled?: unknown };
  let disabled: 0 | 1;
  if (body.disabled === 1 || body.disabled === true) disabled = 1;
  else if (body.disabled === 0 || body.disabled === false) disabled = 0;
  else {
    auditFailure("invalid_disabled");
    return NextResponse.json(
      { error: "disabled 必须为 0 或 1" },
      { status: 400 }
    );
  }

  db.prepare("UPDATE users SET disabled=? WHERE username=?").run(disabled, username);
  if (disabled === 1) {
    db.prepare("DELETE FROM sessions WHERE username=?").run(username);
  }
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

  return NextResponse.json({ ok: true, username, disabled });
}
