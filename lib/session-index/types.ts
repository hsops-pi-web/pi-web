export type ArchivedFilter = "exclude" | "include" | "only";
export type OrphanedFilter = "exclude" | "include" | "only";
export type SessionSort = "modified_desc" | "modified_asc" | "created_desc" | "title_asc";
export type IndexStatus = "ready" | "building" | "stale" | "error";

export interface SessionIndexRow {
  id: string;
  path: string;
  cwd: string;
  ownerUsername: string | null;
  title: string | null;
  firstMessage: string | null;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  parentSessionId: string | null;
  parentSessionPath: string | null;
  orphaned: boolean;
  missing: boolean;
  sourceMtimeMs: number;
  indexedAt: string | null;
  indexError: string | null;
}

export interface SessionListQuery {
  username: string;
  q?: string;
  cwd?: string;
  tag?: string;
  favorite?: boolean;
  archived: ArchivedFilter;
  orphaned: OrphanedFilter;
  sort: SessionSort;
  page: number;
  pageSize: number;
}

export interface SessionSearchQuery {
  username: string;
  q: string;
  cwd?: string;
  tag?: string;
  page: number;
  pageSize: number;
}
