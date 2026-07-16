import type Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { intParam } from "@/lib/api-params";
import { getSessionIndexDbPath } from "@/lib/auth/data-dir";
import { getDb } from "@/lib/auth/db";
import { createAdminVisibility } from "@/lib/auth/admin-visibility";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminSessionIndexStore } from "@/lib/session-index/admin-store";
import { createSessionIndexDb, migrateSessionIndexDb } from "@/lib/session-index/db";
import { scanSessionFiles } from "@/lib/session-index/scanner";
import { getSessionsDir } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

function computeStaleCandidateCount(db: Database.Database): number {
  const files = scanSessionFiles(getSessionsDir());
  const rows = db.prepare("SELECT path, source_mtime_ms FROM sessions WHERE missing=0").all() as Array<{ path: string; source_mtime_ms: number }>;
  const indexed = new Map(rows.map((row) => [row.path, row.source_mtime_ms]));
  return files.filter((file) => indexed.get(file.path) !== file.mtimeMs).length;
}

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const db = createSessionIndexDb(getSessionIndexDbPath());
  migrateSessionIndexDb(db);
  try {
    const result = createAdminSessionIndexStore(db).getAdminIndexHealth(createAdminVisibility(getDb(), guard), {
      page: intParam(url.searchParams.get("page"), 1, 1, 10_000),
      pageSize: intParam(url.searchParams.get("pageSize"), 50, 1, 200),
      staleCandidateCount: computeStaleCandidateCount(db),
    });
    return NextResponse.json(result);
  } finally {
    db.close();
  }
}
