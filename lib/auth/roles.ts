export type Role = "user" | "admin" | "super_admin";

export const SUPER_ADMIN = process.env.PI_WEB_SUPER_ADMIN_USERNAME || "admin";

export function isValidRole(value: unknown): value is Role {
  return value === "user" || value === "admin" || value === "super_admin";
}

export function isAdmin(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin(role: Role): boolean {
  return role === "super_admin";
}

export function canManage(actorRole: Role, targetRole: Role): boolean {
  if (targetRole === "super_admin") return false;
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin") return targetRole === "user";
  return false;
}

export function canChangeRole(actorRole: Role): boolean {
  return actorRole === "super_admin";
}
