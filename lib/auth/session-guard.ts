import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";
import { getSessionUser } from "@/lib/auth/session";
import { resolveExistingAndCheck } from "@/lib/auth/paths";

export type SessionGuardResult =
  | { ok: true; filePath: string; cwd: string }
  | { ok: false; status: 401 | 404 };

// 会话归属校验：确认请求者已登录，且目标 session 的 cwd 落在其用户目录内。
// 返回已解析的 filePath 与 cwd 供调用方复用，避免重复 resolveSessionPath / open。
// 越权与未找到都返回 404，不泄露 session id 是否存在。
export async function checkSessionOwnership(
  req: Request,
  id: string,
): Promise<SessionGuardResult> {
  const username = getSessionUser(req);
  if (!username) return { ok: false, status: 401 };

  const filePath = await resolveSessionPath(id);
  if (!filePath) return { ok: false, status: 404 };

  const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? "";
  if (!cwd || !resolveExistingAndCheck(cwd, username)) {
    return { ok: false, status: 404 };
  }
  return { ok: true, filePath, cwd };
}
