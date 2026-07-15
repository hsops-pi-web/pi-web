import { statSync } from "fs";
import { getSessionIndexDbPath } from "../auth/data-dir";
import { listUsernames } from "../auth/users";
import { getSessionsDir } from "../session-reader";
export { cleanupDeletedUserSessionIndex } from "./cleanup";
import { cleanupDeletedUserSessionIndex } from "./cleanup";
import { getSessionIndexDb } from "./db";
import { indexSessionFile, markMissingSessionPath } from "./indexer";
import { shouldRetryMissingFile } from "./retry";
import { scanSessionFiles } from "./scanner";
import { createSessionIndexStore } from "./store";

const INDEX_RETRY_DELAYS_MS = [100, 500, 1500];
const SYNC_THROTTLE_MS = 10_000;

declare global {
  var __piSessionIndexLastSyncMs: number | undefined;
}

export function getSessionIndexStore() {
  const db = getSessionIndexDb(getSessionIndexDbPath());
  syncSessionIndex(db);
  return createSessionIndexStore(db);
}

export function syncSessionIndex(db = getSessionIndexDb(getSessionIndexDbPath()), force = false): void {
  const now = Date.now();
  if (!force && globalThis.__piSessionIndexLastSyncMs && now - globalThis.__piSessionIndexLastSyncMs < SYNC_THROTTLE_MS) return;
  globalThis.__piSessionIndexLastSyncMs = now;

  const files = scanSessionFiles(getSessionsDir());
  const seenPaths = new Set(files.map((file) => file.path));
  const usernames = listUsernames();
  const existing = db.prepare("SELECT path, source_mtime_ms FROM sessions WHERE missing=0").all() as Array<{ path: string; source_mtime_ms: number }>;
  const known = new Map(existing.map((row) => [row.path, row.source_mtime_ms]));

  for (const file of files) {
    if (known.get(file.path) === file.mtimeMs) continue;
    indexSessionFile(db, file, usernames);
  }
  for (const row of existing) {
    if (!seenPaths.has(row.path)) markMissingSessionPath(db, row.path);
  }
}

export function cleanupDeletedUserSessionIndexGlobal(username: string, deletedSessionIds: string[]): void {
  cleanupDeletedUserSessionIndex(getSessionIndexDb(getSessionIndexDbPath()), username, deletedSessionIds);
}

export function scheduleIndexSessionFile(filePath: string): void {
  scheduleIndexSessionFileAttempt(filePath, INDEX_RETRY_DELAYS_MS);
}

function scheduleIndexSessionFileAttempt(filePath: string, retryDelaysMs: number[]): void {
  try {
    if (!filePath) return;
    const stat = statSync(filePath);
    indexSessionFile(
      getSessionIndexDb(getSessionIndexDbPath()),
      { path: filePath, mtimeMs: Math.floor(stat.mtimeMs) },
      listUsernames(),
    );
  } catch (error) {
    if (shouldRetryMissingFile(error, retryDelaysMs.length)) {
      const [delayMs, ...remainingDelays] = retryDelaysMs;
      setTimeout(() => scheduleIndexSessionFileAttempt(filePath, remainingDelays), delayMs);
      return;
    }
    console.warn("session index hook failed", error);
  }
}

export function deleteIndexedSessionAfterFileDelete(sessionId: string, username: string): void {
  try {
    cleanupDeletedUserSessionIndexGlobal(username, [sessionId]);
  } catch (error) {
    console.warn("session index delete hook failed", error);
  }
}
