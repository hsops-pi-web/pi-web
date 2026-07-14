import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  chmodSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-release-test-"));
  roots.push(root);
  return root;
}

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(script: string, env: Record<string, string> = {}) {
  return spawnSync("bash", [script], {
    cwd: resolve("."),
    env: { ...process.env, HOME: tempRoot(), NODE_ENV: "test", ...env },
    encoding: "utf8",
  });
}

test("release shell files pass bash syntax validation", () => {
  for (const script of [
    "scripts/lib/release-common.sh",
    "scripts/build-release.sh",
    "scripts/systemd-stop.sh",
  ]) {
    const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test("build-release refuses a dirty or non-main source before npm runs", () => {
  const root = tempRoot();
  const marker = join(root, "npm-called");
  const fakeNpm = join(root, "npm");
  executable(fakeNpm, `touch ${JSON.stringify(marker)}`);
  const result = run("scripts/build-release.sh", {
    PI_WEB_SOURCE_ROOT: resolve("."),
    PI_WEB_DEPLOY_ROOT: join(root, "deploy"),
    PI_WEB_NPM_BIN: fakeNpm,
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes("clean main"), true);
});

test("build-release rejects test-only overrides outside NODE_ENV=test", () => {
  const root = tempRoot();
  const result = spawnSync("bash", ["scripts/build-release.sh"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      HOME: tempRoot(),
      NODE_ENV: "production",
      PI_WEB_SOURCE_ROOT: resolve("."),
      PI_WEB_DEPLOY_ROOT: join(root, "deploy"),
      PI_WEB_SKIP_BUILD_FOR_TEST: "1",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes("test build override is forbidden outside NODE_ENV=test"), true);
});

test("failed standalone verification never creates a release directory", () => {
  const root = tempRoot();
  const verify = join(root, "verify.mjs");
  writeFileSync(verify, "process.exit(23);\n");
  const result = run("scripts/build-release.sh", {
    PI_WEB_SOURCE_ROOT: resolve("."),
    PI_WEB_DEPLOY_ROOT: join(root, "deploy"),
    PI_WEB_ALLOW_TEST_SOURCE: "1",
    PI_WEB_SKIP_BUILD_FOR_TEST: "1",
    PI_WEB_STANDALONE_VERIFY_BIN: verify,
    RELEASE_ID: "20260713-160000-05816e7",
  });
  assert.equal(result.status, 23);
  assert.equal(readFileSync(join(root, "deploy", "staging", ".failed-20260713-160000-05816e7", "failure-stage"), "utf8").trim(), "staging-verify");
  assert.throws(() => readFileSync(join(root, "deploy", "releases", "20260713-160000-05816e7", "release.json")));
});
