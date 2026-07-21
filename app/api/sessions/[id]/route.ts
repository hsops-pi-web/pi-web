import { NextResponse } from "next/server";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  invalidateSessionPathCache,
  buildSessionContext,
  listAllSessions,
} from "@/lib/session-reader";
import {
  getRpcSession,
  markRootDeleting,
  unmarkRootDeleting,
  waitForStartsUnderRoot,
  withCwdOperationGuard,
} from "@/lib/rpc-manager";
import { checkSessionOwnership, sessionGuardMessage } from "@/lib/auth/session-guard";
import { deleteIndexedSessionAfterFileDelete, getSessionIndexStore, scheduleIndexSessionFile } from "@/lib/session-index/service";

function ownershipDenied(status: 401 | 404): Response {
  return NextResponse.json({ error: sessionGuardMessage(status) }, { status });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const guard = await checkSessionOwnership(req, id);
    if (!guard.ok) return ownershipDenied(guard.status);
    const filePath = guard.filePath;

    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const tree = sm.getTree();
    const leafId = sm.getLeafId();
    const context = buildSessionContext(entries, leafId);

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const allSessions = await listAllSessions();
    const parentSessionId = allSessions.find((s) => s.id === id)?.parentSessionId;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
    } : null;

    const url = new URL(req.url);
    let agentState: { running: boolean; state?: unknown } | undefined;
    if (url.searchParams.has("includeState")) {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        const state = await rpc.send({ type: "get_state" });
        agentState = { running: true, state };
      } else {
        agentState = { running: false };
      }
    }

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      tree,
      leafId,
      context,
      ...(agentState !== undefined ? { agentState } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

type PatchBody = {
  name?: string;
  favorite?: boolean;
  archived?: boolean;
  customTitle?: string | null;
};

// PATCH /api/sessions/[id]  body: { name?: string, favorite?: boolean, archived?: boolean, customTitle?: string | null }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json() as PatchBody;
    const hasMetadata = typeof body.favorite === "boolean" || typeof body.archived === "boolean" || typeof body.customTitle === "string" || body.customTitle === null;
    if (body.name !== undefined && typeof body.name !== "string") return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    if (!hasMetadata && body.name === undefined) return NextResponse.json({ error: "no patch fields provided" }, { status: 400 });

    const guard = await checkSessionOwnership(req, id);
    if (!guard.ok) return ownershipDenied(guard.status);

    if (hasMetadata) {
      const ok = getSessionIndexStore().setSessionMetadata(guard.username, id, {
        favorite: body.favorite,
        archived: body.archived,
        customTitle: body.customTitle,
      });
      if (!ok) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (body.name !== undefined) {
      try {
        await withCwdOperationGuard(guard.cwd, async () => {
          const sm = SessionManager.open(guard.filePath);
          sm.appendSessionInfo(body.name!.trim());
        });
        scheduleIndexSessionFile(guard.filePath);
      } catch (error) {
        const payload = hasMetadata
          ? { error: String(error), partialFailure: "metadata_saved_name_failed" }
          : { error: String(error) };
        return NextResponse.json(payload, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const guard = await checkSessionOwnership(req, id);
    if (!guard.ok) return ownershipDenied(guard.status);
    const filePath = guard.filePath;
    markRootDeleting(guard.cwd);
    try {
      await waitForStartsUnderRoot(guard.cwd);

      // Read header before deleting to get parentSession path
      const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
      let parentSessionPath: string | undefined;
      try {
        const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
        if (header.type === "session") parentSessionPath = header.parentSession;
      } catch { /* ignore */ }

      // Re-attach all direct children to this session's parent (cascade re-parent)
      // Scan sibling files in the same directory
      const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
        for (const file of files) {
          const childPath = join(dir, file);
          try {
            const content = readFileSync(childPath, "utf8");
            const lines = content.split("\n");
            const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
            if (header.type === "session" && header.parentSession === filePath) {
              // Rewrite header with new parentSession
              header.parentSession = parentSessionPath;
              lines[0] = JSON.stringify(header);
              writeFileSync(childPath, lines.join("\n"));
            }
          } catch { /* skip malformed */ }
        }
      } catch { /* skip if dir unreadable */ }

      await getRpcSession(id)?.shutdown("quit");
      unlinkSync(filePath);
      invalidateSessionPathCache(id);
      deleteIndexedSessionAfterFileDelete(id, guard.username);
      return NextResponse.json({ ok: true });
    } finally {
      unmarkRootDeleting(guard.cwd);
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
