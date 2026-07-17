import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { deleteUserToolPreset, updateUserToolPreset } from "@/lib/auth/tool-presets";
import { BUILTIN_TOOL_NAMES, isBuiltinToolPresetId, normalizeToolPresetInput } from "@/lib/tool-presets";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, context: RouteContext) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  if (isBuiltinToolPresetId(id)) return NextResponse.json({ error: "Built-in presets are read-only" }, { status: 400 });

  try {
    const body = await req.json() as { name?: unknown; description?: unknown; toolNames?: unknown };
    const input = normalizeToolPresetInput(body, BUILTIN_TOOL_NAMES);
    const preset = updateUserToolPreset(username, id, input);
    if (!preset) return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    return NextResponse.json({ preset });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  if (isBuiltinToolPresetId(id)) return NextResponse.json({ error: "Built-in presets cannot be deleted" }, { status: 400 });

  const deleted = deleteUserToolPreset(username, id);
  if (!deleted) return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
