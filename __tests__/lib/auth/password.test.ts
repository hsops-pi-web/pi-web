import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../../../lib/auth/password.ts";

test("hash then verify roundtrip", () => {
  const stored = hashPassword("Passw0rd");
  assert.match(stored, /^[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(verifyPassword("Passw0rd", stored), true);
  assert.equal(verifyPassword("wrongPass1", stored), false);
});

test("different salts produce different hashes", () => {
  assert.notEqual(hashPassword("Passw0rd"), hashPassword("Passw0rd"));
});

test("malformed stored string returns false", () => {
  assert.equal(verifyPassword("Passw0rd", "garbage"), false);
});
