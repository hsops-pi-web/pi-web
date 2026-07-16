import type Database from "better-sqlite3";
import type { Role } from "./roles";

export interface AdminVisibility {
  actorUsername: string;
  actorRole: "admin" | "super_admin";
  visibleOwnerUsernames: string[];
  includeUnownedIndexIssues: boolean;
}

export function listAdminVisibleOwners(db: Database.Database, actorRole: "admin" | "super_admin"): string[] {
  const sql = actorRole === "super_admin"
    ? "SELECT username FROM users ORDER BY username ASC"
    : "SELECT username FROM users WHERE role='user' ORDER BY username ASC";
  return (db.prepare(sql).all() as Array<{ username: string }>).map((row) => row.username);
}

export function createAdminVisibility(db: Database.Database, actor: { username: string; role: Role }): AdminVisibility {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new Error("admin role required");
  }
  return {
    actorUsername: actor.username,
    actorRole: actor.role,
    visibleOwnerUsernames: listAdminVisibleOwners(db, actor.role),
    includeUnownedIndexIssues: actor.role === "super_admin",
  };
}
