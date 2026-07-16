import { NextResponse } from "next/server";
import { intParam } from "@/lib/api-params";
import { listAdminAuditEvents, type AuditStatus } from "@/lib/auth/admin-audit";
import { getDb } from "@/lib/auth/db";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function auditStatusParam(value: string | null): AuditStatus | undefined {
  if (value === "success" || value === "failure") return value;
  return undefined;
}

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const db = getDb();
  const visibility = createAdminVisibility(db, guard);
  return NextResponse.json(listAdminAuditEvents(db, {
    visibleTargetUsernames: guard.role === "super_admin" ? null : visibility.visibleOwnerUsernames,
    actor: url.searchParams.get("actor") ?? undefined,
    target: url.searchParams.get("target") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    status: auditStatusParam(url.searchParams.get("status")),
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
    pageSize: intParam(url.searchParams.get("pageSize"), 50, 1, 200),
  }));
}
