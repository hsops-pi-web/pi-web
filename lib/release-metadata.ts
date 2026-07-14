import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ReleaseMetadata {
  releaseId: string;
  commit: string;
}

export function readReleaseMetadata(root = process.cwd()): ReleaseMetadata | null {
  try {
    const value = JSON.parse(readFileSync(join(root, "release.json"), "utf8")) as Record<string, unknown>;
    if (typeof value.releaseId !== "string" || !/^\d{8}-\d{6}-[0-9a-f]{7,}$/.test(value.releaseId)) return null;
    if (typeof value.commit !== "string" || !/^[0-9a-f]{40}$/.test(value.commit)) return null;
    return { releaseId: value.releaseId, commit: value.commit };
  } catch {
    return null;
  }
}

export function runtimeIdentity(): ReleaseMetadata {
  return readReleaseMetadata() ?? {
    releaseId: process.env.NODE_ENV === "production" ? "invalid" : "development",
    commit: "unknown",
  };
}
