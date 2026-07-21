import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { getPiWebAuthDataDir, getAuthDbPath, getSessionIndexDbPath } from "../../../lib/auth/data-dir.ts";

test("derives auth and session index database paths from the same data dir", () => {
  const dir = getPiWebAuthDataDir();

  assert.equal(dir, path.join(os.homedir(), ".pi-web-auth"));
  assert.equal(getAuthDbPath(), path.join(dir, "auth.db"));
  assert.equal(getSessionIndexDbPath(), path.join(dir, "session-index.db"));
});
