import { statSync } from "fs";
import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";
import { resolveSessionOwnership } from "@/lib/auth/paths";
import { buildSessionContext, resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ username: string; id: string }> }
) {
  const { username, id } = await params;
  const guard = guardAdminViewTarget(req, username);
  if (guard instanceof NextResponse) return guard;

  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = SessionManager.open(filePath);
  const cwd = session.getHeader()?.cwd ?? "";
  if (!cwd || !resolveSessionOwnership(cwd, username)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const entries = session.getEntries() as never;
  const leafId = session.getLeafId();
  const context = buildSessionContext(entries, leafId);
  let modified = session.getHeader()?.timestamp ?? new Date().toISOString();
  try {
    modified = statSync(filePath).mtime.toISOString();
  } catch {
    // Keep the header timestamp when the stat is unavailable.
  }

  return NextResponse.json({ context, cwd, modified });
}
