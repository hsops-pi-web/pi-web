import { getDb } from "./db";

export function listUsernames(): string[] {
  const rows = getDb().prepare("SELECT username FROM users WHERE disabled=0 ORDER BY username ASC").all() as { username: string }[];
  return rows.map((row) => row.username);
}
