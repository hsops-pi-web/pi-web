import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
  const sessionIndex = new Database(join(home, ".pi-web-auth", "session-index.db"));
  sessionIndex.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions (id) VALUES ('s1');");
  sessionIndex.close();
  writeFileSync(join(home, "pi-users", "alice", "note.txt"), "hello");
  writeFileSync(join(home, ".pi", "agent", "sessions", "fixture", "one.jsonl"), "{}\n");
  writeFileSync(join(home, ".pi", "agent", "sessions", "fixture", "two.jsonl"), "{}\n");
  return home;
}

test("release shell files pass bash syntax validation", () => {
  for (const script of [
    "scripts/lib/release-common.sh",
    "scripts/build-release.sh",
    "scripts/release-production.sh",
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
  assert.equal(manifest.sessionIndex.status, "ok");
  assert.equal(manifest.sessionIndex.integrityCheck, "ok");
  assert.equal(existsSync(join(backupRoot, "backup-1", ".pi-web-auth", "session-index.db")), true);
  assert.equal(JSON.stringify(manifest).includes("alice"), false);
});

test("backup manifest allows missing session index before feature deployment", async () => {
  const root = tempRoot();
  const home = await productionHome(root);
  rmSync(join(home, ".pi-web-auth", "session-index.db"), { force: true });
  const backupRoot = join(root, "backups");
  const common = ["scripts/backup-production.mjs", "--home", home, "--backup-root", backupRoot, "--backup-id", "backup-missing-index", "--release-id", "release-1", "--commit", "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86"];
  assert.equal(spawnSync(process.execPath, [common[0], "prepare", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [common[0], "finalize", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  const manifest = JSON.parse(readFileSync(join(backupRoot, "backup-missing-index", "backup.json"), "utf8"));
  assert.deepEqual(manifest.sessionIndex, { status: "missing" });
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

function writeManifest(path: string, releaseId: string, commit: string, mtime: number): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "release.json"), JSON.stringify({
    releaseId,
    commit,
    builtAt: new Date(mtime).toISOString(),
    nodeVersion: process.version,
    appVersion: "0.6.12",
    piVersion: "0.75.5",
  }));
  const date = new Date(mtime);
  utimesSync(path, date, date);
}

function releaseFixture(scenario: string, options: { existingReleases?: number } = {}) {
  const root = tempRoot();
  const deploy = join(root, "deploy");
  const releases = join(deploy, "releases");
  const backups = join(root, "backups");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const eventsPath = join(root, "events");
  const nowPath = join(root, "now");
  const healthCountPath = join(root, "health-count");
  const envFile = join(root, "release.env");
  mkdirSync(releases, { recursive: true });
  mkdirSync(backups, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(eventsPath, "");
  writeFileSync(nowPath, "1000\n");
  writeFileSync(healthCountPath, "0\n");
  writeFileSync(envFile, "PI_WEB_RELEASE_TOKEN=test-release-token\nREGISTER_KEYWORD=test-register\n", { mode: 0o600 });

  const oldName = "20260713-120000-1111111";
  const previousName = "20260712-120000-2222222";
  const newName = "20260713-160000-3333333";
  const oldCommit = "1".repeat(40);
  const previousCommit = "2".repeat(40);
  const newCommit = "3".repeat(40);
  const oldRelease = join(releases, oldName);
  const initialPrevious = join(releases, previousName);
  const newRelease = join(releases, newName);
  writeManifest(initialPrevious, previousName, previousCommit, 1_000);
  writeManifest(oldRelease, oldName, oldCommit, 2_000);
  writeManifest(newRelease, newName, newCommit, 10_000);
  symlinkSync(oldRelease, join(deploy, "current"));
  symlinkSync(initialPrevious, join(deploy, "previous"));

  const historyNames: string[] = [];
  for (let index = 0; index < (options.existingReleases ?? 0); index += 1) {
    const name = `202607${String(index + 1).padStart(2, "0")}-010101-${String(index + 4).repeat(7).slice(0, 7)}`;
    historyNames.push(name);
    writeManifest(join(releases, name), name, String(index + 4).repeat(40).slice(0, 40), 3_000 + index * 100);
  }

  const build = join(bin, "build-release");
  executable(build, `
printf 'build\n' >> "$PI_WEB_TEST_EVENTS"
case "$PI_WEB_TEST_SCENARIO" in verify-fails|staging-fails) exit 20;; esac
printf '%s\n' "$PI_WEB_TEST_NEW_RELEASE"
`);
  const disk = join(bin, "disk-check");
  executable(disk, `
printf 'disk-check\n' >> "$PI_WEB_TEST_EVENTS"
[[ "$PI_WEB_TEST_SCENARIO" != disk-full ]]
`);
  const backup = join(bin, "backup");
  executable(backup, `
command=$1
if [[ "$command" == retention ]]; then
  printf 'retention\n' >> "$PI_WEB_TEST_EVENTS"
  exit 0
fi
printf 'backup:%s\n' "$command" >> "$PI_WEB_TEST_EVENTS"
[[ "$PI_WEB_TEST_SCENARIO" == prebackup-fails && "$command" == prepare ]] && exit 21
[[ "$PI_WEB_TEST_SCENARIO" == final-backup-fails && "$command" == finalize ]] && exit 22
exit 0
`);
  const systemctl = join(bin, "systemctl");
  executable(systemctl, `
action=$2
current=$(readlink -f "$PI_WEB_DEPLOY_ROOT/current")
if [[ "$action" == stop ]]; then
  [[ "$current" == "$PI_WEB_TEST_NEW_RELEASE" ]] && event=stop-new || event=stop
elif [[ "$action" == start ]]; then
  [[ "$current" == "$PI_WEB_TEST_NEW_RELEASE" ]] && event=start-new || event=start-old
else
  exit 0
fi
printf '%s\n' "$event" >> "$PI_WEB_TEST_EVENTS"
`);
  const now = join(bin, "now");
  executable(now, `cat "$PI_WEB_TEST_NOW"`);
  const sleep = join(bin, "sleep");
  executable(sleep, `
value=$(cat "$PI_WEB_TEST_NOW")
printf '%s\n' "$((value + 1000))" > "$PI_WEB_TEST_NOW"
`);
  const curl = join(bin, "curl");
  executable(curl, `
config=$(cat)
args="$* $config"
if [[ "$args" == *'/api/internal/drain'* ]]; then
  printf 'drain\n' >> "$PI_WEB_TEST_EVENTS"
  [[ "$PI_WEB_TEST_SCENARIO" == budget-exhausted ]] && printf '61001\n' > "$PI_WEB_TEST_NOW"
  printf '{"state":"shutting_down","errors":[]}\n'
  exit 0
fi
if [[ "$args" == *'/api/internal/resume'* ]]; then
  printf 'resume\n' >> "$PI_WEB_TEST_EVENTS"
  printf '{"state":"running"}\n'
  exit 0
fi
if [[ "$args" == *'/api/health/ready'* ]]; then
  current=$(readlink -f "$PI_WEB_DEPLOY_ROOT/current")
  if [[ "$current" == "$PI_WEB_TEST_NEW_RELEASE" ]]; then
    marker="$PI_WEB_TEST_ROOT/health-new-seen"
    [[ -e "$marker" ]] || { touch "$marker"; printf 'health-new\n' >> "$PI_WEB_TEST_EVENTS"; }
    [[ "$PI_WEB_TEST_SCENARIO" == new-health-fails ]] && exit 22
    count=$(cat "$PI_WEB_TEST_HEALTH_COUNT")
    count=$((count + 1))
    printf '%s\n' "$count" > "$PI_WEB_TEST_HEALTH_COUNT"
    case "$count" in 1|3) exit 22;; esac
    printf '{"status":"ready","releaseId":"%s","commit":"%s"}\n' "$PI_WEB_TEST_NEW_ID" "$PI_WEB_TEST_NEW_COMMIT"
    exit 0
  fi
  marker="$PI_WEB_TEST_ROOT/health-old-seen"
  [[ -e "$marker" ]] || { touch "$marker"; printf 'health-old\n' >> "$PI_WEB_TEST_EVENTS"; }
  printf '{"status":"ready","releaseId":"%s","commit":"%s"}\n' "$PI_WEB_TEST_OLD_ID" "$PI_WEB_TEST_OLD_COMMIT"
  exit 0
fi
exit 2
`);

  let lockHolder: ReturnType<typeof spawn> | null = null;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    HOME: home,
    PI_WEB_SOURCE_ROOT: resolve("."),
    PI_WEB_DEPLOY_ROOT: deploy,
    PI_WEB_BACKUP_ROOT: backups,
    PI_WEB_PRODUCTION_HOME: home,
    PI_WEB_RELEASE_ENV: envFile,
    PI_WEB_BUILD_RELEASE_BIN: build,
    PI_WEB_BACKUP_BIN: backup,
    PI_WEB_DISK_CHECK_BIN: disk,
    PI_WEB_SYSTEMCTL_BIN: systemctl,
    PI_WEB_CURL_BIN: curl,
    PI_WEB_NOW_BIN: now,
    PI_WEB_SLEEP_BIN: sleep,
    PI_WEB_NODE_BIN: process.execPath,
    PI_WEB_TEST_EVENTS: eventsPath,
    PI_WEB_TEST_SCENARIO: scenario,
    PI_WEB_TEST_NEW_RELEASE: newRelease,
    PI_WEB_TEST_NEW_ID: newName,
    PI_WEB_TEST_NEW_COMMIT: newCommit,
    PI_WEB_TEST_OLD_ID: oldName,
    PI_WEB_TEST_OLD_COMMIT: oldCommit,
    PI_WEB_TEST_NOW: nowPath,
    PI_WEB_TEST_HEALTH_COUNT: healthCountPath,
    PI_WEB_TEST_ROOT: root,
  };
  return {
    newRelease,
    oldRelease,
    initialPrevious,
    currentName: newName,
    previousName: oldName,
    historyNames,
    run() {
      const result = spawnSync("bash", ["scripts/release-production.sh"], { cwd: resolve("."), env: environment, encoding: "utf8" });
      lockHolder?.kill("SIGTERM");
      return result;
    },
    runWithArgs(args: string[]) {
      return spawnSync("bash", ["scripts/release-production.sh", ...args], { cwd: resolve("."), env: environment, encoding: "utf8" });
    },
    events() { return readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean); },
    currentTarget() { return realpathSync(join(deploy, "current")); },
    previousTarget() { return realpathSync(join(deploy, "previous")); },
    remainingReleaseNames() { return readdirSync(releases).sort(); },
    holdLock() {
      const ready = join(root, "lock-ready");
      lockHolder = spawn("bash", ["-c", `exec 9>${JSON.stringify(join(deploy, "release.lock"))}; flock 9; touch ${JSON.stringify(ready)}; sleep 30`], { stdio: "ignore" });
      const deadline = Date.now() + 2_000;
      while (!existsSync(ready) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      assert.equal(existsSync(ready), true);
    },
  };
}

const releaseCases = [
  ["verify-fails", ["build"], false],
  ["staging-fails", ["build"], false],
  ["disk-full", ["build", "disk-check"], false],
  ["prebackup-fails", ["build", "disk-check", "backup:prepare"], false],
  ["budget-exhausted", ["build", "disk-check", "backup:prepare", "drain", "resume"], false],
  ["final-backup-fails", ["build", "disk-check", "backup:prepare", "drain", "stop", "backup:finalize", "start-old", "health-old"], false],
  ["new-health-fails", ["build", "disk-check", "backup:prepare", "drain", "stop", "backup:finalize", "start-new", "health-new", "stop-new", "start-old", "health-old"], false],
  ["success", ["build", "disk-check", "backup:prepare", "drain", "stop", "backup:finalize", "start-new", "health-new", "retention"], true],
] as const;

for (const [scenario, expectedEvents, success] of releaseCases) {
  test(`release state machine: ${scenario}`, () => {
    const fixture = releaseFixture(scenario);
    const result = fixture.run();
    assert.equal(result.status === 0, success);
    assert.deepEqual(fixture.events(), expectedEvents);
    assert.equal(fixture.currentTarget(), success ? fixture.newRelease : fixture.oldRelease);
    assert.equal(fixture.previousTarget(), success ? fixture.oldRelease : fixture.initialPrevious);
  });
}

test("a concurrent release fails before build", () => {
  const fixture = releaseFixture("success");
  fixture.holdLock();
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.deepEqual(fixture.events(), []);
});

test("normal releases reject the one-time legacy migration flags", () => {
  const fixture = releaseFixture("success");
  const result = fixture.runWithArgs(["--allow-legacy-stop"]);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fixture.events(), []);
});

test("release retention preserves current and previous and keeps four total", () => {
  const fixture = releaseFixture("success", { existingReleases: 6 });
  assert.equal(fixture.run().status, 0);
  assert.deepEqual(fixture.remainingReleaseNames(), [
    fixture.currentName,
    fixture.previousName,
    fixture.historyNames.at(-1),
    fixture.historyNames.at(-2),
  ].sort());
});

function firstMigrationFixture() {
  const root = tempRoot();
  const source = join(root, "source");
  const deploy = join(root, "deploy");
  const releaseId = "20260713-170000-4444444";
  const commit = "4".repeat(40);
  const release = join(deploy, "releases", releaseId);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const installedUnit = join(root, "systemd", "pi-web-auth.service");
  const envFile = join(root, "release.env");
  const eventsPath = join(root, "events");
  const nowPath = join(root, "now");
  mkdirSync(join(source, ".next"), { recursive: true });
  mkdirSync(join(home, ".pi-web-auth"), { recursive: true });
  mkdirSync(join(home, "pi-users"), { recursive: true });
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  mkdirSync(dirname(installedUnit), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(source, "tracked.txt"), "source\n");
  writeFileSync(join(source, ".next", "build.txt"), "legacy-build\n");
  for (const args of [["init"], ["config", "user.email", "release@test"], ["config", "user.name", "Release Test"], ["add", "tracked.txt"], ["commit", "-m", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  writeManifest(release, releaseId, commit, 10_000);
  mkdirSync(join(release, "scripts"), { recursive: true });
  writeFileSync(join(release, "server.js"), "// fixture\n");
  writeFileSync(installedUnit, `[Service]\nWorkingDirectory=${source}\nEnvironment=REGISTER_KEYWORD=legacy-key\n`);
  writeFileSync(eventsPath, "");
  writeFileSync(nowPath, "1000\n");

  const disk = join(bin, "disk-check");
  executable(disk, `printf 'disk-check\n' >> "$PI_WEB_TEST_EVENTS"`);
  const backup = join(bin, "backup");
  executable(backup, `printf 'backup:%s\n' "$1" >> "$PI_WEB_TEST_EVENTS"`);
  const openssl = join(bin, "openssl");
  executable(openssl, `printf '%064d\n' 0`);
  const now = join(bin, "now");
  executable(now, `cat "$PI_WEB_TEST_NOW"`);
  const sleep = join(bin, "sleep");
  executable(sleep, `value=$(cat "$PI_WEB_TEST_NOW"); printf '%s\n' "$((value + 1000))" > "$PI_WEB_TEST_NOW"`);
  const systemctl = join(bin, "systemctl");
  executable(systemctl, `
action=$2
if [[ "$action" == daemon-reload ]]; then printf 'daemon-reload\n' >> "$PI_WEB_TEST_EVENTS"; exit 0; fi
if grep -q 'pi-web-auth-deploy/current' "$PI_WEB_TEST_INSTALLED_UNIT"; then mode=new; else mode=old; fi
printf '%s-%s\n' "$action" "$mode" >> "$PI_WEB_TEST_EVENTS"
`);
  const curl = join(bin, "curl");
  executable(curl, `
config=$(cat || true); args="$* $config"
if [[ "$args" == *'/api/internal/drain'* ]]; then printf 'drain\n' >> "$PI_WEB_TEST_EVENTS"; printf '{}\n'; exit 0; fi
if [[ "$args" == *'/api/internal/resume'* ]]; then printf 'resume\n' >> "$PI_WEB_TEST_EVENTS"; exit 0; fi
if [[ "$args" == *'/api/health/ready'* ]]; then
  [[ -e "$PI_WEB_TEST_ROOT/health-seen" ]] || { touch "$PI_WEB_TEST_ROOT/health-seen"; printf 'health-new\n' >> "$PI_WEB_TEST_EVENTS"; }
  exit 22
fi
if [[ "$args" == *'/login'* ]]; then printf 'login-old\n' >> "$PI_WEB_TEST_EVENTS"; printf '<html></html>\n'; exit 0; fi
exit 2
`);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    HOME: home,
    PI_WEB_SOURCE_ROOT: source,
    PI_WEB_DEPLOY_ROOT: deploy,
    PI_WEB_BACKUP_ROOT: join(root, "backups"),
    PI_WEB_PRODUCTION_HOME: home,
    PI_WEB_INSTALLED_UNIT: installedUnit,
    PI_WEB_UNIT_TEMPLATE: resolve("systemd/pi-web-auth.service"),
    PI_WEB_RELEASE_ENV: envFile,
    PI_WEB_LEGACY_NEXT: join(source, ".next"),
    PI_WEB_MIGRATION_ROOT: join(deploy, "migration"),
    PI_WEB_BACKUP_BIN: backup,
    PI_WEB_DISK_CHECK_BIN: disk,
    PI_WEB_OPENSSL_BIN: openssl,
    PI_WEB_SYSTEMCTL_BIN: systemctl,
    PI_WEB_CURL_BIN: curl,
    PI_WEB_NOW_BIN: now,
    PI_WEB_SLEEP_BIN: sleep,
    PI_WEB_NODE_BIN: process.execPath,
    PI_WEB_TEST_EVENTS: eventsPath,
    PI_WEB_TEST_NOW: nowPath,
    PI_WEB_TEST_INSTALLED_UNIT: installedUnit,
    PI_WEB_TEST_ROOT: root,
  };
  return {
    installedUnit,
    hashLegacyNext: () => readFileSync(join(source, ".next", "build.txt"), "utf8"),
    events: () => readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean),
    run: () => spawnSync("bash", [
      "scripts/migrate-first-release.sh",
      "--release", release,
      "--allow-legacy-stop",
      "--confirm-no-active-replies", releaseId,
    ], { cwd: resolve("."), env: environment, encoding: "utf8" }),
    runWithoutConfirmation: () => spawnSync("bash", [
      "scripts/migrate-first-release.sh",
      "--release", release,
    ], { cwd: resolve("."), env: environment, encoding: "utf8" }),
  };
}

test("standalone unit preserves production environment and stop guards", () => {
  const unit = readFileSync("systemd/pi-web-auth.service", "utf8");
  assert.match(unit, /WorkingDirectory=\/home\/hsops\/pi-web-auth-deploy\/current/);
  assert.match(unit, /EnvironmentFile=\/home\/hsops\/\.config\/pi-web-auth\/release\.env/);
  assert.match(unit, /Environment=HOME=\/home\/hsops/);
  assert.match(unit, /Environment=PORT=8000/);
  assert.match(unit, /Environment=HOSTNAME=0\.0\.0\.0/);
  assert.match(unit, /ExecStart=.*node \/home\/hsops\/pi-web-auth-deploy\/current\/server\.js/);
  assert.match(unit, /ExecStop=.*current\/scripts\/systemd-stop\.sh/);
  assert.match(unit, /TimeoutStopSec=65/);
});

test("first migration failure restores the original unit and legacy next", () => {
  const fixture = firstMigrationFixture();
  const beforeUnit = readFileSync(fixture.installedUnit, "utf8");
  const beforeNext = fixture.hashLegacyNext();
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(fixture.installedUnit, "utf8"), beforeUnit);
  assert.equal(fixture.hashLegacyNext(), beforeNext);
  assert.deepEqual(fixture.events(), [
    "disk-check",
    "backup:prepare",
    "stop-old",
    "backup:finalize",
    "daemon-reload",
    "start-new",
    "health-new",
    "stop-new",
    "daemon-reload",
    "start-old",
    "login-old",
  ]);
});

test("first migration refuses to stop legacy without both explicit confirmations", () => {
  const fixture = firstMigrationFixture();
  const result = fixture.runWithoutConfirmation();
  assert.notEqual(result.status, 0);
  assert.deepEqual(fixture.events(), []);
});
