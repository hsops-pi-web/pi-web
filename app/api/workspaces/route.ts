import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";

export async function GET(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json({ workspaces: getSessionIndexStore().listWorkspaces(username) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
