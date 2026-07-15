import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMessageText, truncateSearchText } from "../../../lib/session-index/text.ts";

test("extracts user string content", () => {
  assert.equal(extractMessageText({ role: "user", content: "hello world" }), "hello world");
});

test("extracts text blocks and ignores images", () => {
  assert.equal(
    extractMessageText({ role: "assistant", content: [{ type: "text", text: "alpha" }, { type: "image", source: { type: "url", url: "x" } }] }),
    "alpha",
  );
});

test("tool results are bounded", () => {
  const text = truncateSearchText("x".repeat(70_000));
  assert.equal(text.length, 20_000);
});
