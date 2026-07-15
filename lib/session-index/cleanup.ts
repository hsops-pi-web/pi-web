import Database from "better-sqlite3";

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
