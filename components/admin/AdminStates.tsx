export function AdminLoading() {
  return <div style={{ color: "var(--text-muted)", padding: 16 }}>Loading...</div>;
}

export function AdminError({ message = "Load failed" }: { message?: string }) {
  return <div style={{ color: "var(--text)", padding: 16, border: "1px solid var(--border)", borderRadius: 6 }}>{message}</div>;
}

export function AdminForbidden() {
  return <div style={{ color: "var(--text-muted)", padding: 16 }}>No permission to view this content.</div>;
}

export function AdminEmpty({ message = "No data" }: { message?: string }) {
  return <div style={{ color: "var(--text-muted)", padding: 16 }}>{message}</div>;
}
