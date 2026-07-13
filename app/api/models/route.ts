import { AuthStorage, ModelRegistry, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  getConfiguredModelKeys,
  orderAvailableModels,
  type ModelListEntry,
} from "@/lib/model-list";
import {
  getUserModelPreference,
  resolveEffectiveDefault,
  type ModelRef,
} from "@/lib/auth/model-preferences";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  let globalDefaultModel: ModelRef | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  try {
    const agentDir = getAgentDir();
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const available = registry.getAvailable();
    const availableModels: ModelListEntry[] = available.map((m: { id: string; name: string; provider: string }) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    }));
    for (const m of available) {
      const key = `${m.provider}:${m.id}`;
      nameMap.set(key, m.name);
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    }

    const settings = SettingsManager.create(process.cwd(), agentDir);
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider) {
      const providerFallback = availableModels.find((model) => model.provider === provider);
      globalDefaultModel = { provider, modelId: modelId ?? providerFallback?.id ?? "" };
    }
    defaultModel = resolveEffectiveDefault(
      availableModels,
      getUserModelPreference(username),
      globalDefaultModel
    );

    let configuredModelKeys: string[] = [];
    try {
      const modelsConfig = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8"));
      configuredModelKeys = getConfiguredModelKeys(modelsConfig);
    } catch {
      // Missing or invalid models.json leaves the registry order unchanged.
    }
    modelList = orderAvailableModels(availableModels, defaultModel, configuredModelKeys);
  } catch { /* return empty */ }

  return Response.json({
    models: Object.fromEntries(nameMap),
    modelList,
    defaultModel,
    globalDefaultModel,
    thinkingLevels,
    thinkingLevelMaps,
  });
}
