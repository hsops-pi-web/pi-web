import { NextResponse } from "next/server";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "@/lib/auth/db";
import { getProcessLifecycle } from "@/lib/process-lifecycle";
import { readReleaseMetadata, runtimeIdentity } from "@/lib/release-metadata";

export const runtime = "nodejs";

function checkDatabase(): boolean {
  try {
    getDb().prepare("SELECT 1 AS ok").get();
    return true;
  } catch {
    return false;
  }
}

function checkDataRoots(): boolean {
  try {
    for (const path of [
      join(homedir(), ".pi-web-auth"),
      join(homedir(), "pi-users"),
      join(homedir(), ".pi", "agent"),
    ]) {
      accessSync(path, constants.R_OK | constants.W_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export function GET() {
  const identity = runtimeIdentity();
  const checks = {
    lifecycle: getProcessLifecycle().state === "running",
    database: checkDatabase(),
    dataRoots: checkDataRoots(),
    release: process.env.NODE_ENV !== "production" || readReleaseMetadata() !== null,
  };
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", ...identity, checks },
    { status: ready ? 200 : 503 },
  );
}
