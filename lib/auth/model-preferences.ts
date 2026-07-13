import { getDb } from "./db";
import {
  createModelPreferenceStore,
  resolveEffectiveDefault,
  type AvailableModelRef,
  type ModelRef,
} from "./model-preference-store";

export { resolveEffectiveDefault };
export type { AvailableModelRef, ModelRef };

function getStore() {
  return createModelPreferenceStore(getDb());
}

export function getUserModelPreference(username: string): ModelRef | null {
  return getStore().get(username);
}

export function setUserModelPreference(
  username: string,
  provider: string,
  modelId: string
): void {
  getStore().set(username, provider, modelId);
}

export function deleteUserModelPreference(username: string): void {
  getStore().delete(username);
}
