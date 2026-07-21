"use client";

import type { SessionInfo } from "@/lib/types";
import type { SessionTreeNode } from "./types";
import { SessionRow } from "./SessionRow";

interface Props {
  nodes: SessionTreeNode[];
  selectedSessionId: string | null;
  selectedIds: Set<string>;
  onSelect(session: SessionInfo): void;
  onToggleSelected(sessionId: string, selected: boolean): void;
  onFavorite(session: SessionInfo): void;
  onArchive(session: SessionInfo): void;
}

export function SessionTree({ nodes, selectedSessionId, selectedIds, onSelect, onToggleSelected, onFavorite, onArchive }: Props) {
  const renderNode = (node: SessionTreeNode, depth: number) => (
    <div key={node.session.id}>
      <SessionRow
        session={node.session}
        selected={node.session.id === selectedSessionId}
        checked={selectedIds.has(node.session.id)}
        depth={depth}
        onSelect={() => onSelect(node.session)}
        onCheckedChange={(checked) => onToggleSelected(node.session.id, checked)}
        onFavorite={() => onFavorite(node.session)}
        onArchive={() => onArchive(node.session)}
      />
      {node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );
  return <>{nodes.map((node) => renderNode(node, 0))}</>;
}
