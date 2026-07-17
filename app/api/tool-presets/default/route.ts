import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { setUserToolPresetDefault, userOwnsToolPresetOrBuiltin } from "@/lib/auth/tool-presets";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json() as { presetId?: unknown };
  const presetId = typeof body.presetId === "string" ? body.presetId.trim() : "";
  if (!presetId) return NextResponse.json({ error: "presetId is required" }, { status: 400 });
  if (!userOwnsToolPresetOrBuiltin(username, presetId)) {
    return NextResponse.json({ error: "Unknown preset" }, { status: 400 });
  }

  setUserToolPresetDefault(username, presetId);
  return NextResponse.json({ defaultPresetId: presetId });
}
