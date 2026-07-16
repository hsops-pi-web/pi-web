export function AdminLoading() {
  return <div style={{ color: "var(--text-muted)", padding: 16 }}>Loading</div>;
}

export function AdminError({ message = "Unable to load data" }: { message?: string }) {
  return <div style={{ color: "var(--text)", padding: 16, border: "1px solid var(--border)", borderRadius: 6 }}>{message}</div>;
}

export function AdminEmpty({ message = "No data" }: { message?: string }) {
  return <div style={{ color: "var(--text-muted)", padding: 16 }}>{message}</div>;
}
