import { NextResponse } from "next/server";
import {
  startRpcSession,
  getRpcSession,
  withCwdOperationGuard,
} from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { checkSessionOwnership, sessionGuardMessage } from "@/lib/auth/session-guard";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const guard = await checkSessionOwnership(req, id);
  if (!guard.ok) {
    return NextResponse.json({ error: sessionGuardMessage(guard.status) }, { status: guard.status });
  }

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    const running = getRpcSession(id);
    const cwd = running?.isAlive()
      ? running.cwd
      : SessionManager.open(guard.filePath).getHeader()?.cwd ?? process.cwd();

    const result = await withCwdOperationGuard(cwd, async () => {
      let session = getRpcSession(id);
      if (!session?.isAlive()) {
        const started = await startRpcSession(id, guard.filePath, cwd);
        session = started.session;
      }
      return session.send(body);
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const guard = await checkSessionOwnership(req, id);
  if (!guard.ok) {
    return NextResponse.json({ error: sessionGuardMessage(guard.status) }, { status: guard.status });
  }

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
