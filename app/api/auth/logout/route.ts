import { NextResponse } from "next/server";
import { destroySession, readCookieToken, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: Request) {
  const token = readCookieToken(req);
  if (token) destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
