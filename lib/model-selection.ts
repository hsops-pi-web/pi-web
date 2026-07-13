interface ModelSwitchSession {
  send(command: Record<string, unknown>): Promise<unknown>;
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
