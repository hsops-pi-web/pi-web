"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate } from "@/components/admin/admin-ui-utils";

interface AdminWorkspace {
  cwd: string;
  ownerUsername: string | null;
  displayName: string | null;
  sessionCount: number;
  lastActiveAt: string | null;
}

export default function AdminWorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [total, setTotal] = useState(0);
  const [username, setUsername] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const query = useMemo(() => {
    const params = new URLSearchParams({ pageSize: "100" });
    if (username) params.set("username", username);
    if (q) params.set("q", q);
    return params.toString();
  }, [q, username]);

  useEffect(() => {
    setLoading(true);
    fetchJson<{ workspaces: AdminWorkspace[]; total: number }>(`/api/admin/workspaces?${query}`)
      .then((data) => { setWorkspaces(data.workspaces); setTotal(data.total); setError(null); })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [query]);

  return <AdminShell current="workspaces"><h1 style={{ fontSize: 20, margin: "0 0 16px" }}>Workspaces</h1><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}><input placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} /><input placeholder="Search cwd" value={q} onChange={(event) => setQ(event.target.value)} /></div>{error ? <AdminError message={error} /> : loading ? <AdminLoading /> : workspaces.length === 0 ? <AdminEmpty /> : <><div style={{ color: "var(--text-muted)", marginBottom: 8 }}>Total {total}</div><AdminTable><thead><tr><AdminTh>Owner</AdminTh><AdminTh>Name</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Sessions</AdminTh><AdminTh>Last Active</AdminTh></tr></thead><tbody>{workspaces.map((workspace) => <tr key={`${workspace.ownerUsername}:${workspace.cwd}`}><AdminTd>{workspace.ownerUsername ?? "-"}</AdminTd><AdminTd>{workspace.displayName ?? "-"}</AdminTd><AdminTd>{workspace.cwd}</AdminTd><AdminTd>{workspace.sessionCount}</AdminTd><AdminTd>{formatDate(workspace.lastActiveAt)}</AdminTd></tr>)}</tbody></AdminTable></>}</AdminShell>;
}
