import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidUsername, isValidPassword } from "../../../lib/auth/validate.ts";

test("username: valid", () => {
  for (const n of ["abc", "user1", "Alice", "a", "aZ9"]) {
    assert.equal(isValidUsername(n), true, n);
  }
});

test("username: invalid", () => {
  for (const n of ["1abc", "中文", "a_b", "a-b", "", "a b", "_x", "9"]) {
    assert.equal(isValidUsername(n), false, n);
  }
});

test("password: valid", () => {
  for (const p of ["abcABC12", "Passw0rd", "aaAA0000"]) {
    assert.equal(isValidPassword(p), true, p);
  }
});

test("password: invalid", () => {
  for (const p of ["short1A", "alllower1", "ALLUPPER1", "NoDigitsAA", "12345678", ""]) {
    assert.equal(isValidPassword(p), false, p);
  }
});
