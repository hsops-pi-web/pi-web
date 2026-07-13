import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAdmin, isSuperAdmin, canManage, canChangeRole, isValidRole, SUPER_ADMIN,
} from "../../../lib/auth/roles.ts";

test("SUPER_ADMIN constant", () => {
  assert.equal(SUPER_ADMIN, "hsops");
});

test("isAdmin", () => {
  assert.equal(isAdmin("user"), false);
  assert.equal(isAdmin("admin"), true);
  assert.equal(isAdmin("super_admin"), true);
});

test("isSuperAdmin", () => {
  assert.equal(isSuperAdmin("user"), false);
  assert.equal(isSuperAdmin("admin"), false);
  assert.equal(isSuperAdmin("super_admin"), true);
});

test("canManage covers all role combinations", () => {
  assert.equal(canManage("user", "user"), false);
  assert.equal(canManage("user", "admin"), false);
  assert.equal(canManage("user", "super_admin"), false);
  assert.equal(canManage("admin", "user"), true);
  assert.equal(canManage("admin", "admin"), false);
  assert.equal(canManage("admin", "super_admin"), false);
  assert.equal(canManage("super_admin", "user"), true);
  assert.equal(canManage("super_admin", "admin"), true);
  assert.equal(canManage("super_admin", "super_admin"), false);
});

test("canChangeRole only permits super_admin", () => {
  assert.equal(canChangeRole("user"), false);
  assert.equal(canChangeRole("admin"), false);
  assert.equal(canChangeRole("super_admin"), true);
});

test("isValidRole", () => {
  assert.equal(isValidRole("user"), true);
  assert.equal(isValidRole("admin"), true);
  assert.equal(isValidRole("super_admin"), true);
  assert.equal(isValidRole("root"), false);
  assert.equal(isValidRole(""), false);
  assert.equal(isValidRole(null), false);
});
