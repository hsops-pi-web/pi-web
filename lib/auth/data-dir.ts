import os from "os";
import path from "path";

export function getPiWebAuthDataDir(): string {
  return path.join(os.homedir(), ".pi-web-auth");
}

export function getAuthDbPath(): string {
  return path.join(getPiWebAuthDataDir(), "auth.db");
}

export function getSessionIndexDbPath(): string {
  return path.join(getPiWebAuthDataDir(), "session-index.db");
}
