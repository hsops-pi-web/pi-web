import { NextResponse } from "next/server";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { startRpcSession, withStartGuard } from "@/lib/rpc-manager";
import { getSessionUser } from "@/lib/auth/session";
import { getUserRoot, resolveExistingAndCheck, resolveParentAndCheck } from "@/lib/auth/paths";
import { setUserModelPreference } from "@/lib/auth/model-preferences";
import { getUserModelPreference } from "@/lib/auth/model-preferences";
import { applyNewSessionModel } from "@/lib/model-selection";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getProcessLifecycle, ProcessDrainingError } from "@/lib/process-lifecycle";
import { scheduleIndexSessionFile } from "@/lib/session-index/service";

function drainingResponse() {
  const admission = getProcessLifecycle().agentAdmission();
  return admission.allowed ? null : NextResponse.json({ error: admission.error }, { status: admission.status, headers: { "Retry-After": admission.retryAfter } });
}

function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return `${homedir()}${path.slice(1)}`;
  return path;
}

// POST /api/agent/new  body: { cwd: string; type: string; message: string; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  const rejected = drainingResponse();
  if (rejected) return rejected;
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
    const { provider, modelId, rememberModel, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; rememberModel?: boolean; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown };
    const requestedModel = provider && modelId ? { provider, modelId } : null;
    const storedPreference = getUserModelPreference(username);
    const availablePreference = storedPreference && ModelRegistry
      .create(AuthStorage.create())
      .getAvailable()
      .some((model) => model.provider === storedPreference.provider && model.id === storedPreference.modelId)
      ? storedPreference
      : null;
    const payload = await withStartGuard(cwd, async () => {
      getProcessLifecycle().assertAcceptingAgentCommands();
      mkdirSync(cwd, { recursive: true });
      const tempKey = `__new__${Date.now()}`;
      const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);
      await applyNewSessionModel(
        session,
        username,
        requestedModel,
        availablePreference,
        rememberModel === true,
        setUserModelPreference
      );
      if (thinkingLevel) {
        await session.send({ type: "set_thinking_level", level: thinkingLevel });
      }
      const result = await session.send(promptCommand);
      scheduleIndexSessionFile(session.sessionFile);
      return { success: true, sessionId: realSessionId, data: result };
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof ProcessDrainingError) return NextResponse.json({ error: error.message }, { status: 503, headers: { "Retry-After": "5" } });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
