import { NextResponse } from "next/server";
import { getSessionUserWithRole } from "@/lib/auth/session";

export async function GET(req: Request) {
  const session = getSessionUserWithRole(req);
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ username: session.username, role: session.role });
}
