"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/client-auth-fetch";
import { BUILTIN_TOOL_NAMES, type ToolPresetDefinition } from "@/lib/tool-presets";

interface ToolPresetsResponse {
  builtins: ToolPresetDefinition[];
  custom: ToolPresetDefinition[];
  defaultPresetId: string | null;
  error?: string;
}

const checkboxStyle = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 12,
  color: "var(--text-muted)",
} satisfies React.CSSProperties;

export function ToolPresetManager() {
  const [data, setData] = useState<ToolPresetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>(["read", "bash", "edit", "write"]);
  const [saving, setSaving] = useState(false);

  const presets = useMemo(() => [...(data?.builtins ?? []), ...(data?.custom ?? [])], [data]);
  const defaultPresetId = data?.defaultPresetId ?? "default";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/tool-presets");
      const body = await res.json() as ToolPresetsResponse;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) => prev.includes(toolName)
      ? prev.filter((item) => item !== toolName)
      : [...prev, toolName]);
  };

  const createPreset = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/tool-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, toolNames: selectedTools }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setName("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (presetId: string) => {
    setError(null);
    const res = await authFetch("/api/tool-presets/default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
    const body = await res.json() as { error?: string };
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    await load();
  };

  const deletePreset = async (presetId: string) => {
    setError(null);
    const res = await authFetch(`/api/tool-presets/${encodeURIComponent(presetId)}`, { method: "DELETE" });
    const body = await res.json() as { error?: string };
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    await load();
  };

  if (loading) return <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 13 }}>Loading tool presets...</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 18, alignItems: "start" }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {presets.map((preset, index) => {
          const isDefault = preset.id === defaultPresetId;
          return (
            <div key={preset.id} style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto auto",
              gap: 10,
              alignItems: "center",
              padding: "12px 14px",
              borderTop: index === 0 ? "none" : "1px solid var(--border)",
              background: isDefault ? "var(--bg-selected)" : "var(--bg)",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 13, color: "var(--text)" }}>{preset.name}</strong>
                  <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>{preset.scope}</span>
                  {isDefault && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>DEFAULT</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{preset.description ?? "No description"}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: 6, overflowWrap: "anywhere" }}>
                  {preset.toolNames.length ? preset.toolNames.join(" · ") : "no tools"}
                </div>
              </div>
              <button onClick={() => void setDefault(preset.id)} disabled={isDefault} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: isDefault ? "var(--bg-panel)" : "var(--bg)", color: "var(--text-muted)", cursor: isDefault ? "default" : "pointer", fontSize: 12 }}>
                Set default
              </button>
              <button onClick={() => void deletePreset(preset.id)} disabled={preset.scope === "builtin"} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: preset.scope === "builtin" ? "var(--text-dim)" : "#ef4444", cursor: preset.scope === "builtin" ? "not-allowed" : "pointer", fontSize: 12 }}>
                Delete
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-panel)" }}>
        <h3 style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>New custom preset</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name" style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 12 }} />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 12 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {BUILTIN_TOOL_NAMES.map((toolName) => (
              <label key={toolName} style={checkboxStyle}>
                <input type="checkbox" checked={selectedTools.includes(toolName)} onChange={() => toggleTool(toolName)} />
                {toolName}
              </label>
            ))}
          </div>
          <button onClick={() => void createPreset()} disabled={!name.trim() || saving} style={{ padding: "8px 11px", border: "none", borderRadius: 6, background: "var(--accent)", color: "#fff", cursor: !name.trim() || saving ? "not-allowed" : "pointer", opacity: !name.trim() || saving ? 0.55 : 1, fontSize: 12, fontWeight: 700 }}>
            {saving ? "Saving..." : "Create preset"}
          </button>
          {error && <div style={{ color: "#ef4444", fontSize: 12, lineHeight: 1.4 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
