import { NextResponse } from "next/server";
import { runtimeIdentity } from "@/lib/release-metadata";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ status: "live", ...runtimeIdentity() });
}
