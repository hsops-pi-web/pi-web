"use client";

interface Props {
  selectedCount: number;
  onFavorite(): void;
  onArchive(): void;
  onClear(): void;
}

export function BulkSessionToolbar({ selectedCount, onFavorite, onArchive, onClear }: Props) {
  if (selectedCount === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
      <span style={{ flex: 1, fontSize: 11, color: "var(--text-muted)" }}>{selectedCount} selected</span>
      <button title="Favorite selected" onClick={onFavorite} style={{ height: 26, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)" }}>★</button>
      <button title="Archive selected" onClick={onArchive} style={{ height: 26, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)" }}>Archive</button>
      <button title="Clear selection" onClick={onClear} style={{ height: 26, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)" }}>Clear</button>
    </div>
  );
}
