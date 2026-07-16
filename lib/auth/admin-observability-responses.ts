import type { Role } from "./roles";

export interface AdminUserRow {
  username: string;
  role: Role;
  disabled: number;
  created_at: string;
}

export interface UserSummary {
  sessionCount: number;
  workspaceCount: number;
  missingCount: number;
  orphanedCount: number;
  indexErrorCount: number;
  lastActiveAt: string | null;
}

export type AdminUserSort = "created_asc" | "created_desc" | "last_active_desc" | "last_active_asc" | "username_asc" | "session_count_desc";

export type AdminUserWithSummary = AdminUserRow & UserSummary;

const EMPTY_SUMMARY: UserSummary = {
  sessionCount: 0,
  workspaceCount: 0,
  missingCount: 0,
  orphanedCount: 0,
  indexErrorCount: 0,
  lastActiveAt: null,
};

export function mergeUserObservabilitySummaries(users: AdminUserRow[], summaries: Map<string, UserSummary>): AdminUserWithSummary[] {
  return users.map((user) => ({
    ...user,
    ...(summaries.get(user.username) ?? EMPTY_SUMMARY),
  }));
}

export function parseAdminUserSort(value: string | null): AdminUserSort {
  if (value === "created_desc" || value === "last_active_desc" || value === "last_active_asc" || value === "username_asc" || value === "session_count_desc") return value;
  return "created_asc";
}

export function sortAdminUsers(users: AdminUserWithSummary[], sort: AdminUserSort): AdminUserWithSummary[] {
  return [...users].sort((a, b) => {
    if (sort === "created_desc") return b.created_at.localeCompare(a.created_at) || a.username.localeCompare(b.username);
    if (sort === "username_asc") return a.username.localeCompare(b.username);
    if (sort === "session_count_desc") return b.sessionCount - a.sessionCount || a.username.localeCompare(b.username);
    if (sort === "last_active_desc" || sort === "last_active_asc") {
      if (a.lastActiveAt === null && b.lastActiveAt === null) return a.username.localeCompare(b.username);
      if (a.lastActiveAt === null) return 1;
      if (b.lastActiveAt === null) return -1;
      return sort === "last_active_desc"
        ? b.lastActiveAt.localeCompare(a.lastActiveAt) || a.username.localeCompare(b.username)
        : a.lastActiveAt.localeCompare(b.lastActiveAt) || a.username.localeCompare(b.username);
    }
    return a.created_at.localeCompare(b.created_at) || a.username.localeCompare(b.username);
  });
}

export function buildAdminOverviewResponse(input: {
  actorRole: "admin" | "super_admin";
  authUsers: AdminUserRow[];
  visibleOwnerUsernames: string[];
  overview: Record<string, unknown>;
}) {
  const scopedUsers = input.actorRole === "super_admin"
    ? input.authUsers
    : input.authUsers.filter((user) => input.visibleOwnerUsernames.includes(user.username));
  const systemRoleCounts = {
    user: scopedUsers.filter((user) => user.role === "user").length,
    admin: input.actorRole === "super_admin" ? scopedUsers.filter((user) => user.role === "admin").length : undefined,
    super_admin: input.actorRole === "super_admin" ? scopedUsers.filter((user) => user.role === "super_admin").length : undefined,
  };
  return {
    userStats: {
      total: scopedUsers.length,
      enabled: scopedUsers.filter((user) => user.disabled === 0).length,
      disabled: scopedUsers.filter((user) => user.disabled === 1).length,
      user: systemRoleCounts.user,
      admin: systemRoleCounts.admin,
      super_admin: systemRoleCounts.super_admin,
    },
    systemRoleCounts,
    ...input.overview,
  };
}
