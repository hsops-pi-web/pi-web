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
    // 同一 cwd 只解析一次（用户常在同一目录开多个会话）。
    const cwdAllowed = new Map<string, boolean>();
    const filtered = sessions.filter((s) => {
      if (!s.cwd) return false;
      let allowed = cwdAllowed.get(s.cwd);
      if (allowed === undefined) {
        allowed = resolveExistingAndCheck(s.cwd, username);
        cwdAllowed.set(s.cwd, allowed);
      }
      return allowed;
    });
    return NextResponse.json({ sessions: filtered });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
