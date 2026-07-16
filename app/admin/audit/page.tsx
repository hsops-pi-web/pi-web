"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate } from "@/components/admin/admin-ui-utils";

interface AuditEvent {
  id: number;
  actorUsername: string;
  actorRole: string;
  action: string;
  targetUsername: string | null;
  status: string;
  summary: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const query = useMemo(() => {
    const params = new URLSearchParams({ pageSize: "100" });
    if (actor) params.set("actor", actor);
    if (target) params.set("target", target);
    if (action) params.set("action", action);
    if (status) params.set("status", status);
    return params.toString();
  }, [action, actor, status, target]);

  useEffect(() => {
    setLoading(true);
    fetchJson<{ events: AuditEvent[] }>(`/api/admin/audit?${query}`)
      .then((data) => { setEvents(data.events); setError(null); })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [query]);

  return <AdminShell current="audit"><h1 style={{ fontSize: 20, margin: "0 0 16px" }}>Audit</h1><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}><input placeholder="Actor" value={actor} onChange={(event) => setActor(event.target.value)} /><input placeholder="Target" value={target} onChange={(event) => setTarget(event.target.value)} /><input placeholder="Action" value={action} onChange={(event) => setAction(event.target.value)} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Any status</option><option value="success">Success</option><option value="failure">Failure</option></select></div>{error ? <AdminError message={error} /> : loading ? <AdminLoading /> : events.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>Time</AdminTh><AdminTh>Actor</AdminTh><AdminTh>Action</AdminTh><AdminTh>Target</AdminTh><AdminTh>Status</AdminTh><AdminTh>Summary</AdminTh><AdminTh>Metadata</AdminTh></tr></thead><tbody>{events.map((event) => <tr key={event.id}><AdminTd>{formatDate(event.createdAt)}</AdminTd><AdminTd>{event.actorUsername} ({event.actorRole})</AdminTd><AdminTd>{event.action}</AdminTd><AdminTd>{event.targetUsername ?? "-"}</AdminTd><AdminTd>{event.status}</AdminTd><AdminTd>{event.summary ?? "-"}</AdminTd><AdminTd>{event.metadataJson ? <details><summary>json</summary><pre style={{ whiteSpace: "pre-wrap" }}>{event.metadataJson}</pre></details> : "-"}</AdminTd></tr>)}</tbody></AdminTable>}</AdminShell>;
}
