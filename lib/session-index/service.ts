import Database from "better-sqlite3";
import { statSync } from "fs";

function loadSessionIndexDependencies() {
  const dataDir = eval("require")("../auth/data-dir") as typeof import("../auth/data-dir");
  const dbModule = eval("require")("./db") as typeof import("./db");
  const indexerModule = eval("require")("./indexer") as typeof import("./indexer");
  const storeModule = eval("require")("./store") as typeof import("./store");
  const usersModule = eval("require")("../auth/users") as typeof import("../auth/users");
  return { dataDir, dbModule, indexerModule, storeModule, usersModule };
}

export function getSessionIndexStore() {
  const { dataDir, dbModule, storeModule } = loadSessionIndexDependencies();
  return storeModule.createSessionIndexStore(dbModule.getSessionIndexDb(dataDir.getSessionIndexDbPath()));
}

export function cleanupDeletedUserSessionIndex(db: Database.Database, username: string, deletedSessionIds: string[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM user_session_metadata WHERE username=?").run(username);
    db.prepare("DELETE FROM session_tags WHERE username=?").run(username);
    db.prepare("DELETE FROM tags WHERE username=?").run(username);
    db.prepare("DELETE FROM user_workspace_metadata WHERE username=?").run(username);

    const deleteSession = db.prepare("DELETE FROM sessions WHERE id=? AND owner_username=?");
    for (const sessionId of deletedSessionIds) {
      deleteSession.run(sessionId, username);
    }
  })();
}

export function cleanupDeletedUserSessionIndexGlobal(username: string, deletedSessionIds: string[]): void {
  const { dataDir, dbModule } = loadSessionIndexDependencies();
  cleanupDeletedUserSessionIndex(dbModule.getSessionIndexDb(dataDir.getSessionIndexDbPath()), username, deletedSessionIds);
}

export function scheduleIndexSessionFile(filePath: string): void {
  try {
    if (!filePath) return;
    const { dataDir, dbModule, indexerModule, usersModule } = loadSessionIndexDependencies();
    const stat = statSync(filePath);
    indexerModule.indexSessionFile(
      dbModule.getSessionIndexDb(dataDir.getSessionIndexDbPath()),
      { path: filePath, mtimeMs: Math.floor(stat.mtimeMs) },
      usersModule.listUsernames(),
    );
  } catch (error) {
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
