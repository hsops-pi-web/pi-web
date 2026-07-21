"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminForbidden, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate } from "@/components/admin/admin-ui-utils";

interface UserDetail {
  user: {
    username: string;
    summary: { sessionCount: number; workspaceCount: number; missingCount: number; orphanedCount: number; indexErrorCount: number; lastActiveAt: string | null };
    recentSessions: Array<{ id: string; cwd: string; title: string | null; firstMessage: string | null; modifiedAt: string }>;
    recentWorkspaces: Array<{ cwd: string; sessionCount: number; lastActiveAt: string | null }>;
    issues: Array<{ id: string; cwd: string; missing: boolean; orphaned: boolean; indexError: string | null; modifiedAt: string }>;
  };
}

export default function AdminUserDetailPage({ params }: { params: Promise<{ username: string }> }) {
  const [username, setUsername] = useState<string | null>(null);
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    params.then(({ username }) => setUsername(username));
  }, [params]);

  useEffect(() => {
    if (!username) return;
    fetchJson<UserDetail>(`/api/admin/users/${encodeURIComponent(username)}/observability`)
      .then(setData)
      .catch((err) => {
        if ((err as { status?: number }).status === 403) setForbidden(true);
        else setError(String((err as Error).message ?? err));
      });
  }, [username]);

  return (
    <AdminShell current="users">
      <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>{username ?? "User"}</h1>
      {forbidden ? <AdminForbidden /> : error ? <AdminError message={error} /> : !data ? <AdminLoading /> : (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <strong>Sessions {data.user.summary.sessionCount}</strong>
            <strong>Workspaces {data.user.summary.workspaceCount}</strong>
            <strong>Last Active {formatDate(data.user.summary.lastActiveAt)}</strong>
          </div>
          <section><h2 style={{ fontSize: 15 }}>Recent Sessions</h2>{data.user.recentSessions.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>Title</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Modified</AdminTh></tr></thead><tbody>{data.user.recentSessions.map((session) => <tr key={session.id}><AdminTd>{session.title ?? session.firstMessage ?? session.id}</AdminTd><AdminTd>{session.cwd}</AdminTd><AdminTd>{formatDate(session.modifiedAt)}</AdminTd></tr>)}</tbody></AdminTable>}</section>
          <section><h2 style={{ fontSize: 15 }}>Workspaces</h2>{data.user.recentWorkspaces.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>CWD</AdminTh><AdminTh>Sessions</AdminTh><AdminTh>Last Active</AdminTh></tr></thead><tbody>{data.user.recentWorkspaces.map((workspace) => <tr key={workspace.cwd}><AdminTd>{workspace.cwd}</AdminTd><AdminTd>{workspace.sessionCount}</AdminTd><AdminTd>{formatDate(workspace.lastActiveAt)}</AdminTd></tr>)}</tbody></AdminTable>}</section>
          <section><h2 style={{ fontSize: 15 }}>Issues</h2>{data.user.issues.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>Session</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Status</AdminTh><AdminTh>Modified</AdminTh></tr></thead><tbody>{data.user.issues.map((issue) => <tr key={issue.id}><AdminTd>{issue.id}</AdminTd><AdminTd>{issue.cwd}</AdminTd><AdminTd>{issue.indexError ?? (issue.missing ? "missing" : issue.orphaned ? "orphaned" : "issue")}</AdminTd><AdminTd>{formatDate(issue.modifiedAt)}</AdminTd></tr>)}</tbody></AdminTable>}</section>
        </div>
      )}
    </AdminShell>
  );
}
