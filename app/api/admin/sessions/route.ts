import { NextResponse } from "next/server";
import { enumParam, intParam } from "@/lib/api-params";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getDb } from "@/lib/auth/db";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { requireAdmin } from "@/lib/auth/session";
import {
  createAdminSessionIndexStore,
  type AdminSessionSort,
  type AdminSessionStatus,
} from "@/lib/session-index/admin-store";
import { getSessionIndexDb } from "@/lib/session-index/db";

export const dynamic = "force-dynamic";

function statusParam(value: string | null): AdminSessionStatus | undefined {
  if (value === "normal" || value === "missing" || value === "orphaned" || value === "index_error" || value === "any_issue") return value;
  return undefined;
}

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const visibility = createAdminVisibility(getDb(), guard);
  const store = createAdminSessionIndexStore(getSessionIndexDb(getSessionIndexDbPath()));
  const page = intParam(url.searchParams.get("page"), 1, 1, 10_000);
  const pageSize = intParam(url.searchParams.get("pageSize"), 50, 1, 200);

  if (url.searchParams.get("mode") === "fts") {
    const q = url.searchParams.get("q");
    if (!q) return NextResponse.json({ error: "q is required for fts search" }, { status: 400 });
    return NextResponse.json(store.searchAdminSessions(visibility, {
      q,
      username: url.searchParams.get("username") ?? undefined,
      cwd: url.searchParams.get("cwd") ?? undefined,
      page,
      pageSize,
    }));
  }

  return NextResponse.json(store.listAdminSessions(visibility, {
    username: url.searchParams.get("username") ?? undefined,
    cwd: url.searchParams.get("cwd") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    status: statusParam(url.searchParams.get("status")),
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    sort: enumParam<AdminSessionSort>(url.searchParams.get("sort"), ["modified_desc", "modified_asc", "created_desc", "title_asc"], "modified_desc"),
    page,
    pageSize,
  }));
}
