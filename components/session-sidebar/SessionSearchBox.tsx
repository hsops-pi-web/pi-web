"use client";

interface Props {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  searching: boolean;
}

export function SessionSearchBox({ value, onChange, onSubmit, searching }: Props) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search sessions"
        style={{ flex: 1, minWidth: 0, height: 30, boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", padding: "0 8px", fontSize: 12 }}
      />
      <button type="submit" disabled={searching} title="Search" style={{ width: 32, height: 30, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: searching ? "default" : "pointer" }}>
        {searching ? "..." : "⌕"}
      </button>
    </form>
  );
}
