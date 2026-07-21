import { readdirSync, statSync } from "fs";
import path from "path";

export interface ScannedSessionFile {
  path: string;
  mtimeMs: number;
}

export function scanSessionFiles(sessionsDir: string): ScannedSessionFile[] {
  const files: ScannedSessionFile[] = [];
  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(sessionsDir);
  } catch {
    return files;
  }

  for (const cwdDir of cwdDirs) {
    const dir = path.join(sessionsDir, cwdDir);
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, name);
      try {
        const fileStat = statSync(filePath);
        if (fileStat.isFile()) files.push({ path: filePath, mtimeMs: Math.floor(fileStat.mtimeMs) });
      } catch {
        continue;
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
