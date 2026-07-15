import path from "path";
import os from "os";
import { lstatSync, realpathSync } from "fs";

function getUserRoot(username: string): string {
  return path.join(os.homedir(), "pi-users", username);
}

function isInsideUserRoot(target: string, username: string): boolean {
  const root = getUserRoot(username);
  const normalized = path.resolve(target);
  return normalized === root || normalized.startsWith(root + path.sep);
}

function canonicalizeExistingPrefix(target: string): string {
  const absolute = path.resolve(target);
  const segments = absolute.split(path.sep).filter(Boolean);

  for (let index = segments.length; index >= 0; index--) {
    const prefix = path.sep + segments.slice(0, index).join(path.sep);
    let exists = index === 0;
    if (!exists) {
      try {
        lstatSync(prefix);
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!exists) continue;

    const realPrefix = index === 0 ? path.sep : realpathSync(prefix);
    const remainder = segments.slice(index);
    return remainder.length ? path.join(realPrefix, ...remainder) : realPrefix;
  }

  return absolute;
}

function ownsSessionCwd(cwd: string, username: string): boolean {
  if (!cwd) return false;
  try {
    return isInsideUserRoot(canonicalizeExistingPrefix(cwd), username);
  } catch {
    return false;
  }
}

export function computeSessionOwner(cwd: string, usernames: string[]): string | null {
  if (!cwd) return null;
  const owners = usernames.filter((username) => ownsSessionCwd(cwd, username));
  return owners.length === 1 ? owners[0] : null;
}
