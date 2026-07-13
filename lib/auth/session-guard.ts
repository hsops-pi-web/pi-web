import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { getSessionUser } from "@/lib/auth/session";
import { resolveExistingAndCheck } from "@/lib/auth/paths";

export type SessionGuardResult =
  | { ok: true; filePath: string; cwd: string }
  | { ok: false; status: 401 | 404 };

// 归属校验失败时的统一提示：401 表示未登录，其余按“未找到”处理，不泄露 session 是否存在。
export function sessionGuardMessage(status: 401 | 404): string {
  return status === 401 ? "未登录" : "Session not found";
}

// 会话归属校验：确认请求者已登录，且目标 session 的 cwd 落在其用户目录内。
// 返回已解析的 filePath 与 cwd 供调用方复用，避免重复 resolveSessionPath / open。
// 越权与未找到都返回 404，不泄露 session id 是否存在。
export async function checkSessionOwnership(
  req: Request,
  id: string,
): Promise<SessionGuardResult> {
  const username = getSessionUser(req);
  if (!username) return { ok: false, status: 401 };

  // Fast path: a running session knows its own file and cwd even before that
  // file has been indexed. Trust the wrapper's cwd — the on-disk header's cwd
  // is briefly wrong during the first turn (pi writes process.cwd() before the
  // real cwd settles), which otherwise 404s every events/agent request until
  // the run finishes and the client reconnect-loops on it.
  const running = getRpcSession(id);
  if (running?.isAlive()) {
    const cwd = running.cwd || SessionManager.open(running.sessionFile).getHeader()?.cwd || "";
    if (!cwd || !resolveExistingAndCheck(cwd, username)) {
      return { ok: false, status: 404 };
    }
    return { ok: true, filePath: running.sessionFile, cwd };
  }

  const filePath = await resolveSessionPath(id);
  if (!filePath) return { ok: false, status: 404 };

  const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? "";
  if (!cwd || !resolveExistingAndCheck(cwd, username)) {
    return { ok: false, status: 404 };
  }
  return { ok: true, filePath, cwd };
}
