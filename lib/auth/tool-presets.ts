import { BUILTIN_TOOL_PRESETS, isBuiltinToolPresetId, type NormalizedToolPresetInput } from "../tool-presets";
import { getDb } from "./db";
import { createToolPresetStore } from "./tool-preset-store";

export function getUserToolPresets(username: string) {
  return createToolPresetStore(getDb()).list(username);
}

export function getUserToolPreset(username: string, id: string) {
  return createToolPresetStore(getDb()).get(username, id);
}

export function createUserToolPreset(username: string, input: NormalizedToolPresetInput) {
  return createToolPresetStore(getDb()).create(username, input);
}

export function updateUserToolPreset(username: string, id: string, input: NormalizedToolPresetInput) {
  return createToolPresetStore(getDb()).update(username, id, input);
}

export function deleteUserToolPreset(username: string, id: string) {
  return createToolPresetStore(getDb()).delete(username, id);
}

export function getUserToolPresetDefault(username: string) {
  return createToolPresetStore(getDb()).getDefault(username);
}

export function setUserToolPresetDefault(username: string, presetId: string) {
  createToolPresetStore(getDb()).setDefault(username, presetId);
}

export function userOwnsToolPresetOrBuiltin(username: string, presetId: string): boolean {
  if (isBuiltinToolPresetId(presetId)) return true;
  return getUserToolPreset(username, presetId) !== null;
}

export function listToolPresetsResponse(username: string) {
  const { custom, defaultPresetId } = getUserToolPresets(username);
  return { builtins: BUILTIN_TOOL_PRESETS, custom, defaultPresetId };
}
