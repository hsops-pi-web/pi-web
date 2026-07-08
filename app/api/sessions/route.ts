import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getSessionUser } from "@/lib/auth/session";
import { resolveExistingAndCheck } from "@/lib/auth/paths";

export async function GET(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const sessions = await listAllSessions();
    // realpath 解析每个 cwd 后判断归属，防 symlink 混入。cwd 不存在的会话被排除。
    const filtered = sessions.filter((s) => s.cwd && resolveExistingAndCheck(s.cwd, username));
    return NextResponse.json({ sessions: filtered });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
