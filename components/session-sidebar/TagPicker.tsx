"use client";

interface Tag { id: number; name: string; color: string | null }

export function TagPicker({ tags, onToggleTag }: { tags: Tag[]; onToggleTag(tagId: number): void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {tags.map((tag) => <button key={tag.id} onClick={() => onToggleTag(tag.id)} style={{ border: "1px solid var(--border)", borderRadius: 6, background: tag.color ?? "var(--bg-hover)", color: "var(--text-muted)", fontSize: 11 }}>{tag.name}</button>)}
    </div>
  );
}
