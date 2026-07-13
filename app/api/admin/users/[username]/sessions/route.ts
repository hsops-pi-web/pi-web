import { NextResponse } from "next/server";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";
import { resolveSessionOwnership } from "@/lib/auth/paths";
import { listAllSessions } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const guard = guardAdminViewTarget(req, username);
  if (guard instanceof NextResponse) return guard;

  const sessions = await listAllSessions();
  const cwdAllowed = new Map<string, boolean>();
  const filtered = sessions.filter((session) => {
    if (!session.cwd) return false;
    let allowed = cwdAllowed.get(session.cwd);
    if (allowed === undefined) {
      allowed = resolveSessionOwnership(session.cwd, username);
      cwdAllowed.set(session.cwd, allowed);
    }
    return allowed;
  });
  return NextResponse.json({ sessions: filtered });
}
