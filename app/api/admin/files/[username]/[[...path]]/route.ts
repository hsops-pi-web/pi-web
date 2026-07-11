import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";
import { getUserRoot, resolveExistingAndCheck } from "@/lib/auth/paths";
import {
  downloadFile,
  filePathFromSegments,
  getAudioMime,
  getImageMime,
  getLanguage,
  IMAGE_PREVIEW_MAX_BYTES,
  streamFile,
  TEXT_PREVIEW_MAX_BYTES,
} from "@/app/api/files/[...path]/file-serve";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string; path?: string[] }> }
) {
  const { username, path: segments } = await params;
  const guard = guardAdminViewTarget(req, username);
  if (guard instanceof NextResponse) return guard;

  const type = req.nextUrl.searchParams.get("type") ?? "list";
  const filePath = segments?.length
    ? filePathFromSegments(segments)
    : getUserRoot(username);
  if (!resolveExistingAndCheck(filePath, username)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (type === "list") {
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a dir" }, { status: 400 });
    }
    const entries = fs
      .readdirSync(filePath)
      .map((name) => {
        const fullPath = path.join(filePath, name);
        try {
          const childStat = fs.lstatSync(fullPath);
          if (childStat.isSymbolicLink()) {
            return {
              name,
              isDir: false,
              size: 0,
              modified: childStat.mtime.toISOString(),
              isSymlink: true,
            };
          }
          return {
            name,
            isDir: childStat.isDirectory(),
            size: childStat.isFile() ? childStat.size : 0,
            modified: childStat.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a!.isDir !== b!.isDir) return a!.isDir ? -1 : 1;
        return a!.name.localeCompare(b!.name);
      });
    return NextResponse.json({ entries, path: filePath });
  }

  if (type === "read") {
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }
    const imageMime = getImageMime(filePath);
    if (imageMime) {
      if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
        return NextResponse.json(
          { error: "Image too large (>10MB)" },
          { status: 413 }
        );
      }
      return streamFile(filePath, stat, imageMime, req.headers.get("range"));
    }
    const audioMime = getAudioMime(filePath);
    if (audioMime) {
      return streamFile(filePath, stat, audioMime, req.headers.get("range"));
    }
    if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large for preview (>256KB)" },
        { status: 413 }
      );
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ content, language: getLanguage(filePath), size: stat.size });
  }

  if (type === "download") {
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }
    return downloadFile(filePath, stat);
  }

  return NextResponse.json({ error: "Unsupported type" }, { status: 400 });
}
