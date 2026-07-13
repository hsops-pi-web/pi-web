import fs, { lstatSync, rmSync, unlinkSync } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { resolveExistingAndCheck, resolveParentAndCheck } from "@/lib/auth/paths";
import { getSessionUser } from "@/lib/auth/session";
import { listAllSessions } from "@/lib/session-reader";
import { isPathInUse, isUserRootItself } from "./delete-helpers";
import {
  downloadFile,
  filePathFromSegments,
  getAudioMime,
  getImageMime,
  getLanguage,
  IMAGE_PREVIEW_MAX_BYTES,
  streamFile,
  TEXT_PREVIEW_MAX_BYTES,
} from "./file-serve";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".git",
]);

const IGNORED_SUFFIXES = [".pyc"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);
    const type = request.nextUrl.searchParams.get("type") ?? "list";

    const username = getSessionUser(request);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!resolveExistingAndCheck(filePath, username)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (type === "read") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      const imageMime = getImageMime(filePath);
      if (imageMime) {
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
          return NextResponse.json({ error: "Image too large (>10MB)" }, { status: 413 });
        }
        return streamFile(filePath, stat, imageMime, request.headers.get("range"));
      }
      const audioMime = getAudioMime(filePath);
      if (audioMime) {
        return streamFile(filePath, stat, audioMime, request.headers.get("range"));
      }
      if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
        return NextResponse.json({ error: "File too large for preview (>256KB)" }, { status: 413 });
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

    if (type === "watch") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      let watcher: fs.FSWatcher | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const send = (eventName: string, data: Record<string, unknown>) => {
            const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            try {
              controller.enqueue(new TextEncoder().encode(payload));
            } catch {
              // Client disconnected.
            }
          };
          send("connected", { filePath });
          try {
            watcher = fs.watch(filePath, () => {
              try {
                const currentStat = fs.statSync(filePath);
                send("change", {
                  mtime: currentStat.mtime.toISOString(),
                  size: currentStat.size,
                });
              } catch {
                send("change", { mtime: new Date().toISOString(), size: 0 });
              }
            });
            watcher.on("error", () => {
              try {
                controller.close();
              } catch {
                // Ignore an already closed stream.
              }
            });
          } catch {
            send("error", { message: "Failed to watch file" });
            controller.close();
          }
        },
        cancel() {
          try {
            watcher?.close();
          } catch {
            // Ignore close errors after disconnect.
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const entries = fs
      .readdirSync(filePath)
      .filter(
        (name) =>
          !IGNORED_NAMES.has(name) &&
          !IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix))
      )
      .map((name) => {
        const fullPath = path.join(filePath, name);
        try {
          const childStat = fs.statSync(fullPath);
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
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const username = getSessionUser(request);
    if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);
    if (!resolveParentAndCheck(filePath, username)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (isUserRootItself(filePath, username)) {
      return NextResponse.json({ error: "不能删除用户根目录" }, { status: 403 });
    }

    const force = request.nextUrl.searchParams.get("force") === "1";
    if (!force) {
      const cwds = (await listAllSessions())
        .map((session) => session.cwd)
        .filter((cwd): cwd is string => Boolean(cwd));
      if (isPathInUse(filePath, cwds)) {
        return NextResponse.json({ needConfirm: true, reason: "in_use" });
      }
    }

    let stat;
    try {
      stat = lstatSync(filePath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (stat.isSymbolicLink()) unlinkSync(filePath);
    else if (stat.isDirectory()) rmSync(filePath, { recursive: true });
    else rmSync(filePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
