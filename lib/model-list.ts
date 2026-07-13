export interface ModelListEntry {
  provider: string;
  id: string;
  name: string;
}

export interface DefaultModelRef {
  provider: string;
  modelId: string;
}

function modelKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getConfiguredModelKeys(config: unknown): string[] {
  if (!isRecord(config) || !isRecord(config.providers)) return [];

  const keys: string[] = [];
  for (const [provider, providerConfig] of Object.entries(config.providers)) {
    if (!isRecord(providerConfig) || !Array.isArray(providerConfig.models)) continue;
    for (const model of providerConfig.models) {
      if (!isRecord(model) || typeof model.id !== "string" || !model.id) continue;
      keys.push(modelKey(provider, model.id));
    }
  }
  return keys;
}

export function orderAvailableModels<T extends ModelListEntry>(
  available: readonly T[],
  defaultModel: DefaultModelRef | null,
  configuredModelKeys: readonly string[]
): T[] {
  const byKey = new Map(
    available.map((model) => [modelKey(model.provider, model.id), model])
  );
  const added = new Set<string>();
  const ordered: T[] = [];

  const add = (key: string) => {
    if (added.has(key)) return;
    const model = byKey.get(key);
    if (!model) return;
    added.add(key);
    ordered.push(model);
  };

  if (defaultModel) add(modelKey(defaultModel.provider, defaultModel.modelId));
  configuredModelKeys.forEach(add);
  available.forEach((model) => add(modelKey(model.provider, model.id)));

  return ordered;
}
