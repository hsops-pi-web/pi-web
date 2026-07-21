import { NextResponse } from "next/server";
import { getDb } from "./db";
import { isSuperAdmin, type Role } from "./roles";
import { requireAdmin } from "./session";

export function getUserRole(username: string): Role | null {
  const row = getDb()
    .prepare("SELECT role FROM users WHERE username=?")
    .get(username) as { role: Role | null } | undefined;
  return row ? row.role ?? "user" : null;
}

export function guardAdminViewTarget(
  request: Request,
  targetUsername: string
): { actor: { username: string; role: Role }; targetRole: Role } | NextResponse {
  const actor = requireAdmin(request);
  if (actor instanceof NextResponse) return actor;

  const targetRole = getUserRole(targetUsername);
  if (!targetRole) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (isSuperAdmin(targetRole) && actor.username !== targetUsername) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  return { actor, targetRole };
}
