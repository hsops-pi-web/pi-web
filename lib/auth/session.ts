import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "./db";
import { isAdmin, isSuperAdmin, type Role } from "./roles";

export const SESSION_COOKIE = "pi_auth";
export const SESSION_MAX_AGE_SEC = 604800; // 7 天

export function createSession(username: string): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  getDb().prepare("INSERT INTO sessions(token,username,expires_at) VALUES(?,?,?)")
    .run(token, username, expiresAt);
  return token;
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token=?").run(token);
}

export function readCookieToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

function resolveSession(request: Request): { username: string; role: Role } | null {
  const token = readCookieToken(request);
  if (!token) return null;
  const row = getDb().prepare(
    `SELECT s.username AS username, s.expires_at AS expires_at,
            u.role AS role, u.disabled AS disabled
     FROM sessions s JOIN users u ON u.username = s.username
     WHERE s.token = ?`
  ).get(token) as
    | { username: string; expires_at: number; role: Role; disabled: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  if (row.disabled === 1) return null;
  return { username: row.username, role: row.role ?? "user" };
}

export function getSessionUser(request: Request): string | null {
  return resolveSession(request)?.username ?? null;
}

export function getSessionUserWithRole(
  request: Request
): { username: string; role: Role } | null {
  return resolveSession(request);
}

export function requireAdmin(
  request: Request
): { username: string; role: Role } | NextResponse {
  const session = resolveSession(request);
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isAdmin(session.role)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  return session;
}

export function requireSuperAdmin(
  request: Request
): { username: string; role: Role } | NextResponse {
  const session = resolveSession(request);
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(session.role)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  return session;
}
