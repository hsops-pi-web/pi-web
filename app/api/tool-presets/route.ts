import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createUserToolPreset, listToolPresetsResponse } from "@/lib/auth/tool-presets";
import { BUILTIN_TOOL_NAMES, normalizeToolPresetInput } from "@/lib/tool-presets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(listToolPresetsResponse(username));
}

export async function POST(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const body = await req.json() as { name?: unknown; description?: unknown; toolNames?: unknown };
    const input = normalizeToolPresetInput(body, BUILTIN_TOOL_NAMES);
    return NextResponse.json({ preset: createUserToolPreset(username, input) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
