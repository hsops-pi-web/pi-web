import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeModelsConfig } from "../../../lib/models-config.ts";

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
