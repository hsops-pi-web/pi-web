import path from "path";
import os from "os";

// 内联 getUserRoot（等价 lib/auth/paths.ts）：本文件同时被 webpack 生产构建
// 与 node --test 直接加载，二者对 .ts 扩展名 import 的要求互斥，故此处不跨文件
// import，保持自包含，两条工具链都能解析。
function userRoot(username: string): string {
  return path.join(os.homedir(), "pi-users", username);
}

export function isUserRootItself(target: string, username: string): boolean {
  return path.resolve(target) === userRoot(username);
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
