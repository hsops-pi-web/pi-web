import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyNewSessionModel,
  resolveModelWithRefresh,
  switchModelAndRemember,
} from "../../../lib/model-selection.ts";

function createRegistry(modelsByGeneration: string[][]) {
  let generation = 0;
  return {
    refreshCount: 0,
    find(provider: string, modelId: string) {
      const key = `${provider}/${modelId}`;
      return modelsByGeneration[generation].includes(key)
        ? { provider, id: modelId }
        : undefined;
    },
    refresh() {
      this.refreshCount += 1;
      generation = Math.min(generation + 1, modelsByGeneration.length - 1);
    },
  };
}

test("remembers only after the session model switch succeeds", async () => {
  const calls: string[] = [];
  const session = {
    send: async () => {
      calls.push("switch");
      return { id: "qwen3.6" };
    },
  };

  const result = await switchModelAndRemember(
    session,
    "alice",
    "qwen",
    "qwen3.6",
    () => calls.push("remember")
  );

  assert.deepEqual(result, { id: "qwen3.6" });
  assert.deepEqual(calls, ["switch", "remember"]);
});

test("does not remember when the session model switch fails", async () => {
  let remembered = false;
  const session = {
    send: async () => {
      throw new Error("model unavailable");
    },
  };

  await assert.rejects(
    switchModelAndRemember(
      session,
      "alice",
      "gone",
      "gone",
      () => { remembered = true; }
    ),
    /model unavailable/
  );
  assert.equal(remembered, false);
});

test("new session applies a user preference without saving it again", async () => {
  const calls: string[] = [];
  const session = {
    send: async (command: Record<string, unknown>) => {
      calls.push(`switch:${command.provider}/${command.modelId}`);
      return { id: command.modelId };
    },
  };

  await applyNewSessionModel(
    session,
    "alice",
    null,
    { provider: "qwen", modelId: "qwen3.6" },
    false,
    () => calls.push("remember")
  );

  assert.deepEqual(calls, ["switch:qwen/qwen3.6"]);
});

test("new session remembers a model explicitly selected by the user", async () => {
  const calls: string[] = [];
  const session = {
    send: async (command: Record<string, unknown>) => {
      calls.push(`switch:${command.provider}/${command.modelId}`);
      return { id: command.modelId };
    },
  };

  await applyNewSessionModel(
    session,
    "alice",
    { provider: "opus", modelId: "claude-opus" },
    { provider: "qwen", modelId: "qwen3.6" },
    true,
    () => calls.push("remember")
  );

  assert.deepEqual(calls, ["switch:opus/claude-opus", "remember"]);
});

// Editing an existing provider keeps the model id, so find() happily returns the
// stale object. Only a config-change signal can force the registry forward.
function createVersionedRegistry() {
  let generation = 0;
  return {
    refreshCount: 0,
    find(provider: string, modelId: string) {
      if (provider !== "glm-5.2" || modelId !== "glm-5.2") return undefined;
      return { provider, id: modelId, baseUrl: generation === 0 ? "http://old" : "http://new" };
    },
    refresh() {
      this.refreshCount += 1;
      generation = 1;
    },
  };
}

test("a changed config refreshes even when the cached model id still matches", () => {
  const registry = createVersionedRegistry();

  const model = resolveModelWithRefresh(registry, "glm-5.2", "glm-5.2", true);

  assert.equal(model.baseUrl, "http://new");
  assert.equal(registry.refreshCount, 1);
});

test("an unchanged config keeps serving the cached model object", () => {
  const registry = createVersionedRegistry();

  const model = resolveModelWithRefresh(registry, "glm-5.2", "glm-5.2", false);

  assert.equal(model.baseUrl, "http://old");
  assert.equal(registry.refreshCount, 0);
});

test("a changed config refreshes at most once before giving up", () => {
  const registry = createVersionedRegistry();

  assert.throws(
    () => resolveModelWithRefresh(registry, "ghost", "ghost-1", true),
    /Model not found: ghost\/ghost-1/
  );
  assert.equal(registry.refreshCount, 1);
});

test("resolves a model already present in the registry without refreshing", () => {
  const registry = createRegistry([["glm-5.2/glm-5.2"]]);

  const model = resolveModelWithRefresh(registry, "glm-5.2", "glm-5.2");

  assert.deepEqual(model, { provider: "glm-5.2", id: "glm-5.2" });
  assert.equal(registry.refreshCount, 0);
});

test("refreshes a stale registry so newly configured models become selectable", () => {
  const registry = createRegistry([
    ["opus-4.8-tsingmao/claude-opus-4.8"],
    ["opus-5-tsingmao/claude-opus-5"],
  ]);

  const model = resolveModelWithRefresh(registry, "opus-5-tsingmao", "claude-opus-5");

  assert.deepEqual(model, { provider: "opus-5-tsingmao", id: "claude-opus-5" });
  assert.equal(registry.refreshCount, 1);
});

test("throws after a refresh still cannot find the model", () => {
  const registry = createRegistry([["glm-5.2/glm-5.2"]]);

  assert.throws(
    () => resolveModelWithRefresh(registry, "ghost", "ghost-1"),
    /Model not found: ghost\/ghost-1/
  );
  assert.equal(registry.refreshCount, 1);
});
