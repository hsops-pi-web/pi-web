import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getConfiguredModelKeys,
  orderAvailableModels,
} from "../../../lib/model-list.ts";
import { resolveEffectiveDefault } from "../../../lib/auth/model-preference-store.ts";

const models = [
  { provider: "openai", id: "gpt-4", name: "GPT-4" },
  { provider: "openai", id: "gpt-5.5", name: "GPT-5.5" },
  { provider: "custom-gpt", id: "openai/gpt-5.5", name: "openai/gpt-5.5" },
  { provider: "glm", id: "glm-5.2", name: "glm-5.2" },
  { provider: "qwen", id: "qwen3.6", name: "qwen3.6" },
];

test("default model is first, followed by explicitly configured models", () => {
  const ordered = orderAvailableModels(
    models,
    { provider: "glm", modelId: "glm-5.2" },
    ["custom-gpt:openai/gpt-5.5", "glm:glm-5.2", "qwen:qwen3.6"]
  );

  assert.deepEqual(
    ordered.map((model) => `${model.provider}:${model.id}`),
    [
      "glm:glm-5.2",
      "custom-gpt:openai/gpt-5.5",
      "qwen:qwen3.6",
      "openai:gpt-4",
      "openai:gpt-5.5",
    ]
  );
});

test("keeps registry order when no default or configured models match", () => {
  assert.deepEqual(orderAvailableModels(models, null, []), models);
});

test("extracts only explicit model definitions from models config", () => {
  assert.deepEqual(
    getConfiguredModelKeys({
      providers: {
        openai: { modelOverrides: { "gpt-4": { maxTokens: 10 } } },
        glm: { models: [{ id: "glm-5.2" }, {}, { id: 42 }] },
        qwen: { models: [{ id: "qwen3.6" }] },
      },
    }),
    ["glm:glm-5.2", "qwen:qwen3.6"]
  );
  assert.deepEqual(getConfiguredModelKeys(null), []);
});

test("invalid preference falls back to the available global default", () => {
  const effective = resolveEffectiveDefault(
    models,
    { provider: "removed", modelId: "removed" },
    { provider: "glm", modelId: "glm-5.2" }
  );

  assert.deepEqual(effective, { provider: "glm", modelId: "glm-5.2" });
  assert.equal(orderAvailableModels(models, effective, [])[0].id, "glm-5.2");
});
