import type { ReactNode } from "react";

export function AdminTable({ children }: { children: ReactNode }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>{children}</table>
    </div>
  );
}

export function AdminTh({ children }: { children: ReactNode }) {
  return <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500 }}>{children}</th>;
}

export function AdminTd({ children }: { children: ReactNode }) {
  return <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>{children}</td>;
}
