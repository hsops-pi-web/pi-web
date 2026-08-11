import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("next config raises the middleware body clone limit for large agent prompts", () => {
  const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /proxyClientMaxBodySize:\s*["']50mb["']/);
});
