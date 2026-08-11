"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminEmpty, AdminError, AdminForbidden, AdminLoading } from "@/components/admin/AdminStates";
import { AdminTable, AdminTd, AdminTh } from "@/components/admin/AdminTables";
import { fetchJson, formatDate } from "@/components/admin/admin-ui-utils";
import { FileExplorer } from "@/components/FileExplorer";
import { FileViewer } from "@/components/FileViewer";
import { useParams } from "next/navigation";

interface UserDetail {
  user: {
    username: string;
    summary: { sessionCount: number; workspaceCount: number; missingCount: number; orphanedCount: number; indexErrorCount: number; lastActiveAt: string | null };
    recentSessions: Array<{ id: string; cwd: string; title: string | null; firstMessage: string | null; modifiedAt: string }>;
    recentWorkspaces: Array<{ cwd: string; sessionCount: number; lastActiveAt: string | null }>;
    issues: Array<{ id: string; cwd: string; missing: boolean; orphaned: boolean; indexError: string | null; modifiedAt: string }>;
  };
}

interface SessionDetail {
  cwd: string;
  modified: string;
  context: {
    messages: Array<
      | { role: "user"; content: string | Array<{ type: "text"; text: string }>; timestamp?: number }
      | { role: "assistant"; content: Array<{ type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "toolCall"; toolName: string; input: Record<string, unknown> }>; model: string; provider: string; timestamp?: number }
      | { role: "toolResult"; content: Array<{ type: "text"; text: string }>; toolCallId: string; toolName?: string; timestamp?: number }
      | { role: "custom"; content: string | Array<{ type: "text"; text: string }>; customType: string; display: boolean; timestamp?: number }
    >;
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

function renderMessageText(message: SessionDetail["context"]["messages"][number]): string {
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : message.content.map((block) => block.text).join("\n");
  }
  if (message.role === "assistant") {
    return message.content.map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return block.thinking;
      return `${block.toolName} ${JSON.stringify(block.input)}`;
    }).join("\n");
  }
  if (message.role === "toolResult") {
    return message.content.map((block) => block.text).join("\n");
  }
  return typeof message.content === "string"
    ? message.content
    : message.content.map((block) => block.text).join("\n");
}

export default function AdminUserDetailPage() {
  const routeParams = useParams<{ username?: string | string[] }>();
  const rawUsername = routeParams?.username;
  const username = Array.isArray(rawUsername) ? rawUsername[0] ?? null : rawUsername ?? null;
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [browserCwd, setBrowserCwd] = useState<string | null>(null);
  const fileRoot = browserCwd ?? data?.user.recentWorkspaces[0]?.cwd ?? data?.user.recentSessions[0]?.cwd ?? null;

  useEffect(() => {
    if (!username) return;
    setData(null);
    setError(null);
    setForbidden(false);
    setSessionDetail(null);
    setSessionError(null);
    setSelectedFile(null);
    setBrowserCwd(null);
    fetchJson<UserDetail>(`/api/admin/users/${encodeURIComponent(username)}/observability`)
      .then(setData)
      .catch((err) => {
        if ((err as { status?: number }).status === 403) setForbidden(true);
        else setError(String((err as Error).message ?? err));
      });
  }, [username]);

  useEffect(() => {
    if (!data || browserCwd) return;
    const initialCwd = data.user.recentWorkspaces[0]?.cwd ?? data.user.recentSessions[0]?.cwd ?? null;
    if (initialCwd) setBrowserCwd(initialCwd);
  }, [browserCwd, data]);

  const openSession = async (sessionId: string) => {
    if (!username) return;
    setSessionLoading(true);
    setSessionError(null);
    setSelectedFile(null);
    try {
      const detail = await fetchJson<SessionDetail>(`/api/admin/users/${encodeURIComponent(username)}/sessions/${encodeURIComponent(sessionId)}`);
      setSessionDetail(detail);
      setBrowserCwd(detail.cwd);
    } catch (err) {
      setSessionError(String((err as Error).message ?? err));
    } finally {
      setSessionLoading(false);
    }
  };

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
          <section>
            <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Recent Sessions</h2>
            {data.user.recentSessions.length === 0 ? <AdminEmpty /> : (
              <AdminTable>
                <thead>
                  <tr>
                    <AdminTh>Title</AdminTh>
                    <AdminTh>CWD</AdminTh>
                    <AdminTh>Modified</AdminTh>
                    <AdminTh>Action</AdminTh>
                  </tr>
                </thead>
                <tbody>
                  {data.user.recentSessions.map((session) => (
                    <tr key={session.id}>
                      <AdminTd>{session.title ?? session.firstMessage ?? session.id}</AdminTd>
                      <AdminTd>{session.cwd}</AdminTd>
                      <AdminTd>{formatDate(session.modifiedAt)}</AdminTd>
                      <AdminTd>
                        <button onClick={() => void openSession(session.id)} disabled={sessionLoading && sessionDetail?.cwd === session.cwd}>
                          Open
                        </button>
                      </AdminTd>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            )}
          </section>
          <section>
            <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Session Detail</h2>
            {sessionError ? <AdminError message={sessionError} /> : sessionLoading && !sessionDetail ? <AdminLoading /> : sessionDetail ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--text-muted)" }}>
                  <span>{sessionDetail.cwd}</span>
                  <span>{formatDate(sessionDetail.modified)}</span>
                  <span>{sessionDetail.context.messages.length} messages</span>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {sessionDetail.context.messages.map((message, index) => (
                    <div key={`${sessionDetail.context.entryIds[index] ?? index}`} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, background: "var(--bg-panel)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{message.role}</div>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 12 }}>{renderMessageText(message)}</pre>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <AdminEmpty message="Open a session to inspect its context." />
            )}
          </section>
          <section>
            <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Files</h2>
            {fileRoot ? (
              <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
                <div style={{ border: "1px solid var(--border)", borderRadius: 6, minHeight: 360, overflow: "hidden" }}>
                  <FileExplorer
                    cwd={fileRoot}
                    urlBase={`/api/admin/files/${encodeURIComponent(data.user.username)}`}
                    readOnly
                    onOpenFile={(filePath) => setSelectedFile(filePath)}
                  />
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 6, minHeight: 360, overflow: "hidden" }}>
                  {selectedFile ? (
                    <FileViewer
                      filePath={selectedFile}
                      cwd={fileRoot}
                      readOnly
                      urlBase={`/api/admin/files/${encodeURIComponent(data.user.username)}`}
                    />
                  ) : (
                    <AdminEmpty message="Select a file to preview." />
                  )}
                </div>
              </div>
            ) : (
              <AdminEmpty message="No workspace files found for this user." />
            )}
          </section>
          <section>
            <h2 style={{ fontSize: 15 }}>Workspaces</h2>
            {data.user.recentWorkspaces.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>CWD</AdminTh><AdminTh>Sessions</AdminTh><AdminTh>Last Active</AdminTh></tr></thead><tbody>{data.user.recentWorkspaces.map((workspace) => <tr key={workspace.cwd}><AdminTd>{workspace.cwd}</AdminTd><AdminTd>{workspace.sessionCount}</AdminTd><AdminTd>{formatDate(workspace.lastActiveAt)}</AdminTd></tr>)}</tbody></AdminTable>}
          </section>
          <section>
            <h2 style={{ fontSize: 15 }}>Issues</h2>
            {data.user.issues.length === 0 ? <AdminEmpty /> : <AdminTable><thead><tr><AdminTh>Session</AdminTh><AdminTh>CWD</AdminTh><AdminTh>Status</AdminTh><AdminTh>Modified</AdminTh></tr></thead><tbody>{data.user.issues.map((issue) => <tr key={issue.id}><AdminTd>{issue.id}</AdminTd><AdminTd>{issue.cwd}</AdminTd><AdminTd>{issue.indexError ?? (issue.missing ? "missing" : issue.orphaned ? "orphaned" : "issue")}</AdminTd><AdminTd>{formatDate(issue.modifiedAt)}</AdminTd></tr>)}</tbody></AdminTable>}
          </section>
        </div>
      )}
    </AdminShell>
  );
}
