"use client";

interface Tag {
  id: number;
  name: string;
  color: string | null;
}

interface Props {
  favoriteOnly: boolean;
  onFavoriteOnlyChange(value: boolean): void;
  selectedTag: string | null;
  tags: Tag[];
  onTagChange(value: string | null): void;
}

export function SessionFilterBar({ favoriteOnly, onFavoriteOnlyChange, selectedTag, tags, onTagChange }: Props) {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <button onClick={() => onFavoriteOnlyChange(!favoriteOnly)} title="Filter starred sessions" style={{ height: 26, border: "1px solid var(--border)", borderRadius: 6, background: favoriteOnly ? "var(--bg-selected)" : "var(--bg-hover)", color: favoriteOnly ? "var(--accent)" : "var(--text-muted)", padding: "0 8px", fontSize: 11, cursor: "pointer" }}>★</button>
      <select value={selectedTag ?? ""} onChange={(event) => onTagChange(event.target.value || null)} style={{ flex: 1, minWidth: 0, height: 26, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", fontSize: 11 }}>
        <option value="">All tags</option>
        {tags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
      </select>
    </div>
  );
}
