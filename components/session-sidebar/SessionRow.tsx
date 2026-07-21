"use client";

import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime } from "./utils";

interface Props {
  session: SessionInfo;
  selected: boolean;
  checked: boolean;
  depth: number;
  onSelect(): void;
  onCheckedChange(checked: boolean): void;
  onFavorite(): void;
  onArchive(): void;
}

export function SessionRow({ session, selected, checked, depth, onSelect, onCheckedChange, onFavorite, onArchive }: Props) {
  const title = session.customTitle || session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
  return (
    <div onClick={onSelect} style={{ height: 54, display: "flex", alignItems: "center", gap: 6, paddingLeft: depth > 0 ? depth * 12 + 14 : 14, paddingRight: 8, background: selected ? "var(--bg-selected)" : "transparent", borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent", cursor: "pointer", overflow: "hidden" }}>
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} onClick={(event) => event.stopPropagation()} title="Select session" style={{ width: 14, height: 14, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={title} style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ marginTop: 2, display: "flex", gap: 8, color: "var(--text-dim)", fontSize: 11 }}>
          <span title={session.modified}>{formatRelativeTime(session.modified)}</span>
          <span>{session.messageCount} msgs</span>
          {session.orphaned && <span>orphaned</span>}
        </div>
      </div>
      <button onClick={(event) => { event.stopPropagation(); onFavorite(); }} title={session.favorite ? "Unfavorite" : "Favorite"} style={{ width: 26, height: 26, border: "1px solid var(--border)", borderRadius: 6, background: session.favorite ? "var(--bg-selected)" : "var(--bg-hover)", color: session.favorite ? "var(--accent)" : "var(--text-muted)" }}>★</button>
      <button onClick={(event) => { event.stopPropagation(); onArchive(); }} title={session.archived ? "Unarchive" : "Archive"} style={{ width: 26, height: 26, border: "1px solid var(--border)", borderRadius: 6, background: session.archived ? "var(--bg-selected)" : "var(--bg-hover)", color: session.archived ? "var(--accent)" : "var(--text-muted)", fontSize: 10 }}>A</button>
    </div>
  );
}
