import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { isValidUsername, isValidPassword } from "@/lib/auth/validate";
import { hashPassword } from "@/lib/auth/password";
import { getUserRoot } from "@/lib/auth/paths";
import { getDb } from "@/lib/auth/db";

export async function POST(req: Request) {
  const { keyword, username, password } = await req.json() as {
    keyword?: string; username?: string; password?: string;
  };
  const expected = process.env.REGISTER_KEYWORD ?? "tsingmao";
  if (keyword !== expected) {
    return NextResponse.json({ error: "关键词错误" }, { status: 403 });
  }
  if (!username || !isValidUsername(username)) {
    return NextResponse.json({ error: "用户名不合法：字母开头，仅允许字母和数字" }, { status: 400 });
  }
  if (!password || !isValidPassword(password)) {
    return NextResponse.json({ error: "密码不合法：至少8位，含大小写字母和数字" }, { status: 400 });
  }
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM users WHERE username=?").get(username);
  if (exists) {
    return NextResponse.json({ error: "用户名已存在" }, { status: 409 });
  }
  db.prepare("INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)")
    .run(username, hashPassword(password), new Date().toISOString());
  mkdirSync(getUserRoot(username), { recursive: true });
  return NextResponse.json({ ok: true });
}
