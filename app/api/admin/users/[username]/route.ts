import { NextResponse } from "next/server";
import { getUserRole } from "@/lib/auth/admin-guard";
import { safeRecordAdminAuditEvent } from "@/lib/auth/admin-audit";
import { getDb } from "@/lib/auth/db";
import { deleteUserCompletely } from "@/lib/auth/delete-user";
import {
  canChangeRole,
  canManage,
  isSuperAdmin,
  isValidRole,
  SUPER_ADMIN,
} from "@/lib/auth/roles";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const guard = requireSuperAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const db = getDb();
  const { username } = await params;
  const auditRoleFailure = (reason: string, role?: unknown) => safeRecordAdminAuditEvent(db, {
    actorUsername: guard.username,
    actorRole: guard.role,
    action: "user.role_update",
    targetUsername: username,
    targetType: "user",
    targetId: username,
    status: "failure",
    summary: `failed to update role for ${username}`,
    metadata: { reason, role },
  });
  if (!canChangeRole(guard.role)) {
    auditRoleFailure("forbidden");
    return NextResponse.json({ error: "无权限改角色" }, { status: 403 });
  }

  const targetRole = getUserRole(username);
  if (!targetRole) {
    auditRoleFailure("not_found");
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (isSuperAdmin(targetRole) || username === SUPER_ADMIN) {
    auditRoleFailure("super_admin_target");
    return NextResponse.json(
      { error: "不可修改 super_admin 角色" },
      { status: 403 }
    );
  }

  const body = (await req.json()) as { role?: unknown };
  if (!isValidRole(body.role) || (body.role !== "user" && body.role !== "admin")) {
    auditRoleFailure("invalid_role", body.role);
    return NextResponse.json(
      { error: "只能设为 user 或 admin" },
      { status: 400 }
    );
  }

  db.prepare("UPDATE users SET role=? WHERE username=?").run(body.role, username);
  safeRecordAdminAuditEvent(db, {
    actorUsername: guard.username,
    actorRole: guard.role,
    action: "user.role_update",
    targetUsername: username,
    targetType: "user",
    targetId: username,
    status: "success",
    summary: `updated role for ${username}`,
    metadata: { role: body.role },
  });
  return NextResponse.json({ ok: true, username, role: body.role });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  const { username } = await params;
  const auditDeleteFailure = (reason: string) => safeRecordAdminAuditEvent(db, {
    actorUsername: guard.username,
    actorRole: guard.role,
    action: "user.delete",
    targetUsername: username,
    targetType: "user",
    targetId: username,
    status: "failure",
    summary: `failed to delete ${username}`,
    metadata: { reason },
  });
  const targetRole = getUserRole(username);
  if (!targetRole) {
    auditDeleteFailure("not_found");
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (username === guard.username) {
    auditDeleteFailure("self_delete");
    return NextResponse.json({ error: "不能删除自己" }, { status: 403 });
  }
  if (!canManage(guard.role, targetRole)) {
    auditDeleteFailure("forbidden");
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const result = await deleteUserCompletely(username);
  if (!result.ok) {
    auditDeleteFailure(result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  safeRecordAdminAuditEvent(db, {
    actorUsername: guard.username,
    actorRole: guard.role,
    action: "user.delete",
    targetUsername: username,
    targetType: "user",
    targetId: username,
    status: "success",
    summary: `deleted ${username}`,
    metadata: null,
  });
  return NextResponse.json({ ok: true });
}
