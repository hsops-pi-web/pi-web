"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate, issueCount } from "@/components/admin/admin-ui-utils";
import type { Role } from "@/lib/auth/roles";

interface AdminUser {
  username: string;
  role: Role;
  disabled: number;
  created_at: string;
  sessionCount: number;
  workspaceCount: number;
  missingCount: number;
  orphanedCount: number;
  indexErrorCount: number;
  lastActiveAt: string | null;
}

async function responseError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? "Operation failed";
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("last_active_desc");
  const [pending, setPending] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    fetchJson<{ users: AdminUser[] }>(`/api/admin/users?sort=${encodeURIComponent(sort)}`)
      .then((data) => { setUsers(data.users); setError(null); })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [sort]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const visibleUsers = useMemo(() => users.filter((user) => {
    if (q && !user.username.toLowerCase().includes(q.toLowerCase())) return false;
    if (role !== "all" && user.role !== role) return false;
    if (status === "enabled" && user.disabled === 1) return false;
    if (status === "disabled" && user.disabled === 0) return false;
    return true;
  }), [q, role, status, users]);

  const toggleDisabled = async (user: AdminUser) => {
    setPending(user.username);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.username)}/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: user.disabled ? 0 : 1 }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      loadUsers();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setPending(null);
    }
  };

  const deleteUser = async (user: AdminUser) => {
    if (!confirm(`Delete user ${user.username}?`)) return;
    setPending(user.username);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.username)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      loadUsers();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setPending(null);
    }
  };

  return (
    <AdminShell current="users">
      <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>Users</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search" style={{ padding: 7, background: "var(--bg-panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 5 }} />
        <select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option><option value="user">User</option><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All status</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="last_active_desc">Last active</option><option value="created_asc">Created asc</option><option value="created_desc">Created desc</option><option value="username_asc">Username</option><option value="session_count_desc">Sessions</option></select>
      </div>
      {error ? <AdminError message={error} /> : null}
      {loading ? <AdminLoading /> : visibleUsers.length === 0 ? <AdminEmpty /> : (
        <AdminTable><thead><tr><AdminTh>User</AdminTh><AdminTh>Role</AdminTh><AdminTh>Status</AdminTh><AdminTh>Last Active</AdminTh><AdminTh>Sessions</AdminTh><AdminTh>Workspaces</AdminTh><AdminTh>Issues</AdminTh><AdminTh>Actions</AdminTh></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.username}><AdminTd><Link href={`/admin/users/${encodeURIComponent(user.username)}`} style={{ color: "var(--accent)", fontWeight: 600 }}>{user.username}</Link></AdminTd><AdminTd>{user.role}</AdminTd><AdminTd>{user.disabled ? "disabled" : "enabled"}</AdminTd><AdminTd>{formatDate(user.lastActiveAt)}</AdminTd><AdminTd>{user.sessionCount}</AdminTd><AdminTd>{user.workspaceCount}</AdminTd><AdminTd>{issueCount(user)}</AdminTd><AdminTd><button disabled={pending === user.username} onClick={() => toggleDisabled(user)}>{user.disabled ? "Enable" : "Disable"}</button> <button disabled={pending === user.username} onClick={() => deleteUser(user)}>Delete</button></AdminTd></tr>)}</tbody></AdminTable>
      )}
    </AdminShell>
  );
}
