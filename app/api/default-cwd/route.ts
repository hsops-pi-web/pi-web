import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { getSessionUser } from "@/lib/auth/session";
import { getUserRoot } from "@/lib/auth/paths";

export async function POST(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const dir = getUserRoot(username);
    mkdirSync(dir, { recursive: true });
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
