import { NextResponse } from "next/server";
import {
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeModelsConfigFile } from "@/lib/models-config";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await req.json() as { provider?: unknown; modelId?: unknown };
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!provider || !modelId) {
      return NextResponse.json(
        { error: "provider and modelId are required" },
        { status: 400 }
      );
    }

    const agentDir = getAgentDir();
    normalizeModelsConfigFile(join(agentDir, "models.json"), { existsSync, readFileSync, writeFileSync });
    const registry = ModelRegistry.create(AuthStorage.create());
    const model = registry.find(provider, modelId);
    if (!model || !registry.hasConfiguredAuth(model)) {
      return NextResponse.json(
        { error: "模型不存在或未配置鉴权" },
        { status: 400 }
      );
    }

    const settings = SettingsManager.create(process.cwd(), agentDir);
    settings.setDefaultModelAndProvider(provider, modelId);
    await settings.flush();

    return NextResponse.json({
      globalDefaultModel: { provider, modelId },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
