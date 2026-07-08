import { NextResponse } from "next/server";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { checkSessionOwnership } from "@/lib/auth/session-guard";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const guard = await checkSessionOwnership(req, id);
  if (!guard.ok) {
    const msg = guard.status === 401 ? "未登录" : "Session not found";
    return NextResponse.json({ error: msg }, { status: guard.status });
  }

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const cwd = SessionManager.open(guard.filePath).getHeader()?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, guard.filePath, cwd);
    const result = await session.send(body);

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
    const msg = guard.status === 401 ? "未登录" : "Session not found";
    return NextResponse.json({ error: msg }, { status: guard.status });
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
