import { NextResponse } from "next/server";
import { enumParam, intParam } from "@/lib/api-params";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";
import type { ArchivedFilter, OrphanedFilter, SessionSort } from "@/lib/session-index/types";

export async function GET(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const url = new URL(req.url);
    const result = getSessionIndexStore().listSessions({
      username,
      q: url.searchParams.get("q") ?? undefined,
      cwd: url.searchParams.get("cwd") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      favorite: url.searchParams.has("favorite") ? url.searchParams.get("favorite") === "true" : undefined,
      archived: enumParam<ArchivedFilter>(url.searchParams.get("archived"), ["exclude", "include", "only"], "exclude"),
      orphaned: enumParam<OrphanedFilter>(url.searchParams.get("orphaned"), ["exclude", "include", "only"], "include"),
      sort: enumParam<SessionSort>(url.searchParams.get("sort"), ["modified_desc", "modified_asc", "created_desc", "title_asc"], "modified_desc"),
      page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
      pageSize: intParam(url.searchParams.get("pageSize"), 100, 1, 200),
    });
    return NextResponse.json({
      sessions: result.sessions.map((session) => ({
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.customTitle ?? session.title ?? undefined,
        created: session.createdAt,
        modified: session.modifiedAt,
        messageCount: session.messageCount,
        firstMessage: session.firstMessage ?? "(no messages)",
        parentSessionId: session.parentSessionId ?? undefined,
        favorite: session.favorite,
        archived: session.archived,
        customTitle: session.customTitle,
        orphaned: session.orphaned,
        missing: session.missing,
        indexError: session.indexError,
      })),
      indexStatus: "ready",
      pagination: { total: result.total, page: result.page, pageSize: result.pageSize },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
