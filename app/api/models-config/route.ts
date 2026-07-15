import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeModelsConfig, normalizeModelsConfigFile } from "@/lib/models-config";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return normalizeModelsConfigFile(path, { existsSync, readFileSync, writeFileSync });
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await req.json() as Record<string, unknown>;
    const { config } = normalizeModelsConfig(body);
    writeModelsJson(config);
    // Model registry refreshes on each /api/models request (no local cache to invalidate)
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
