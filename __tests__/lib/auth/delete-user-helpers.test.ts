import { test } from "node:test";
import assert from "node:assert/strict";
import { filterJsonlUnderRoot } from "../../../lib/auth/delete-user-helpers.ts";

const root = "/home/tester/pi-users/alice";

test("保留 cwd 在 root 内的 jsonl", () => {
  const pairs = [
    { file: "/a/1.jsonl", cwd: "/home/tester/pi-users/alice" },
    { file: "/a/2.jsonl", cwd: "/home/tester/pi-users/alice/proj" },
    { file: "/a/3.jsonl", cwd: "/home/tester/pi-users/bob" },
    { file: "/a/4.jsonl", cwd: "/home/tester/pi-users/alice2" },
  ];

  assert.deepEqual(filterJsonlUnderRoot(pairs, root), ["/a/1.jsonl", "/a/2.jsonl"]);
});

test("空 cwd 或空列表", () => {
  assert.deepEqual(filterJsonlUnderRoot([], root), []);
  assert.deepEqual(filterJsonlUnderRoot([{ file: "/a/x.jsonl", cwd: "" }], root), []);
});
