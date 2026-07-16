import { NextResponse } from "next/server";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getDb } from "@/lib/auth/db";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { recordAdminAuditEvent, shouldRecordViewAudit } from "@/lib/auth/admin-audit";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";
import { getSessionIndexDb } from "@/lib/session-index/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const guard = guardAdminViewTarget(req, username);
  const authDb = getDb();
  if (guard instanceof NextResponse) return guard;

  const visibility = createAdminVisibility(authDb, guard.actor);
  const detail = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath())).getAdminUserObservability(visibility, username);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (shouldRecordViewAudit(authDb, guard.actor.username, username)) {
    recordAdminAuditEvent(authDb, {
      actorUsername: guard.actor.username,
      actorRole: guard.actor.role,
      action: "user.view_observability",
      targetUsername: username,
      targetType: "user",
      targetId: username,
      status: "success",
      summary: `viewed ${username}`,
      metadata: null,
    });
  }

  return NextResponse.json({ user: detail });
}
