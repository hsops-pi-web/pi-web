import { NextResponse } from "next/server";
import { getUserRole } from "@/lib/auth/admin-guard";
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
  if (!canChangeRole(guard.role)) {
    return NextResponse.json({ error: "无权限改角色" }, { status: 403 });
  }

  const { username } = await params;
  const targetRole = getUserRole(username);
  if (!targetRole) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (isSuperAdmin(targetRole) || username === SUPER_ADMIN) {
    return NextResponse.json(
      { error: "不可修改 super_admin 角色" },
      { status: 403 }
    );
  }

  const body = (await req.json()) as { role?: unknown };
  if (!isValidRole(body.role) || (body.role !== "user" && body.role !== "admin")) {
    return NextResponse.json(
      { error: "只能设为 user 或 admin" },
      { status: 400 }
    );
  }

  getDb().prepare("UPDATE users SET role=? WHERE username=?").run(body.role, username);
  return NextResponse.json({ ok: true, username, role: body.role });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { username } = await params;
  const targetRole = getUserRole(username);
  if (!targetRole) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (username === guard.username) {
    return NextResponse.json({ error: "不能删除自己" }, { status: 403 });
  }
  if (!canManage(guard.role, targetRole)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const result = await deleteUserCompletely(username);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
