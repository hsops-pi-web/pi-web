interface ModelSwitchSession {
  send(command: Record<string, unknown>): Promise<unknown>;
}

interface ModelRef {
  provider: string;
  modelId: string;
}

type RememberModel = (
  username: string,
  provider: string,
  modelId: string
) => void;

interface RefreshableModelRegistry<TModel> {
  find(provider: string, modelId: string): TModel | undefined;
  refresh(): void;
}

// A session's model registry is a snapshot taken when the session was created;
// models.json edits made afterwards are invisible to it.
//
// Two failure shapes, both handled here:
//   - a provider was added or renamed  -> find() misses, so refresh and retry
//   - an existing provider was edited  -> find() HITS and returns the stale
//     object (old baseUrl/apiKey/limits), so the caller passes configChanged
//     to force the registry forward before looking anything up.
export function resolveModelWithRefresh<TModel>(
  registry: RefreshableModelRegistry<TModel>,
  provider: string,
  modelId: string,
  configChanged = false
): TModel {
  if (!configChanged) {
    const cached = registry.find(provider, modelId);
    if (cached) return cached;
  }

  registry.refresh();
  const refreshed = registry.find(provider, modelId);
  if (!refreshed) throw new Error(`Model not found: ${provider}/${modelId}`);
  return refreshed;
}

export async function switchModelAndRemember(
  session: ModelSwitchSession,
  username: string,
  provider: string,
  modelId: string,
  remember: RememberModel
): Promise<unknown> {
  const result = await session.send({ type: "set_model", provider, modelId });
  remember(username, provider, modelId);
  return result;
}

export async function applyNewSessionModel(
  session: ModelSwitchSession,
  username: string,
  requestedModel: ModelRef | null,
  userPreference: ModelRef | null,
  rememberRequestedModel: boolean,
  remember: RememberModel
): Promise<unknown> {
  const model = requestedModel ?? userPreference;
  if (!model) return undefined;

  if (requestedModel && rememberRequestedModel) {
    return switchModelAndRemember(
      session,
      username,
      model.provider,
      model.modelId,
      remember
    );
  }

  return session.send({
    type: "set_model",
    provider: model.provider,
    modelId: model.modelId,
  });
}
