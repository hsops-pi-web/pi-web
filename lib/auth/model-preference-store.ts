import type Database from "better-sqlite3";

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface AvailableModelRef {
  provider: string;
  id: string;
}

export interface ModelPreferenceStore {
  get(username: string): ModelRef | null;
  set(username: string, provider: string, modelId: string): void;
  delete(username: string): void;
}

export function createModelPreferenceStore(db: Database.Database): ModelPreferenceStore {
  const getStatement = db.prepare(
    "SELECT provider, model_id FROM user_model_preferences WHERE username=?"
  );
  const setStatement = db.prepare(`
    INSERT INTO user_model_preferences(username,provider,model_id,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(username) DO UPDATE SET
      provider=excluded.provider,
      model_id=excluded.model_id,
      updated_at=excluded.updated_at
  `);
  const deleteStatement = db.prepare(
    "DELETE FROM user_model_preferences WHERE username=?"
  );

  return {
    get(username) {
      const row = getStatement.get(username) as
        | { provider: string; model_id: string }
        | undefined;
      return row ? { provider: row.provider, modelId: row.model_id } : null;
    },
    set(username, provider, modelId) {
      setStatement.run(username, provider, modelId, new Date().toISOString());
    },
    delete(username) {
      deleteStatement.run(username);
    },
  };
}

export function resolveEffectiveDefault(
  available: readonly AvailableModelRef[],
  userPreference: ModelRef | null,
  globalDefault: ModelRef | null
): ModelRef | null {
  const isAvailable = (ref: ModelRef | null): ref is ModelRef =>
    ref !== null && available.some(
      (model) => model.provider === ref.provider && model.id === ref.modelId
    );

  if (isAvailable(userPreference)) return userPreference;
  if (isAvailable(globalDefault)) return globalDefault;

  const first = available[0];
  return first ? { provider: first.provider, modelId: first.id } : null;
}
