type JsonRecord = Record<string, unknown>;

type FsModule = typeof import("fs");

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExplicitModelList(provider: JsonRecord): boolean {
  return Array.isArray(provider.models) && provider.models.some((model) => isRecord(model) && typeof model.id === "string" && model.id.trim().length > 0);
}

interface StatReader {
  statSync(path: string): { mtimeMs: number };
}

// Change stamp for live sessions: their model registry is a snapshot, and this
// is the cheapest signal that models.json moved underneath them.
export function readModelsConfigMtimeMs(path: string, fs: StatReader): number {
  try {
    return fs.statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export interface DefaultModelSelection {
  provider: string | null;
  modelId: string | null;
}

// Renaming or deleting a provider in models.json leaves settings.json pointing at
// a model that no longer exists, which silently breaks new sessions. Report it so
// the caller can tell the operator instead of overwriting their choice.
export function findStaleDefaultModel(
  config: unknown,
  defaults: DefaultModelSelection
): { provider: string; modelId: string | null } | null {
  const { provider, modelId } = defaults;
  if (!provider) return null;

  const source = isRecord(config) ? config : {};
  const providers = isRecord(source.providers) ? source.providers : {};
  const entry = providers[provider];
  if (!isRecord(entry)) return { provider, modelId };
  if (!modelId) return null;

  const models = Array.isArray(entry.models) ? entry.models : [];
  const known = models.some((model) => isRecord(model) && model.id === modelId);
  return known ? null : { provider, modelId };
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
