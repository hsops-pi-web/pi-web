import { test } from "node:test";
import assert from "node:assert/strict";
import { intParam } from "../../../../lib/api-params.ts";

test("intParam uses fallback for missing query parameters", () => {
  assert.equal(intParam(null, 100, 1, 200), 100);
});

test("intParam clamps present integer query parameters", () => {
  assert.equal(intParam("0", 100, 1, 200), 1);
  assert.equal(intParam("500", 100, 1, 200), 200);
});
