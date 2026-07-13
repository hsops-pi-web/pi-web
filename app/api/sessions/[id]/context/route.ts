import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildSessionContext } from "@/lib/session-reader";
import { checkSessionOwnership, sessionGuardMessage } from "@/lib/auth/session-guard";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;

  try {
    const guard = await checkSessionOwnership(req, id);
    if (!guard.ok) {
      return NextResponse.json({ error: sessionGuardMessage(guard.status) }, { status: guard.status });
    }

    const sm = SessionManager.open(guard.filePath);
    const context = buildSessionContext(sm.getEntries() as never, leafId);

    return NextResponse.json({ context });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
