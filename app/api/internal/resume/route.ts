import { NextResponse } from "next/server";
import { getProcessLifecycle } from "@/lib/process-lifecycle";
import { isAuthorizedReleaseRequest } from "@/lib/release-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedReleaseRequest(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const lifecycle = getProcessLifecycle();
  if (!lifecycle.resume()) {
    return NextResponse.json({ error: "drain 尚未完成" }, { status: 409 });
  }
  return NextResponse.json({ state: "running" });
}
