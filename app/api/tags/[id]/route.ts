import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";

type TagPatch = {
  name?: string;
  color?: string | null;
};

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) return NextResponse.json({ error: "invalid tag id" }, { status: 400 });

    const body = await req.json() as TagPatch;
    const hasName = typeof body.name === "string";
    const hasColor = typeof body.color === "string" || body.color === null;
    if (!hasName && !hasColor) return NextResponse.json({ error: "no patch fields provided" }, { status: 400 });

    const ok = getSessionIndexStore().updateTag(username, id, { name: body.name, color: body.color });
    if (!ok) return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) return NextResponse.json({ error: "invalid tag id" }, { status: 400 });

    const ok = getSessionIndexStore().deleteTag(username, id);
    if (!ok) return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
