import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";

type WorkspacePatch = {
  pinned?: boolean;
  displayName?: string | null;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ cwd: string }> }
) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { cwd: encodedCwd } = await params;
    const cwd = decodeURIComponent(encodedCwd);
    const body = await req.json() as WorkspacePatch;
    const hasPinned = typeof body.pinned === "boolean";
    const hasDisplayName = typeof body.displayName === "string" || body.displayName === null;
    if (!hasPinned && !hasDisplayName) return NextResponse.json({ error: "no patch fields provided" }, { status: 400 });

    const ok = getSessionIndexStore().setWorkspaceMetadata(username, cwd, {
      pinned: body.pinned,
      displayName: body.displayName,
    });
    if (!ok) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
