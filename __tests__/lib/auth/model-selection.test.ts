import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyNewSessionModel,
  switchModelAndRemember,
} from "../../../lib/model-selection.ts";

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
