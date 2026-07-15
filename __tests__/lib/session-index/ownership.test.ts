import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { computeSessionOwner } from "../../../lib/session-index/ownership.ts";
import { getUserRoot } from "../../../lib/auth/paths.ts";

let home = "";
let originalHome: string | undefined;

before(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "pi-session-owner-"));
  process.env.HOME = home;
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

test("computes owner from cwd under exactly one user root", () => {
  const aliceRoot = getUserRoot("alice-owner");
  const bobRoot = getUserRoot("bob-owner");
  mkdirSync(path.join(aliceRoot, "proj"), { recursive: true });
  mkdirSync(bobRoot, { recursive: true });

  assert.equal(computeSessionOwner(path.join(aliceRoot, "proj"), ["alice-owner", "bob-owner"]), "alice-owner");
});

test("returns null for empty or unowned cwd", () => {
  assert.equal(computeSessionOwner("", ["alice-owner"]), null);
  assert.equal(computeSessionOwner("/tmp/outside", ["alice-owner"]), null);
});
