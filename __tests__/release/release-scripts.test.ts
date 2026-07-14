import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  chmodSync,
  mkdirSync,
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

async function productionHome(root: string): Promise<string> {
  const home = join(root, "home");
  mkdirSync(join(home, ".pi-web-auth"), { recursive: true });
  mkdirSync(join(home, "pi-users", "alice"), { recursive: true });
  mkdirSync(join(home, ".pi", "agent", "sessions", "fixture"), { recursive: true });
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(join(home, ".pi-web-auth", "auth.db"));
  db.exec(`
    CREATE TABLE users(username TEXT, password_hash TEXT, created_at TEXT, role TEXT, disabled INTEGER);
    CREATE TABLE sessions(token TEXT, username TEXT, expires_at INTEGER);
    CREATE TABLE user_model_preferences(username TEXT, provider TEXT, model_id TEXT, updated_at TEXT);
    INSERT INTO users VALUES('alice','hash','2026-07-13','user',0);
    INSERT INTO sessions VALUES('token','alice',9999999999999);
    INSERT INTO user_model_preferences VALUES('alice','glm','glm-5.2','2026-07-13');
  `);
  db.close();
  writeFileSync(join(home, "pi-users", "alice", "note.txt"), "hello");
  writeFileSync(join(home, ".pi", "agent", "sessions", "fixture", "one.jsonl"), "{}\n");
  writeFileSync(join(home, ".pi", "agent", "sessions", "fixture", "two.jsonl"), "{}\n");
  return home;
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

test("prepare plus finalize creates an atomic verified backup manifest", async () => {
  const root = tempRoot();
  const home = await productionHome(root);
  const backupRoot = join(root, "backups");
  const common = ["scripts/backup-production.mjs", "--home", home, "--backup-root", backupRoot, "--backup-id", "backup-1", "--release-id", "release-1", "--commit", "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86"];
  assert.equal(spawnSync(process.execPath, [common[0], "prepare", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [common[0], "finalize", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  const manifest = JSON.parse(readFileSync(join(backupRoot, "backup-1", "backup.json"), "utf8"));
  assert.equal(manifest.databaseIntegrity, "ok");
  assert.equal(manifest.counts.users, 1);
  assert.equal(manifest.counts.loginSessions, 1);
  assert.equal(manifest.counts.modelPreferences, 1);
  assert.equal(manifest.counts.piJsonl, 2);
  assert.equal(JSON.stringify(manifest).includes("alice"), false);
});

test("failed validation remains incomplete and is never counted for retention", async () => {
  const root = tempRoot();
  const home = await productionHome(root);
  const backupRoot = join(root, "backups");
  const args = ["scripts/backup-production.mjs", "prepare", "--home", home, "--backup-root", backupRoot, "--backup-id", "broken", "--release-id", "release", "--commit", "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86"];
  assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
  writeFileSync(join(backupRoot, ".incomplete-broken", ".pi-web-auth", "auth.db"), "corrupt");
  const result = spawnSync(process.execPath, [args[0], "finalize", ...args.slice(2)], { encoding: "utf8", env: { ...process.env, PI_WEB_SKIP_FINAL_DB_BACKUP_FOR_TEST: "1", NODE_ENV: "test" } });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(backupRoot, ".incomplete-broken", ".backup-state.json"), "utf8").includes("broken"), true);
});

test("retention keeps seven verified backups and every incomplete directory", () => {
  const root = tempRoot();
  const backupRoot = join(root, "backups");
  mkdirSync(backupRoot, { recursive: true });
  for (let i = 1; i <= 9; i += 1) {
    const dir = join(backupRoot, `backup-${String(i).padStart(2, "0")}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "backup.json"), JSON.stringify({ backupId: `backup-${String(i).padStart(2, "0")}`, completedAt: `2026-07-${String(i).padStart(2, "0")}T00:00:00.000Z`, databaseIntegrity: "ok" }));
  }
  mkdirSync(join(backupRoot, ".incomplete-keep"));
  writeFileSync(join(backupRoot, ".incomplete-keep", ".keep"), "keep");
  const result = spawnSync(process.execPath, ["scripts/backup-production.mjs", "retention", "--backup-root", backupRoot], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(backupRoot, "backup-09", "backup.json"), "utf8").length > 0, true);
  assert.throws(() => readFileSync(join(backupRoot, "backup-01", "backup.json")));
  assert.equal(readFileSync(join(backupRoot, ".incomplete-keep", ".keep"), "utf8"), "keep");
});
