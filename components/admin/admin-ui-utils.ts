export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) {
    window.location.href = "/";
    throw new Error("Unauthorized");
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw Object.assign(new Error(data?.error ?? "Load failed"), { status: response.status });
  }
  return response.json() as Promise<T>;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function issueCount(item: { missingCount?: number; orphanedCount?: number; indexErrorCount?: number }): number {
  return (item.missingCount ?? 0) + (item.orphanedCount ?? 0) + (item.indexErrorCount ?? 0);
}
