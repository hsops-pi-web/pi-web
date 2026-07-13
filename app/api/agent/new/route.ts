import { NextResponse } from "next/server";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { startRpcSession, withStartGuard } from "@/lib/rpc-manager";
import { getSessionUser } from "@/lib/auth/session";
import { getUserRoot, resolveExistingAndCheck, resolveParentAndCheck } from "@/lib/auth/paths";
import { setUserModelPreference } from "@/lib/auth/model-preferences";
import { switchModelAndRemember } from "@/lib/model-selection";

function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return `${homedir()}${path.slice(1)}`;
  return path;
}

// POST /api/agent/new  body: { cwd: string; type: string; message: string; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd: rawCwd, ...command } = body;

    const cwd = rawCwd && typeof rawCwd === "string" ? expandHomePath(rawCwd) : getUserRoot(username);
    // 已存在：realpath 解析 target 本身；不存在：解析父目录（允许在用户根内新建）。
    // 两种情形都必须落在用户根内，否则拒绝。防 symlink 子路径逃逸。
    const ok = existsSync(cwd)
      ? resolveExistingAndCheck(cwd, username)
      : resolveParentAndCheck(cwd, username);
    if (!ok) {
      return NextResponse.json({ error: "cwd 必须在你的用户目录内" }, { status: 400 });
    }
    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown };
    const payload = await withStartGuard(cwd, async () => {
      mkdirSync(cwd, { recursive: true });
      const tempKey = `__new__${Date.now()}`;
      const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);
      if (provider && modelId) {
        await switchModelAndRemember(
          session,
          username,
          provider,
          modelId,
          setUserModelPreference
        );
      }
      if (thinkingLevel) {
        await session.send({ type: "set_thinking_level", level: thinkingLevel });
      }
      const result = await session.send(promptCommand);
      return { success: true, sessionId: realSessionId, data: result };
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
