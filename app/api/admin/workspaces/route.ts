import { NextResponse } from "next/server";
import { enumParam, intParam } from "@/lib/api-params";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getDb } from "@/lib/auth/db";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminSessionIndexStore, type AdminWorkspaceSort } from "@/lib/session-index/admin-store";
import { getSessionIndexDb } from "@/lib/session-index/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const visibility = createAdminVisibility(getDb(), guard);
  const store = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath()));
  return NextResponse.json(store.listAdminWorkspaces(visibility, {
    username: url.searchParams.get("username") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    activeFrom: url.searchParams.get("activeFrom") ?? undefined,
    sort: enumParam<AdminWorkspaceSort>(url.searchParams.get("sort"), ["last_active_desc", "session_count_desc", "cwd_asc"], "last_active_desc"),
    page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
    pageSize: intParam(url.searchParams.get("pageSize"), 50, 1, 200),
  }));
}
