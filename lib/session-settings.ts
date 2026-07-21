import { SettingsManager } from "@earendil-works/pi-coding-agent";

type SettingsScope = "global" | "project";
type SettingsUpdater = (current: string | undefined) => string | undefined;

class SessionMemorySettingsStorage {
  private values: Record<SettingsScope, string | undefined>;

  constructor(globalSettings: object, projectSettings: object) {
    this.values = {
      global: JSON.stringify(globalSettings, null, 2),
      project: JSON.stringify(projectSettings, null, 2),
    };
  }

  withLock(scope: SettingsScope, update: SettingsUpdater): void {
    const next = update(this.values[scope]);
    if (next !== undefined) this.values[scope] = next;
  }
}

export function createSessionSettingsManager(
  cwd: string,
  agentDir: string
): SettingsManager {
  const persisted = SettingsManager.create(cwd, agentDir);
  return SettingsManager.fromStorage(new SessionMemorySettingsStorage(
    persisted.getGlobalSettings(),
    persisted.getProjectSettings()
  ));
}
