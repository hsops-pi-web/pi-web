import { test } from "node:test";
import assert from "node:assert/strict";
import { switchModelAndRemember } from "../../../lib/model-selection.ts";

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
