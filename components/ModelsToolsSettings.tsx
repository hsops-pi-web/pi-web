"use client";

import { useState } from "react";
import Link from "next/link";
import { ModelsConfig } from "./ModelsConfig";

type TabId = "models" | "defaults" | "tests";

const TABS: { id: TabId; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "defaults", label: "Defaults" },
  { id: "tests", label: "Connection tests" },
];

export function ModelsToolsSettings() {
  const [activeTab, setActiveTab] = useState<TabId>("models");

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--border)", padding: "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: 12 }}>Back to chat</Link>
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>/</span>
            <h1 style={{ margin: 0, fontSize: 18, lineHeight: 1.2 }}>Models & tools</h1>
          </div>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
            Manage model providers, model defaults, and connection checks.
          </p>
        </div>
      </header>

      <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
        <nav style={{ width: 220, borderRight: "1px solid var(--border)", padding: 12, background: "var(--bg-panel)", flexShrink: 0 }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 10px",
                  border: "none",
                  borderRadius: 6,
                  background: active ? "var(--bg-selected)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <section style={{ flex: 1, minWidth: 0, padding: 18, overflow: "auto" }}>
          {activeTab === "models" && <ModelsConfig embedded />}
          {activeTab === "defaults" && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 18, maxWidth: 720 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Defaults</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
                Personal model defaults are saved when you choose a model in chat. Global model defaults remain in the Models tab.
                Chat tool selection continues to use the existing off/default/full quick control.
              </p>
            </div>
          )}
          {activeTab === "tests" && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 18, maxWidth: 720 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Connection tests</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
                Select a provider or model in the Models tab and use its test button. This keeps the connection test attached to the exact model configuration being verified.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
