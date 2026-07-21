import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";

const OPERATIONS = ["archive", "unarchive", "favorite", "unfavorite", "add_tag", "remove_tag"] as const;
type BulkOperationName = (typeof OPERATIONS)[number];

type BulkBody = {
  sessionIds?: string[];
  operation?: BulkOperationName;
  tagId?: number;
};

function isOperation(value: unknown): value is BulkOperationName {
  return typeof value === "string" && OPERATIONS.includes(value as BulkOperationName);
}

export async function POST(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await req.json() as BulkBody;
    if (!Array.isArray(body.sessionIds) || body.sessionIds.length === 0 || body.sessionIds.some((id) => typeof id !== "string" || !id)) {
      return NextResponse.json({ error: "sessionIds must be a non-empty string array" }, { status: 400 });
    }
    if (!isOperation(body.operation)) return NextResponse.json({ error: "invalid operation" }, { status: 400 });
    if ((body.operation === "add_tag" || body.operation === "remove_tag") && typeof body.tagId !== "number") {
      return NextResponse.json({ error: "tagId is required for tag operations" }, { status: 400 });
    }

    const result = getSessionIndexStore().bulkUpdate(username, body.sessionIds, { operation: body.operation, tagId: body.tagId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
