import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { keyword } = await req.json() as { keyword?: string };
  const expected = process.env.REGISTER_KEYWORD ?? "tsingmao";
  if (keyword !== expected) {
    return NextResponse.json({ error: "关键词错误" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
