"use client";

import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  ["overview", "Overview", "/admin/overview"],
  ["users", "Users", "/admin/users"],
  ["sessions", "Sessions", "/admin/sessions"],
  ["workspaces", "Workspaces", "/admin/workspaces"],
  ["index", "Index Health", "/admin/index"],
  ["audit", "Audit", "/admin/audit"],
] as const;

export function AdminShell({ current, children }: { current: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", gridTemplateColumns: "220px 1fr", background: "var(--bg)", color: "var(--text)" }}>
      <aside style={{ borderRight: "1px solid var(--border)", background: "var(--bg-panel)", padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 16 }}>Admin</div>
        <nav style={{ display: "grid", gap: 4 }}>
          {NAV.map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                color: "var(--text)",
                textDecoration: "none",
                background: current === key ? "var(--bg-selected)" : "transparent",
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link href="/" style={{ display: "block", marginTop: 20, color: "var(--accent)", textDecoration: "none" }}>Back to app</Link>
      </aside>
      <section style={{ minWidth: 0, overflow: "auto", padding: 20 }}>{children}</section>
    </main>
  );
}
