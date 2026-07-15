import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRetryMissingFile } from "../../../lib/session-index/retry.ts";

test("retries only missing session files while attempts remain", () => {
  assert.equal(shouldRetryMissingFile(Object.assign(new Error("missing"), { code: "ENOENT" }), 1), true);
  assert.equal(shouldRetryMissingFile(Object.assign(new Error("missing"), { code: "ENOENT" }), 0), false);
  assert.equal(shouldRetryMissingFile(Object.assign(new Error("bad json"), { code: "EINVAL" }), 1), false);
});
