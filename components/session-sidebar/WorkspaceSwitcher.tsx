"use client";

import type { WorkspaceSummary } from "./types";
import { shortenCwd } from "./utils";

interface Props {
  workspaces: WorkspaceSummary[];
  selectedCwd: string | null;
  homeDir: string;
  open: boolean;
  customPathOpen: boolean;
  customPathValue: string;
  onToggleOpen: () => void;
  onSelect: (cwd: string) => void;
  onPin: (cwd: string, pinned: boolean) => void;
  onDefaultCwd: () => void;
  onCustomPathOpen: () => void;
  onCustomPathValueChange: (value: string) => void;
  onCommitCustomPath: () => void;
  onCancelCustomPath: () => void;
}

export function WorkspaceSwitcher(props: Props) {
  return (
    <div style={{ position: "relative" }}>
      <button onClick={props.onToggleOpen} style={{ width: "100%", display: "flex", alignItems: "center", padding: "6px 10px", background: props.selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)", border: props.selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "var(--text)", textAlign: "left" }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11, color: props.selectedCwd ? "var(--text)" : "var(--text-dim)" }} title={props.selectedCwd ?? ""}>
          {props.selectedCwd ? shortenCwd(props.selectedCwd, props.homeDir) : "Select project..."}
        </span>
      </button>
      {props.open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.10)", overflow: "hidden" }}>
          {props.workspaces.map((workspace) => (
            <div key={workspace.cwd} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)", background: workspace.cwd === props.selectedCwd ? "var(--bg-selected)" : "none" }}>
              <button onClick={() => props.onSelect(workspace.cwd)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", color: workspace.cwd === props.selectedCwd ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={workspace.cwd}>
                {workspace.displayName || shortenCwd(workspace.cwd, props.homeDir)}
              </button>
              <button onClick={() => props.onPin(workspace.cwd, !Boolean(workspace.pinned))} title={workspace.pinned ? "Unpin workspace" : "Pin workspace"} style={{ width: 24, height: 24, border: "1px solid var(--border)", background: workspace.pinned ? "var(--bg-selected)" : "var(--bg-hover)", color: workspace.pinned ? "var(--accent)" : "var(--text-muted)", borderRadius: 6, cursor: "pointer" }}>★</button>
            </div>
          ))}
          <button onClick={props.onDefaultCwd} style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", textAlign: "left", cursor: "pointer", fontSize: 12 }}>Use default directory</button>
          {props.customPathOpen ? (
            <div style={{ display: "flex", gap: 6, padding: 8 }}>
              <input value={props.customPathValue} onChange={(event) => props.onCustomPathValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onCommitCustomPath(); if (event.key === "Escape") props.onCancelCustomPath(); }} placeholder="/path/to/project" style={{ flex: 1, minWidth: 0, background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "6px 8px", fontSize: 11 }} />
              <button onClick={props.onCommitCustomPath} style={{ border: "1px solid var(--border)", background: "var(--bg-hover)", color: "var(--text)", borderRadius: 6, padding: "0 8px" }}>Go</button>
            </div>
          ) : (
            <button onClick={props.onCustomPathOpen} style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", textAlign: "left", cursor: "pointer", fontSize: 12 }}>Open path...</button>
          )}
        </div>
      )}
    </div>
  );
}
