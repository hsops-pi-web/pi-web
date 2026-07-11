import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth/db";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const users = getDb()
    .prepare(
      "SELECT username, role, disabled, created_at FROM users ORDER BY created_at ASC"
    )
    .all();
  return NextResponse.json({ users });
}
