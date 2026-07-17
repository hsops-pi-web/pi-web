export type ToolPresetScope = "builtin" | "custom";

export interface ToolPresetDefinition {
  id: string;
  scope: ToolPresetScope;
  name: string;
  description: string | null;
  toolNames: string[];
  readonly?: boolean;
}

export interface NormalizedToolPresetInput {
  name: string;
  description: string | null;
  toolNames: string[];
}

export const BUILTIN_TOOL_PRESETS: ToolPresetDefinition[] = [
  {
    id: "none",
    scope: "builtin",
    name: "No tools",
    description: "Pure chat without tool access",
    toolNames: [],
    readonly: true,
  },
  {
    id: "default",
    scope: "builtin",
    name: "Default",
    description: "Read, bash, edit, write, and extensions",
    toolNames: ["read", "bash", "edit", "write"],
    readonly: true,
  },
  {
    id: "full",
    scope: "builtin",
    name: "Full",
    description: "All built-in tools and extensions",
    toolNames: ["bash", "read", "edit", "write", "grep", "find", "ls"],
    readonly: true,
  },
];

export const BUILTIN_TOOL_NAMES = Array.from(
  new Set(BUILTIN_TOOL_PRESETS.flatMap((preset) => preset.toolNames))
);

export function isBuiltinToolPresetId(id: string): boolean {
  return BUILTIN_TOOL_PRESETS.some((preset) => preset.id === id);
}

export function normalizeToolPresetInput(
  input: { name?: unknown; description?: unknown; toolNames?: unknown },
  availableToolNames: string[]
): NormalizedToolPresetInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Preset name is required");
  if (!Array.isArray(input.toolNames)) throw new Error("toolNames must be an array");

  const available = new Set(availableToolNames);
  const toolNames: string[] = [];
  for (const raw of input.toolNames) {
    if (typeof raw !== "string") throw new Error("toolNames must contain strings");
    const toolName = raw.trim();
    if (!toolName) continue;
    if (!available.has(toolName)) throw new Error(`Unknown tool name: ${toolName}`);
    if (!toolNames.includes(toolName)) toolNames.push(toolName);
  }

  const description = typeof input.description === "string" && input.description.trim()
    ? input.description.trim()
    : null;
  return { name, description, toolNames };
}

export function resolveToolPresetDefault(defaultPresetId: string | null): { id: string } {
  return { id: defaultPresetId || "default" };
}

export function resolveToolNamesForPreset(
  presetId: string,
  customPresets: ToolPresetDefinition[]
): string[] | null {
  const preset = BUILTIN_TOOL_PRESETS.find((item) => item.id === presetId)
    ?? customPresets.find((item) => item.id === presetId);
  return preset ? [...preset.toolNames] : null;
}
