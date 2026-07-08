import { NextResponse } from "next/server";
import { homedir } from "os";
import { getSessionUser } from "@/lib/auth/session";

export async function GET(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ home: homedir() });
}
