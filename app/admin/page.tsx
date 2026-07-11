"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileExplorer } from "@/components/FileExplorer";
import { FileViewer } from "@/components/FileViewer";
import { MessageView } from "@/components/MessageView";
import { canManage, type Role } from "@/lib/auth/roles";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";

interface AdminUser {
  username: string;
  role: Role;
  disabled: number;
  created_at: string;
}

interface AdminSession {
  id: string;
  name?: string;
  firstMessage: string;
  modified: string;
}

interface AdminSessionDetail {
  context: { messages: AgentMessage[]; entryIds?: string[] };
  cwd: string;
  modified: string;
}

type LoadState = "loading" | "ok" | "forbidden" | "error";

const buttonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontSize: 11,
  lineHeight: 1,
  padding: "6px 8px",
} as const;

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? fallback;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersState, setUsersState] = useState<"loading" | "ok" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"files" | "chats">("files");
  const [openFile, setOpenFile] = useState<{ path: string; name: string } | null>(null);
  const [meRole, setMeRole] = useState<Role | null>(null);
  const [meUsername, setMeUsername] = useState<string | null>(null);
  const [userRoot, setUserRoot] = useState("");
  const [fileState, setFileState] = useState<LoadState>("loading");
  const [pendingUser, setPendingUser] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users");
      if (response.status === 401 || response.status === 403) {
        window.location.href = "/";
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "加载失败"));
      const data = (await response.json()) as { users?: AdminUser[] };
      const nextUsers = data.users ?? [];
      setUsers(nextUsers);
      setSelected((current) => current ?? nextUsers[0]?.username ?? null);
      setUsersState("ok");
    } catch {
      setUsersState("error");
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { username?: string; role?: Role } | null) => {
        if (data?.username) setMeUsername(data.username);
        if (data?.role) setMeRole(data.role);
      })
      .catch(() => undefined);
    loadUsers();
  }, [loadUsers]);

  const adminBase = selected
    ? `/api/admin/files/${encodeURIComponent(selected)}`
    : "/api/files";
  const selectedUser = users.find((user) => user.username === selected) ?? null;
  const isSuperAdmin = meRole === "super_admin";

  useEffect(() => {
    if (!selected) {
      setUserRoot("");
      setFileState("loading");
      return;
    }

    let cancelled = false;
    setOpenFile(null);
    setUserRoot("");
    setFileState("loading");
    fetch(`/api/admin/files/${encodeURIComponent(selected)}?type=list`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 403) {
          setFileState("forbidden");
          return;
        }
        if (!response.ok) {
          setFileState("error");
          return;
        }
        const data = (await response.json().catch(() => null)) as { path?: string } | null;
        if (cancelled) return;
        if (data?.path) {
          setUserRoot(data.path);
          setFileState("ok");
        } else {
          setFileState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setFileState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const toggleDisabled = async (user: AdminUser) => {
    setPendingUser(user.username);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.username)}/disable`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disabled: user.disabled ? 0 : 1 }),
        }
      );
      if (!response.ok) {
        alert(await responseError(response, "操作失败"));
        return;
      }
      await loadUsers();
    } catch {
      alert("操作失败，请重试");
    } finally {
      setPendingUser(null);
    }
  };

  const deleteUser = async (user: AdminUser) => {
    if (
      !confirm(
        `彻底删除用户 ${user.username}？将连带删除其工作目录与全部对话，不可恢复`
      )
    ) {
      return;
    }
    setPendingUser(user.username);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.username)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        alert(await responseError(response, "删除失败"));
        return;
      }
      if (selected === user.username) setSelected(null);
      await loadUsers();
    } catch {
      alert("删除失败，请重试");
    } finally {
      setPendingUser(null);
    }
  };

  const changeRole = async (user: AdminUser, role: "user" | "admin") => {
    setPendingUser(user.username);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.username)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      if (!response.ok) {
        alert(await responseError(response, "修改角色失败"));
        return;
      }
      await loadUsers();
    } catch {
      alert("修改角色失败，请重试");
    } finally {
      setPendingUser(null);
    }
  };

  return (
    <main
      className="max-md:flex-col"
      style={{
        display: "flex",
        height: "100dvh",
        minWidth: 0,
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <aside
        className="max-md:h-[42dvh] max-md:w-full"
        style={{
          width: 320,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border)",
          background: "var(--bg-panel)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            height: 44,
            padding: "0 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <strong style={{ fontSize: 14 }}>用户管理</strong>
          <a href="/" style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none" }}>
            返回工作台
          </a>
        </header>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {usersState === "loading" && <StateMessage>加载中...</StateMessage>}
          {usersState === "error" && <StateMessage error>加载失败，请重试</StateMessage>}
          {usersState === "ok" && users.length === 0 && <StateMessage>暂无用户</StateMessage>}
          {users.map((user) => {
            const canManageTarget =
              meRole !== null &&
              meUsername !== null &&
              user.username !== meUsername &&
              canManage(meRole, user.role);
            const canChangeTarget =
              isSuperAdmin && user.role !== "super_admin" && user.username !== meUsername;
            const isPending = pendingUser === user.username;
            return (
              <div
                key={user.username}
                onClick={() => setSelected(user.username)}
                style={{
                  padding: "10px 14px",
                  cursor: "pointer",
                  background: selected === user.username ? "var(--bg-selected)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {user.username}
                  </span>
                  <RoleBadge role={user.role} />
                  {user.disabled === 1 && (
                    <span style={{ color: "var(--err)", fontSize: 10 }}>已禁用</span>
                  )}
                </div>
                <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 10 }}>
                  {new Date(user.created_at).toLocaleString()}
                </div>
                <div
                  onClick={(event) => event.stopPropagation()}
                  style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}
                >
                  <ActionButton
                    disabled={!canManageTarget || isPending}
                    onClick={() => toggleDisabled(user)}
                  >
                    {user.disabled ? "启用" : "禁用"}
                  </ActionButton>
                  <ActionButton
                    danger
                    disabled={!canManageTarget || isPending}
                    onClick={() => deleteUser(user)}
                  >
                    删除
                  </ActionButton>
                  {canChangeTarget && (
                    <ActionButton
                      disabled={isPending}
                      onClick={() => changeRole(user, user.role === "admin" ? "user" : "admin")}
                    >
                      {user.role === "admin" ? "取消管理员" : "设为管理员"}
                    </ActionButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {!selected ? (
          <StateMessage centered>选择一个用户查看其文件与对话</StateMessage>
        ) : (
          <>
            <header
              style={{
                minHeight: 44,
                padding: "0 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-panel)",
              }}
            >
              <strong style={{ fontSize: 13 }}>{selected}</strong>
              {selectedUser && <RoleBadge role={selectedUser.role} />}
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <TabButton active={tab === "files"} onClick={() => setTab("files")}>
                  文件
                </TabButton>
                <TabButton active={tab === "chats"} onClick={() => setTab("chats")}>
                  对话
                </TabButton>
              </div>
            </header>

            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              {tab === "files" ? (
                <div className="max-sm:flex-col" style={{ display: "flex", height: "100%", minHeight: 0 }}>
                  <div
                    className="max-sm:h-[36%] max-sm:w-full"
                    style={{
                      width: 280,
                      flexShrink: 0,
                      overflow: "auto",
                      borderRight: "1px solid var(--border)",
                      borderBottom: "1px solid var(--border)",
                      background: "var(--bg-panel)",
                    }}
                  >
                    {fileState === "ok" && userRoot ? (
                      <FileExplorer
                        cwd={userRoot}
                        urlBase={adminBase}
                        readOnly
                        onOpenFile={(filePath, name) => setOpenFile({ path: filePath, name })}
                      />
                    ) : fileState === "forbidden" ? (
                      <StateMessage error>无权限查看该用户内容</StateMessage>
                    ) : fileState === "error" ? (
                      <StateMessage error>加载失败，请重试</StateMessage>
                    ) : (
                      <StateMessage>加载中...</StateMessage>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
                    {openFile ? (
                      <FileViewer
                        filePath={openFile.path}
                        cwd={userRoot}
                        urlBase={adminBase}
                        readOnly
                      />
                    ) : (
                      <StateMessage centered>选择文件查看</StateMessage>
                    )}
                  </div>
                </div>
              ) : (
                <AdminChats username={selected} />
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function AdminChats({ username }: { username: string }) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatState, setChatState] = useState<LoadState>("loading");
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setSessions([]);
    setDetail(null);
    setSelectedId(null);
    setChatState("loading");
    setDetailState("idle");
    fetch(`/api/admin/users/${encodeURIComponent(username)}/sessions`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 403) {
          setChatState("forbidden");
          return;
        }
        if (!response.ok) {
          setChatState("error");
          return;
        }
        const data = (await response.json().catch(() => null)) as
          | { sessions?: AdminSession[] }
          | null;
        if (!cancelled) {
          setSessions(data?.sessions ?? []);
          setChatState("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setChatState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const openSession = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailState("loading");
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(username)}/sessions/${encodeURIComponent(id)}`
      );
      if (!response.ok) {
        setDetailState("error");
        return;
      }
      setDetail((await response.json()) as AdminSessionDetail);
      setDetailState("ok");
    } catch {
      setDetailState("error");
    }
  };

  const toolResults = useMemo(() => {
    const results = new Map<string, ToolResultMessage>();
    for (const message of detail?.context.messages ?? []) {
      if (message.role === "toolResult") {
        const result = message as ToolResultMessage;
        results.set(result.toolCallId, result);
      }
    }
    return results;
  }, [detail]);

  return (
    <div className="max-sm:flex-col" style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div
        className="max-sm:h-[36%] max-sm:w-full"
        style={{
          width: 300,
          flexShrink: 0,
          overflow: "auto",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
        }}
      >
        {chatState === "loading" && <StateMessage>加载中...</StateMessage>}
        {chatState === "forbidden" && <StateMessage error>无权限查看该用户内容</StateMessage>}
        {chatState === "error" && <StateMessage error>加载失败，请重试</StateMessage>}
        {chatState === "ok" && sessions.length === 0 && <StateMessage>无对话</StateMessage>}
        {chatState === "ok" &&
          sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => openSession(session.id)}
              style={{
                width: "100%",
                padding: "9px 12px",
                display: "block",
                border: "none",
                borderBottom: "1px solid var(--border)",
                background: selectedId === session.id ? "var(--bg-selected)" : "transparent",
                color: "var(--text)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {session.name || session.firstMessage || "未命名对话"}
              </span>
              <span style={{ display: "block", marginTop: 3, color: "var(--text-dim)", fontSize: 10 }}>
                {new Date(session.modified).toLocaleString()}
              </span>
            </button>
          ))}
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "16px 0" }}>
        {detailState === "idle" && <StateMessage centered>选择一条对话查看</StateMessage>}
        {detailState === "loading" && <StateMessage centered>加载中...</StateMessage>}
        {detailState === "error" && <StateMessage centered error>加载失败，请重试</StateMessage>}
        {detailState === "ok" && detail && (
          <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px" }}>
            {detail.context.messages
              .filter((message) => message.role !== "toolResult")
              .map((message, index) => (
                <MessageView
                  key={index}
                  message={message}
                  cwd={detail.cwd}
                  toolResults={toolResults}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const color =
    role === "super_admin"
      ? "#b45309"
      : role === "admin"
        ? "var(--accent)"
        : "var(--text-muted)";
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "2px 5px",
        borderRadius: 4,
        border: "1px solid var(--border)",
        color,
        background: "var(--bg)",
        fontSize: 9,
        lineHeight: 1.2,
      }}
    >
      {role}
    </span>
  );
}

function ActionButton({
  children,
  disabled,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...buttonStyle,
        color: danger ? "var(--err)" : "var(--text)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
        background: active ? "var(--bg-selected)" : "var(--bg)",
        color: active ? "var(--text)" : "var(--text-muted)",
        padding: "6px 12px",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function StateMessage({
  children,
  centered,
  error,
}: {
  children: React.ReactNode;
  centered?: boolean;
  error?: boolean;
}) {
  return (
    <div
      style={{
        height: centered ? "100%" : undefined,
        padding: 16,
        display: centered ? "flex" : "block",
        alignItems: centered ? "center" : undefined,
        justifyContent: centered ? "center" : undefined,
        color: error ? "var(--err)" : "var(--text-dim)",
        fontSize: 12,
      }}
    >
      {children}
    </div>
  );
}
