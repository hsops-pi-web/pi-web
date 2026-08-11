import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findStaleDefaultModel,
  normalizeModelsConfig,
  readModelsConfigMtimeMs,
} from "../../../lib/models-config.ts";

const config = {
  providers: {
    "opus-5-tsingmao": { models: [{ id: "claude-opus-5" }] },
    "glm-5.2": { models: [{ id: "glm-5.2" }] },
  },
};

test("provider-only custom config gets an implicit same-name model", () => {
  const { config, changed } = normalizeModelsConfig({
    providers: {
      "glm-5.2": {
        api: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKey: "secret",
      },
    },
  });

  assert.equal(changed, true);
  assert.deepEqual(config, {
    providers: {
      "glm-5.2": {
        api: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiKey: "secret",
        models: [{ id: "glm-5.2" }],
      },
    },
  });
});

test("existing model lists are preserved", () => {
  const original = {
    providers: {
      glm: {
        api: "anthropic-messages",
        models: [{ id: "glm-5.2", name: "GLM 5.2" }],
      },
    },
  };
  const { config, changed } = normalizeModelsConfig(original);

  assert.equal(changed, false);
  assert.deepEqual(config, original);
});

test("a default model still present in the config is not stale", () => {
  const stale = findStaleDefaultModel(config, {
    provider: "opus-5-tsingmao",
    modelId: "claude-opus-5",
  });

  assert.equal(stale, null);
});

test("a default provider removed from the config is reported as stale", () => {
  const stale = findStaleDefaultModel(config, {
    provider: "gpt-5.5-tsingmao",
    modelId: "openai/gpt-5.5",
  });

  assert.deepEqual(stale, { provider: "gpt-5.5-tsingmao", modelId: "openai/gpt-5.5" });
});

test("a default model missing from a surviving provider is reported as stale", () => {
  const stale = findStaleDefaultModel(config, {
    provider: "glm-5.2",
    modelId: "glm-5.1",
  });

  assert.deepEqual(stale, { provider: "glm-5.2", modelId: "glm-5.1" });
});

test("reports the models.json modification time", () => {
  const mtime = readModelsConfigMtimeMs("/agent/models.json", {
    statSync: () => ({ mtimeMs: 1754880263304 }),
  });

  assert.equal(mtime, 1754880263304);
});

test("a missing models.json reports mtime 0 instead of throwing", () => {
  const mtime = readModelsConfigMtimeMs("/agent/models.json", {
    statSync: () => { throw new Error("ENOENT"); },
  });

  assert.equal(mtime, 0);
});

test("no configured default is not stale", () => {
  assert.equal(findStaleDefaultModel(config, { provider: null, modelId: null }), null);
});

test("a default provider without a pinned model is satisfied by the provider alone", () => {
  const stale = findStaleDefaultModel(config, { provider: "glm-5.2", modelId: null });

  assert.equal(stale, null);
});
