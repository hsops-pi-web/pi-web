import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import {
  getUserRoot, isInsideUserRoot, resolveExistingAndCheck, resolveParentAndCheck,
} from "../../../lib/auth/paths.ts";

test("getUserRoot builds home/pi-users/<name>", () => {
  assert.equal(getUserRoot("alice"), path.join(os.homedir(), "pi-users", "alice"));
});

test("isInsideUserRoot: inside", () => {
  const root = getUserRoot("alice");
  assert.equal(isInsideUserRoot(root, "alice"), true);
  assert.equal(isInsideUserRoot(path.join(root, "a/b.txt"), "alice"), true);
});

test("isInsideUserRoot: outside", () => {
  assert.equal(isInsideUserRoot("/etc/passwd", "alice"), false);
  assert.equal(isInsideUserRoot(getUserRoot("bob"), "alice"), false);
  // 前缀相似但非子路径
  assert.equal(isInsideUserRoot(getUserRoot("alice") + "-x", "alice"), false);
});

test("resolveExistingAndCheck follows symlink to real location", () => {
  // 用真实用户根做隔离测试：在 <root>/u 下建普通文件与逃逸 symlink
  const user = "auttest";
  const root = getUserRoot(user);
  mkdirSync(root, { recursive: true });
  const outside = mkdtempSync(path.join(os.tmpdir(), "outside-"));
  try {
    const good = path.join(root, "good.txt");
    writeFileSync(good, "x");
    assert.equal(resolveExistingAndCheck(good, user), true);

    const outsideFile = path.join(outside, "secret.txt");
    writeFileSync(outsideFile, "s");
    const escape = path.join(root, "escape");
    symlinkSync(outsideFile, escape);
    // 跟随 symlink 后落在用户根外 → false
    assert.equal(resolveExistingAndCheck(escape, user), false);
    // 不存在的路径 → fail-closed false
    assert.equal(resolveExistingAndCheck(path.join(root, "nope"), user), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("resolveParentAndCheck checks parent, not symlink target", () => {
  const user = "auttest2";
  const root = getUserRoot(user);
  mkdirSync(root, { recursive: true });
  try {
    // 待删 symlink：父目录在根内 → true（删除时只删链接本身，不跟随）
    const link = path.join(root, "link");
    symlinkSync("/etc/hosts", link);
    assert.equal(resolveParentAndCheck(link, user), true);
    // 父目录在根外 → false
    assert.equal(resolveParentAndCheck("/etc/newfile", user), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
