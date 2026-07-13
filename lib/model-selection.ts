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
