import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { NextResponse } from "next/server";
import { DEFAULT_MAX_COUNT, DEFAULT_MAX_FILE_MB, isAcceptedDoc } from "@/lib/upload";

function expandHomePath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return `${homedir()}${p.slice(1)}`;
  return p;
}

function maxFileBytes(): number {
  const mb = Number(process.env.PI_WEB_UPLOAD_MAX_MB) || DEFAULT_MAX_FILE_MB;
  return mb * 1024 * 1024;
}

function maxCount(): number {
  return Number(process.env.PI_WEB_UPLOAD_MAX_COUNT) || DEFAULT_MAX_COUNT;
}

function uniquePath(dir: string, name: string): string {
  const base = path.basename(name);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = path.join(dir, base);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${stem}(${i})${ext}`);
    i += 1;
  }
  return candidate;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const rawCwd = form.get("cwd");
    if (typeof rawCwd !== "string" || !rawCwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const cwd = expandHomePath(rawCwd);
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${rawCwd}` }, { status: 400 });
    }

    const files = form.getAll("files").filter((file): file is File => file instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (files.length > maxCount()) {
      return NextResponse.json({ error: `Too many files (max ${maxCount()})` }, { status: 400 });
    }

    const limit = maxFileBytes();
    for (const file of files) {
      if (!isAcceptedDoc(file.name)) {
        return NextResponse.json({ error: `Unsupported file type: ${file.name}` }, { status: 400 });
      }
      if (file.size > limit) {
        return NextResponse.json(
          { error: `File too large: ${file.name} (max ${limit / (1024 * 1024)} MB)` },
          { status: 400 },
        );
      }
    }

    const uploadsDir = path.join(cwd, "uploads");
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
    const uploadsResolved = path.resolve(uploadsDir);

    const paths: string[] = [];
    for (const file of files) {
      const dest = uniquePath(uploadsDir, file.name);
      if (!path.resolve(dest).startsWith(uploadsResolved + path.sep)) {
        return NextResponse.json({ error: `Invalid file name: ${file.name}` }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(dest, buf);
      paths.push(`uploads/${path.basename(dest)}`);
    }

    return NextResponse.json({ success: true, paths });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
