import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export async function GET(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });

    const result = getSessionIndexStore().searchSessions({
      username,
      q,
      cwd: url.searchParams.get("cwd") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
      pageSize: intParam(url.searchParams.get("pageSize"), 20, 1, 100),
    });

    return NextResponse.json({
      results: result.results,
      indexStatus: "ready",
      pagination: { total: result.total, page: result.page, pageSize: result.pageSize },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
