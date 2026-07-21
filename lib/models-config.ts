type JsonRecord = Record<string, unknown>;

type FsModule = typeof import("fs");

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExplicitModelList(provider: JsonRecord): boolean {
  return Array.isArray(provider.models) && provider.models.some((model) => isRecord(model) && typeof model.id === "string" && model.id.trim().length > 0);
}

export function normalizeModelsConfig(input: unknown): { config: JsonRecord; changed: boolean } {
  const source = isRecord(input) ? input : {};
  const sourceProviders = isRecord(source.providers) ? source.providers : {};
  const providers: JsonRecord = {};
  let changed = !isRecord(input) || !isRecord(source.providers);

  for (const [providerName, rawProvider] of Object.entries(sourceProviders)) {
    if (!isRecord(rawProvider)) {
      providers[providerName] = rawProvider;
      continue;
    }
    if (hasExplicitModelList(rawProvider)) {
      providers[providerName] = rawProvider;
      continue;
    }
    providers[providerName] = { ...rawProvider, models: [{ id: providerName }] };
    changed = true;
  }

  return { config: { ...source, providers }, changed };
}

export function normalizeModelsConfigFile(path: string, fs: Pick<FsModule, "existsSync" | "readFileSync" | "writeFileSync">): JsonRecord {
  if (!fs.existsSync(path)) return { providers: {} };
  const { config, changed } = normalizeModelsConfig(JSON.parse(fs.readFileSync(path, "utf8")));
  if (changed) fs.writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  return config;
}
