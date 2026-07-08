import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth/session";
import { getDb } from "@/lib/auth/db";

export async function POST(req: Request) {
  const { username, password } = await req.json() as { username?: string; password?: string };
  const fail = () => NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  if (!username || !password) return fail();
  const row = getDb().prepare("SELECT password_hash FROM users WHERE username=?")
    .get(username) as { password_hash: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return fail();

  const token = createSession(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
