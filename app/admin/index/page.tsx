"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate } from "@/components/admin/admin-ui-utils";

interface IndexHealth {
  databaseAvailable: boolean;
  totalSessions: number;
  totalWorkspaces: number;
  staleCandidateCount: number;
  oldestIndexedAt: string | null;
  newestIndexedAt: string | null;
  issueCounts: { missing: number; orphaned: number; indexError: number; unowned: number };
  issues: Array<{ id: string; ownerUsername: string | null; cwd: string; missing: boolean; orphaned: boolean; indexError: string | null; modifiedAt: string }>;
}

export default function AdminIndexPage() {
  const [data, setData] = useState<IndexHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [rescanResult, setRescanResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchJson<IndexHealth>("/api/admin/index")
      .then((payload) => { setData(payload); setError(null); })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rescan = async () => {
    setRescanError(null);
    setRescanResult(null);
    try {
      const result = await fetchJson<{ stats: { scanned: number; indexed: number; unchanged: number; markedMissing: number } }>("/api/admin/index/rescan", { method: "POST" });
      setRescanResult(`scanned ${result.stats.scanned}, indexed ${result.stats.indexed}, unchanged ${result.stats.unchanged}, missing ${result.stats.markedMissing}`);
      load();
    } catch (err) {
      if ((err as { status?: number }).status === 403) setRescanError("Rescan requires super_admin");
      else setRescanError(String((err as Error).message ?? err));
    }
  };

  return <AdminShell current="index"><h1 style={{ fontSize: 20, margin: "0 0 16px" }}>Index Health</h1>{error ? <AdminError message={error} /> : loading || !data ? <AdminLoading /> : <div style={{ display: "grid", gap: 14 }}><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><strong>DB {data.databaseAvailable ? "ready" : "unavailable"}</strong><strong>Sessions {data.totalSessions}</strong><strong>Workspaces {data.totalWorkspaces}</strong><strong>Stale {data.staleCandidateCount}</strong><strong>Missing {data.issueCounts.missing}</strong><strong>Orphaned {data.issueCounts.orphaned}</strong><strong>Index errors {data.issueCounts.indexError}</strong><strong>Unowned {data.issueCounts.unowned}</strong></div><div style={{ color: "var(--text-muted)" }}>Indexed {formatDate(data.oldestIndexedAt)} - {formatDate(data.newestIndexedAt)}</div><div><button onClick={rescan}>Rescan</button>{rescanResult ? <span style={{ marginLeft: 8 }}>{rescanResult}</span> : null}{rescanError ? <span style={{ marginLeft: 8, color: "var(--text)" }}>{rescanError}</span> : null}</div><section><h2 style={{ fontSize: 15 }}>Issues</h2>{data.issues.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>Owner</AdminTh><AdminTh>Session</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Status</AdminTh><AdminTh>Modified</AdminTh></tr></thead><tbody>{data.issues.map((issue) => <tr key={issue.id}><AdminTd>{issue.ownerUsername ?? "-"}</AdminTd><AdminTd>{issue.id}</AdminTd><AdminTd>{issue.cwd}</AdminTd><AdminTd>{issue.indexError ?? (issue.missing ? "missing" : issue.orphaned ? "orphaned" : "issue")}</AdminTd><AdminTd>{formatDate(issue.modifiedAt)}</AdminTd></tr>)}</tbody></AdminTable>}</section></div>}</AdminShell>;
}
