import { AuthStorage, ModelRegistry, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  filterToConfiguredModels,
  getConfiguredModelKeys,
  orderAvailableModels,
  type ModelListEntry,
} from "@/lib/model-list";
import {
  getUserModelPreference,
  resolveEffectiveDefault,
  type ModelRef,
} from "@/lib/auth/model-preferences";
import { normalizeModelsConfigFile } from "@/lib/models-config";

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
    const modelsConfigPath = join(agentDir, "models.json");
    const modelsConfig = normalizeModelsConfigFile(modelsConfigPath, { existsSync, readFileSync, writeFileSync });
    const configuredModelKeys = getConfiguredModelKeys(modelsConfig);

    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const available = registry.getAvailable();

    // Thinking levels stay unfiltered: a session still running an unconfigured
    // model needs its levels to resolve.
    for (const m of available) {
      const key = `${m.provider}:${m.id}`;
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    }

    const visibleModels: ModelListEntry[] = filterToConfiguredModels(
      available.map((m: { id: string; name: string; provider: string }) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
      })),
      configuredModelKeys
    );
    for (const m of visibleModels) nameMap.set(`${m.provider}:${m.id}`, m.name);

    const settings = SettingsManager.create(process.cwd(), agentDir);
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider) {
      const providerFallback = visibleModels.find((model) => model.provider === provider);
      globalDefaultModel = { provider, modelId: modelId ?? providerFallback?.id ?? "" };
    }
    defaultModel = resolveEffectiveDefault(
      visibleModels,
      getUserModelPreference(username),
      globalDefaultModel
    );

    modelList = orderAvailableModels(visibleModels, defaultModel, configuredModelKeys);
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
