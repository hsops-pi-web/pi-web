"use client";

import type { ArchiveFilter } from "./types";

interface Props {
  value: ArchiveFilter;
  onChange(value: ArchiveFilter): void;
}

const OPTIONS: Array<{ value: ArchiveFilter; label: string }> = [
  { value: "exclude", label: "Active" },
  { value: "include", label: "All" },
  { value: "only", label: "Archived" },
];

export function ArchiveViewToggle({ value, onChange }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
      {OPTIONS.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)} style={{ height: 26, border: "1px solid var(--border)", borderRadius: 6, background: value === option.value ? "var(--bg-selected)" : "var(--bg-hover)", color: value === option.value ? "var(--accent)" : "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
