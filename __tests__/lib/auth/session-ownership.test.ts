import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { mkdirSync, rmSync, symlinkSync, chmodSync } from "fs";
import { resolveSessionOwnership } from "../../../lib/auth/paths.ts";

const root = path.join(os.homedir(), "pi-users", "owntest");

test("existing cwd inside user root", () => {
  mkdirSync(path.join(root, "proj"), { recursive: true });
  try {
    assert.equal(resolveSessionOwnership(path.join(root, "proj"), "owntest"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleted cwd inside user root remains owned", () => {
  mkdirSync(root, { recursive: true });
  try {
    assert.equal(resolveSessionOwnership(path.join(root, "deleted-proj"), "owntest"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleted cwd outside user root is rejected", () => {
  assert.equal(resolveSessionOwnership("/home/other/pi-users/x/proj", "owntest"), false);
});

test("similar path prefix is rejected", () => {
  const sibling = path.join(os.homedir(), "pi-users", "owntest2", "p");
  assert.equal(resolveSessionOwnership(sibling, "owntest"), false);
});

test("missing child under external symlink is rejected", () => {
  mkdirSync(root, { recursive: true });
  symlinkSync("/etc", path.join(root, "escape"));
  try {
    assert.equal(resolveSessionOwnership(path.join(root, "escape", "not-exist"), "owntest"), false);
    assert.equal(resolveSessionOwnership(path.join(root, "escape"), "owntest"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("broken symlink is rejected fail-closed", () => {
  mkdirSync(root, { recursive: true });
  symlinkSync(path.join(root, "nowhere-target"), path.join(root, "broken"));
  try {
    assert.equal(resolveSessionOwnership(path.join(root, "broken", "x"), "owntest"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlink loop is rejected fail-closed", () => {
  mkdirSync(root, { recursive: true });
  symlinkSync(path.join(root, "b"), path.join(root, "a"));
  symlinkSync(path.join(root, "a"), path.join(root, "b"));
  try {
    assert.equal(resolveSessionOwnership(path.join(root, "a", "x"), "owntest"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inaccessible ancestor is rejected fail-closed", () => {
  const secret = path.join(root, "secret");
  mkdirSync(secret, { recursive: true });
  try {
    chmodSync(secret, 0o000);
    const result = resolveSessionOwnership(path.join(secret, "x"), "owntest");
    assert.ok(result === false || process.getuid?.() === 0);
  } finally {
    try { chmodSync(secret, 0o700); } catch { /* already removed */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty cwd is rejected", () => {
  assert.equal(resolveSessionOwnership("", "owntest"), false);
});
