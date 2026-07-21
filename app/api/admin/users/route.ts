import { NextResponse } from "next/server";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getDb } from "@/lib/auth/db";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import {
  mergeUserObservabilitySummaries,
  parseAdminUserSort,
  sortAdminUsers,
  type AdminUserRow,
} from "@/lib/auth/admin-observability-responses";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";
import { getSessionIndexDb } from "@/lib/session-index/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const authDb = getDb();
  const users = authDb
    .prepare(
      "SELECT username, role, disabled, created_at FROM users ORDER BY created_at ASC"
    )
    .all() as AdminUserRow[];
  const visibility = createAdminVisibility(authDb, guard);
  const summaries = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath())).getOwnerSummaries(
    visibility,
    users.map((user) => user.username),
  );
  const merged = mergeUserObservabilitySummaries(users, summaries);
  return NextResponse.json({ users: sortAdminUsers(merged, parseAdminUserSort(url.searchParams.get("sort"))) });
}
