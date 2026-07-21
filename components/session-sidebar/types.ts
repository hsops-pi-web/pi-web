import type { SessionInfo } from "@/lib/types";

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

export type ArchiveFilter = "exclude" | "include" | "only";

export interface WorkspaceSummary {
  cwd: string;
  displayName: string | null;
  sessionCount: number;
  lastActiveAt: string | null;
  pinned: boolean | number;
  lastOpenedAt: string | null;
}
