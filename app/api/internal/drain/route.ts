import { NextResponse } from "next/server";
import { getProcessLifecycle } from "@/lib/process-lifecycle";
import { isAuthorizedReleaseRequest } from "@/lib/release-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedReleaseRequest(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const result = await getProcessLifecycle().drain();
  return NextResponse.json(result, { status: result.errors.length === 0 ? 200 : 500 });
}
