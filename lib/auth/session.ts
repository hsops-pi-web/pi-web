import { randomBytes } from "crypto";
import { getDb } from "./db.ts";

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

export function getSessionUser(request: Request): string | null {
  const token = readCookieToken(request);
  if (!token) return null;
  const row = getDb().prepare("SELECT username,expires_at FROM sessions WHERE token=?")
    .get(token) as { username: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return row.username;
}
