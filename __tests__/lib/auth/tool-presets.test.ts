import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_TOOL_PRESETS,
  normalizeToolPresetInput,
  resolveToolNamesForPreset,
  resolveToolPresetDefault,
} from "../../../lib/tool-presets.ts";

test("built-in tool presets expose stable ids and tool names", () => {
  assert.deepEqual(BUILTIN_TOOL_PRESETS.map((preset) => preset.id), ["none", "default", "full"]);
  assert.deepEqual(BUILTIN_TOOL_PRESETS[0].toolNames, []);
  assert.deepEqual(BUILTIN_TOOL_PRESETS[1].toolNames, ["read", "bash", "edit", "write"]);
  assert.deepEqual(BUILTIN_TOOL_PRESETS[2].toolNames, ["bash", "read", "edit", "write", "grep", "find", "ls"]);
});

test("normalizeToolPresetInput trims, deduplicates, and rejects unknown tool names", () => {
  assert.deepEqual(
    normalizeToolPresetInput({ name: " Coding ", toolNames: ["read", "bash", "read"] }, ["read", "bash"]),
    { name: "Coding", description: null, toolNames: ["read", "bash"] }
  );
  assert.throws(
    () => normalizeToolPresetInput({ name: "Bad", toolNames: ["read", "unknown"] }, ["read"]),
    /Unknown tool name: unknown/
  );
});

test("resolveToolPresetDefault prefers user default then built-in default", () => {
  assert.equal(resolveToolPresetDefault("custom-1").id, "custom-1");
  assert.equal(resolveToolPresetDefault(null).id, "default");
});

test("resolveToolNamesForPreset resolves built-in and custom presets", () => {
  assert.deepEqual(resolveToolNamesForPreset("none", []), []);
  assert.deepEqual(
    resolveToolNamesForPreset("custom-1", [{ id: "custom-1", scope: "custom", name: "Read", description: null, toolNames: ["read"] }]),
    ["read"]
  );
  assert.equal(resolveToolNamesForPreset("missing", []), null);
});
