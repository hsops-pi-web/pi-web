import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/auth/admin-audit";
import { getDb } from "@/lib/auth/db";
import { requireSuperAdmin } from "@/lib/auth/session";
import { syncSessionIndexWithStats } from "@/lib/session-index/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = requireSuperAdmin(req);
  const db = getDb();
  if (guard instanceof NextResponse) return guard;

  try {
    const stats = syncSessionIndexWithStats(undefined, { force: true, throttle: false });
    recordAdminAuditEvent(db, {
      actorUsername: guard.username,
      actorRole: guard.role,
      action: "index.rescan",
      targetType: "index",
      targetId: "session-index",
      status: "success",
      summary: "session index rescan",
      metadata: { ...stats },
    });
    return NextResponse.json({ stats });
  } catch (error) {
    recordAdminAuditEvent(db, {
      actorUsername: guard.username,
      actorRole: guard.role,
      action: "index.rescan",
      targetType: "index",
      targetId: "session-index",
      status: "failure",
      summary: "session index rescan failed",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
