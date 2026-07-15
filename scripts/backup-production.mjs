import Database from "better-sqlite3";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2];
const known = new Set(["home", "backup-root", "backup-id", "release-id", "commit"]);
function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error("arguments must be --key value pairs");
    const key = flag.slice(2);
    if (!known.has(key)) throw new Error(`unknown argument: ${flag}`);
    values[key] = value;
  }
  return values;
}

function required(value, name) {
  if (!value) throw new Error(`missing --${name}`);
  return value;
}
function assertSafeId(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`invalid ${name}`);
}
function assertCommit(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("invalid commit");
}
function fsyncDirectory(path) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeAtomicJson(path, value) {
  const temp = `${path}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  fsyncDirectory(dirname(path));
}
function runRsync(source, destination, excludes = []) {
  mkdirSync(destination, { recursive: true });
  const bin = process.env.PI_WEB_RSYNC_BIN || "rsync";
  const args = ["-a", "--delete", ...excludes.flatMap((item) => ["--exclude", item]), `${source}/`, `${destination}/`];
  const result = spawnSync(bin, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("rsync failed");
}
async function backupDatabase(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { force: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(destination); } finally { db.close(); }
}
function inspectDatabase(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const databaseIntegrity = db.pragma("integrity_check", { simple: true });
    if (databaseIntegrity !== "ok") throw new Error("database integrity check failed");
    return {
      databaseIntegrity,
      users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      loginSessions: db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,
      modelPreferences: db.prepare("SELECT COUNT(*) AS count FROM user_model_preferences").get().count,
    };
  } finally {
    db.close();
  }
}
function inspectSessionIndexDatabase(path) {
  if (!existsSync(path)) return { status: "missing" };
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrityCheck = db.pragma("integrity_check", { simple: true });
    if (integrityCheck !== "ok") throw new Error("session index integrity check failed");
    return { status: "ok", integrityCheck };
  } finally {
    db.close();
  }
}
async function backupOptionalDatabase(source, destination) {
  if (!existsSync(source)) return { status: "missing" };
  await backupDatabase(source, destination);
  return inspectSessionIndexDatabase(destination);
}
function countFiles(root, predicate = () => true) {
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) count += countFiles(path, predicate);
    else if (entry.isFile() && predicate(path)) count += 1;
  }
  return count;
}
function pathsFor(home, backupRoot, backupId) {
  return {
    sourceAuth: join(home, ".pi-web-auth"),
    sourceUsers: join(home, "pi-users"),
    sourceAgent: join(home, ".pi", "agent"),
    incomplete: join(backupRoot, `.incomplete-${backupId}`),
    complete: join(backupRoot, backupId),
  };
}
function copyDirectories(paths) {
  runRsync(paths.sourceAuth, join(paths.incomplete, ".pi-web-auth"), ["auth.db", "auth.db-wal", "auth.db-shm", "session-index.db", "session-index.db-wal", "session-index.db-shm"]);
  runRsync(paths.sourceUsers, join(paths.incomplete, "pi-users"));
  runRsync(paths.sourceAgent, join(paths.incomplete, ".pi", "agent"));
}
function validateDirectory(path) {
  for (const relative of [".pi-web-auth", "pi-users", join(".pi", "agent")]) {
    if (!existsSync(join(path, relative))) throw new Error("backup data directory missing");
  }
  return inspectDatabase(join(path, ".pi-web-auth", "auth.db"));
}
async function prepare(options) {
  const home = required(options.home, "home");
  const backupRoot = required(options["backup-root"], "backup-root");
  const backupId = required(options["backup-id"], "backup-id");
  const releaseId = required(options["release-id"], "release-id");
  const commit = required(options.commit, "commit");
  assertSafeId(backupId, "backup id");
  assertSafeId(releaseId, "release id");
  assertCommit(commit);
  const paths = pathsFor(home, backupRoot, backupId);
  if (existsSync(paths.incomplete) || existsSync(paths.complete)) throw new Error("backup id already exists");
  mkdirSync(paths.incomplete, { recursive: true });
  writeAtomicJson(join(paths.incomplete, ".backup-state.json"), {
    backupId, releaseId, commit, startedAt: new Date().toISOString(),
  });
  copyDirectories(paths);
  await backupDatabase(join(paths.sourceAuth, "auth.db"), join(paths.incomplete, ".pi-web-auth", "auth.db"));
  await backupOptionalDatabase(join(paths.sourceAuth, "session-index.db"), join(paths.incomplete, ".pi-web-auth", "session-index.db"));
  process.stdout.write(`${paths.incomplete}\n`);
}
async function finalize(options) {
  const home = required(options.home, "home");
  const backupRoot = required(options["backup-root"], "backup-root");
  const backupId = required(options["backup-id"], "backup-id");
  const releaseId = required(options["release-id"], "release-id");
  const commit = required(options.commit, "commit");
  assertSafeId(backupId, "backup id");
  assertSafeId(releaseId, "release id");
  assertCommit(commit);
  const paths = pathsFor(home, backupRoot, backupId);
  const state = JSON.parse(readFileSync(join(paths.incomplete, ".backup-state.json"), "utf8"));
  if (state.backupId !== backupId || state.releaseId !== releaseId || state.commit !== commit) throw new Error("backup state mismatch");
  copyDirectories(paths);
  const skipFinal = process.env.PI_WEB_SKIP_FINAL_DB_BACKUP_FOR_TEST === "1";
  if (skipFinal && process.env.NODE_ENV !== "test") throw new Error("test backup override is forbidden");
  let sessionIndex;
  if (!skipFinal) {
    await backupDatabase(join(paths.sourceAuth, "auth.db"), join(paths.incomplete, ".pi-web-auth", "auth.db"));
    sessionIndex = await backupOptionalDatabase(join(paths.sourceAuth, "session-index.db"), join(paths.incomplete, ".pi-web-auth", "session-index.db"));
  } else {
    sessionIndex = inspectSessionIndexDatabase(join(paths.incomplete, ".pi-web-auth", "session-index.db"));
  }
  const database = validateDirectory(paths.incomplete);
  const manifest = {
    backupId,
    releaseId,
    commit,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    databaseIntegrity: database.databaseIntegrity,
    counts: {
      users: database.users,
      loginSessions: database.loginSessions,
      modelPreferences: database.modelPreferences,
      piJsonl: countFiles(join(paths.incomplete, ".pi", "agent"), (path) => path.endsWith(".jsonl")),
      authFiles: countFiles(join(paths.incomplete, ".pi-web-auth")),
      userFiles: countFiles(join(paths.incomplete, "pi-users")),
      agentFiles: countFiles(join(paths.incomplete, ".pi", "agent")),
    },
    sessionIndex,
    dataDirectories: [".pi-web-auth", "pi-users", ".pi/agent"],
  };
  writeAtomicJson(join(paths.incomplete, "backup.json"), manifest);
  renameSync(paths.incomplete, paths.complete);
  fsyncDirectory(backupRoot);
  process.stdout.write(`${paths.complete}\n`);
}
function validate(options) {
  const backupRoot = required(options["backup-root"], "backup-root");
  const backupId = required(options["backup-id"], "backup-id");
  assertSafeId(backupId, "backup id");
  const path = join(backupRoot, backupId);
  const manifest = JSON.parse(readFileSync(join(path, "backup.json"), "utf8"));
  const database = validateDirectory(path);
  const sessionIndex = inspectSessionIndexDatabase(join(path, ".pi-web-auth", "session-index.db"));
  if (manifest.backupId !== backupId || manifest.databaseIntegrity !== "ok" || database.databaseIntegrity !== "ok") {
    throw new Error("backup manifest validation failed");
  }
  if (manifest.sessionIndex?.status === "ok" && sessionIndex.integrityCheck !== "ok") {
    throw new Error("session index backup validation failed");
  }
  process.stdout.write("ok\n");
}
function retention(options) {
  const backupRoot = required(options["backup-root"], "backup-root");
  mkdirSync(backupRoot, { recursive: true });
  const verified = [];
  for (const entry of readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(backupRoot, entry.name, "backup.json"), "utf8"));
      if (manifest.backupId === entry.name && manifest.databaseIntegrity === "ok" && typeof manifest.completedAt === "string") {
        verified.push({ name: entry.name, completedAt: manifest.completedAt });
      }
    } catch {
      // Invalid directories are diagnostic evidence and are not retention candidates.
    }
  }
  verified.sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  for (const item of verified.slice(7)) rmSync(join(backupRoot, item.name), { recursive: true, force: true });
  process.stdout.write(`${Math.max(0, verified.length - 7)}\n`);
}

try {
  if (!new Set(["prepare", "finalize", "validate", "retention"]).has(command)) throw new Error("invalid backup command");
  const options = parseArgs(process.argv.slice(3));
  if (command === "prepare") await prepare(options);
  if (command === "finalize") await finalize(options);
  if (command === "validate") validate(options);
  if (command === "retention") retention(options);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "backup failed"}\n`);
  process.exitCode = 1;
}
