import path from "path";

export function filterJsonlUnderRoot(
  sessionCwdPairs: { file: string; cwd: string }[],
  rootDir: string
): string[] {
  const root = path.resolve(rootDir);
  const out: string[] = [];

  for (const { file, cwd } of sessionCwdPairs) {
    if (!cwd) continue;
    const resolvedCwd = path.resolve(cwd);
    if (resolvedCwd === root || resolvedCwd.startsWith(root + path.sep)) {
      out.push(file);
    }
  }

  return out;
}
