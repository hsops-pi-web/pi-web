"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate } from "@/components/admin/admin-ui-utils";

interface AdminSession {
  id: string;
  ownerUsername: string | null;
  cwd: string;
  title: string | null;
  firstMessage: string | null;
  modifiedAt: string;
  missing: boolean;
  orphaned: boolean;
  indexError: string | null;
}

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [total, setTotal] = useState(0);
  const [username, setUsername] = useState("");
  const [cwd, setCwd] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const query = useMemo(() => {
    const params = new URLSearchParams({ pageSize: "100" });
    if (username) params.set("username", username);
    if (cwd) params.set("cwd", cwd);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    return params.toString();
  }, [cwd, q, status, username]);

  useEffect(() => {
    setLoading(true);
    fetchJson<{ sessions: AdminSession[]; total: number }>(`/api/admin/sessions?${query}`)
      .then((data) => { setSessions(data.sessions); setTotal(data.total); setError(null); })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [query]);

  return <AdminShell current="sessions"><h1 style={{ fontSize: 20, margin: "0 0 16px" }}>Sessions</h1><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}><input placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} /><input placeholder="CWD prefix" value={cwd} onChange={(event) => setCwd(event.target.value)} /><input placeholder="Search" value={q} onChange={(event) => setQ(event.target.value)} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Normal</option><option value="any_issue">Any issue</option><option value="missing">Missing</option><option value="orphaned">Orphaned</option><option value="index_error">Index error</option></select></div>{error ? <AdminError message={error} /> : loading ? <AdminLoading /> : sessions.length === 0 ? <AdminEmpty /> : <><div style={{ color: "var(--text-muted)", marginBottom: 8 }}>Total {total}</div><AdminTable><thead><tr><AdminTh>Owner</AdminTh><AdminTh>Title</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Status</AdminTh><AdminTh>Modified</AdminTh></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><AdminTd>{session.ownerUsername ?? "-"}</AdminTd><AdminTd>{session.title ?? session.firstMessage ?? session.id}</AdminTd><AdminTd>{session.cwd}</AdminTd><AdminTd>{session.indexError ?? (session.missing ? "missing" : session.orphaned ? "orphaned" : "normal")}</AdminTd><AdminTd>{formatDate(session.modifiedAt)}</AdminTd></tr>)}</tbody></AdminTable></>}</AdminShell>;
}
