import { lstatSync, rmSync } from "fs";
import { invalidateSessionPathCache, listAllSessions } from "@/lib/session-reader";
import {
  abortSessionsUnderCwd,
  markRootDeleting,
  unmarkRootDeleting,
  waitForStartsUnderRoot,
} from "@/lib/rpc-manager";
import { getDb } from "./db";
import { filterJsonlUnderRoot } from "./delete-user-helpers";
import {
  canonicalizeExistingPrefix,
  getUserRoot,
  resolveSessionOwnership,
} from "./paths";

export async function deleteUserCompletely(
  username: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const userRootPath = getUserRoot(username);

  db.prepare("UPDATE users SET disabled=1 WHERE username=?").run(username);
  db.prepare("DELETE FROM sessions WHERE username=?").run(username);

  try {
    const stat = lstatSync(userRootPath);
    if (stat.isSymbolicLink()) {
      return {
        ok: false,
        error: `用户根 ${userRootPath} 是软链，拒绝删除；用户已禁用，可修复后重试`,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        ok: false,
        error: `无法核验用户根: ${String(error)}；用户已禁用，可重试`,
      };
    }
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = canonicalizeExistingPrefix(userRootPath);
  } catch (error) {
    return {
      ok: false,
      error: `无法规范化用户根: ${String(error)}；用户已禁用，可重试`,
    };
  }

  markRootDeleting(canonicalRoot);
  try {
    db.prepare("DELETE FROM sessions WHERE username=?").run(username);

    await waitForStartsUnderRoot(canonicalRoot);
    await abortSessionsUnderCwd(canonicalRoot);

    const sessions = await listAllSessions();
    const ownedSessions = sessions
      .filter((session) => session.cwd && resolveSessionOwnership(session.cwd, username))
      .map((session) => ({
        id: session.id,
        file: session.path,
        cwd: canonicalizeExistingPrefix(session.cwd),
      }));
    const jsonlFiles = filterJsonlUnderRoot(
      ownedSessions.map(({ file, cwd }) => ({ file, cwd })),
      canonicalRoot
    );
    const idByPath = new Map(ownedSessions.map(({ file, id }) => [file, id]));

    for (const file of jsonlFiles) {
      rmSync(file, { force: true });
      const id = idByPath.get(file);
      if (id) invalidateSessionPathCache(id);
    }

    rmSync(userRootPath, { recursive: true, force: true });
    db.transaction(() => {
      db.prepare("DELETE FROM user_model_preferences WHERE username=?").run(username);
      db.prepare("DELETE FROM users WHERE username=?").run(username);
    })();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  } finally {
    unmarkRootDeleting(canonicalRoot);
  }
}
