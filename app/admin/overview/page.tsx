"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate, issueCount } from "@/components/admin/admin-ui-utils";

interface OverviewResponse {
  overview: {
    userStats: { total: number; enabled: number; disabled: number };
    recentUsers: Array<{ username: string; sessionCount: number; workspaceCount: number; missingCount: number; orphanedCount: number; indexErrorCount: number; lastActiveAt: string | null }>;
    recentSessions: Array<{ id: string; ownerUsername: string | null; cwd: string; title: string | null; firstMessage: string | null; modifiedAt: string }>;
    recentWorkspaces: Array<{ cwd: string; ownerUsername: string | null; sessionCount: number; lastActiveAt: string | null }>;
    recentIssues: Array<{ id: string; ownerUsername: string | null; cwd: string; missing: boolean; orphaned: boolean; indexError: string | null; modifiedAt: string }>;
  };
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12, background: "var(--bg-panel)" }}><div style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div></div>;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<OverviewResponse>("/api/admin/overview").then(setData).catch((err) => setError(String(err.message ?? err)));
  }, []);

  return (
    <AdminShell current="overview">
      <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>Overview</h1>
      {error ? <AdminError message={error} /> : !data ? <AdminLoading /> : (
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Metric label="Users" value={data.overview.userStats.total} />
            <Metric label="Enabled" value={data.overview.userStats.enabled} />
            <Metric label="Disabled" value={data.overview.userStats.disabled} />
            <Metric label="Open Issues" value={data.overview.recentIssues.length} />
          </div>
          <section>
            <h2 style={{ fontSize: 15 }}>Recent Users</h2>
            {data.overview.recentUsers.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>User</AdminTh><AdminTh>Last Active</AdminTh><AdminTh>Sessions</AdminTh><AdminTh>Workspaces</AdminTh><AdminTh>Issues</AdminTh></tr></thead><tbody>{data.overview.recentUsers.map((user) => <tr key={user.username}><AdminTd><Link href={`/admin/users/${encodeURIComponent(user.username)}`}>{user.username}</Link></AdminTd><AdminTd>{formatDate(user.lastActiveAt)}</AdminTd><AdminTd>{user.sessionCount}</AdminTd><AdminTd>{user.workspaceCount}</AdminTd><AdminTd>{issueCount(user)}</AdminTd></tr>)}</tbody></AdminTable>}
          </section>
          <section>
            <h2 style={{ fontSize: 15 }}>Recent Sessions</h2>
            {data.overview.recentSessions.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>Owner</AdminTh><AdminTh>Title</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Modified</AdminTh></tr></thead><tbody>{data.overview.recentSessions.map((session) => <tr key={session.id}><AdminTd>{session.ownerUsername ?? "-"}</AdminTd><AdminTd>{session.title ?? session.firstMessage ?? session.id}</AdminTd><AdminTd>{session.cwd}</AdminTd><AdminTd>{formatDate(session.modifiedAt)}</AdminTd></tr>)}</tbody></AdminTable>}
          </section>
          <section>
            <h2 style={{ fontSize: 15 }}>Recent Workspaces</h2>
            {data.overview.recentWorkspaces.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>Owner</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Sessions</AdminTh><AdminTh>Last Active</AdminTh></tr></thead><tbody>{data.overview.recentWorkspaces.map((workspace) => <tr key={`${workspace.ownerUsername}:${workspace.cwd}`}><AdminTd>{workspace.ownerUsername ?? "-"}</AdminTd><AdminTd>{workspace.cwd}</AdminTd><AdminTd>{workspace.sessionCount}</AdminTd><AdminTd>{formatDate(workspace.lastActiveAt)}</AdminTd></tr>)}</tbody></AdminTable>}
          </section>
        </div>
      )}
    </AdminShell>
  );
}
