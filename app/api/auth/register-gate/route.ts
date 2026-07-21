import { NextResponse } from "next/server";
import { isValidRegisterKeyword } from "@/lib/auth/validate";

export async function POST(req: Request) {
  const { keyword } = await req.json() as { keyword?: string };
  if (!isValidRegisterKeyword(keyword)) {
    return NextResponse.json({ error: "关键词错误" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
