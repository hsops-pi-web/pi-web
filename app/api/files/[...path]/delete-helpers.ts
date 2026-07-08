import path from "path";
import { getUserRoot } from "../../../../lib/auth/paths.ts";

export function isUserRootItself(target: string, username: string): boolean {
  return path.resolve(target) === getUserRoot(username);
}

// target 与任一使用中 cwd 存在祖先/后代/相等关系，即视为使用中。
export function isPathInUse(target: string, sessionCwds: string[]): boolean {
  const t = path.resolve(target);
  return sessionCwds.some((raw) => {
    const c = path.resolve(raw);
    if (t === c) return true;
    if (t.startsWith(c + path.sep)) return true; // target 在 cwd 内
    if (c.startsWith(t + path.sep)) return true; // cwd 在 target 内
    return false;
  });
}
