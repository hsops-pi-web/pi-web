import Database from "better-sqlite3";

function loadSessionIndexDependencies() {
  const dataDir = eval("require")("../auth/data-dir") as typeof import("../auth/data-dir");
  const dbModule = eval("require")("./db") as typeof import("./db");
  const storeModule = eval("require")("./store") as typeof import("./store");
  return { dataDir, dbModule, storeModule };
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
