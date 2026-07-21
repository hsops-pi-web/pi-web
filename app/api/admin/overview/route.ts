import { NextResponse } from "next/server";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getDb } from "@/lib/auth/db";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { buildAdminOverviewResponse, type AdminUserRow } from "@/lib/auth/admin-observability-responses";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";
import { getSessionIndexDb } from "@/lib/session-index/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const authDb = getDb();
  const visibility = createAdminVisibility(authDb, guard);
  const authUsers = authDb
    .prepare("SELECT username, role, disabled, created_at FROM users ORDER BY created_at ASC")
    .all() as AdminUserRow[];
  const overview = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath())).getAdminOverview(visibility);
  return NextResponse.json({
    overview: buildAdminOverviewResponse({
      actorRole: visibility.actorRole,
      authUsers,
      visibleOwnerUsernames: visibility.visibleOwnerUsernames,
      overview,
    }),
  });
}
