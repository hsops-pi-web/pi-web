import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { isUserRootItself, isPathInUse } from "../../../app/api/files/[...path]/delete-helpers.ts";

const root = path.join(os.homedir(), "pi-users", "alice");

test("isUserRootItself true only for the root", () => {
  assert.equal(isUserRootItself(root, "alice"), true);
  assert.equal(isUserRootItself(path.join(root, "a.txt"), "alice"), false);
});

test("isPathInUse detects in-use cwd and its subtree", () => {
  const cwds = [path.join(root, "proj")];
  assert.equal(isPathInUse(path.join(root, "proj"), cwds), true);          // 相等
  assert.equal(isPathInUse(path.join(root, "proj", "f.txt"), cwds), true); // 子路径
  assert.equal(isPathInUse(root, cwds), true);                             // 父目录含 cwd
  assert.equal(isPathInUse(path.join(root, "other"), cwds), false);        // 无关
});
