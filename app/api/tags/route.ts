import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSessionIndexStore } from "@/lib/session-index/service";

type TagBody = {
  name?: string;
  color?: string | null;
};

export async function GET(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json({ tags: getSessionIndexStore().listTags(username) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const username = getSessionUser(req);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await req.json() as TagBody;
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (body.color !== undefined && body.color !== null && typeof body.color !== "string") {
      return NextResponse.json({ error: "color must be a string or null" }, { status: 400 });
    }

    return NextResponse.json({ tag: getSessionIndexStore().createTag(username, { name: body.name, color: body.color }) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
