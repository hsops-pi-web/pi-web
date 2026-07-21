import os from "os";
import path from "path";
import { lstatSync, realpathSync } from "fs";

export function getUserRoot(username: string): string {
  return path.join(os.homedir(), "pi-users", username);
}

export function isInsideUserRoot(target: string, username: string): boolean {
  const root = getUserRoot(username);
  const normalized = path.resolve(target);
  if (normalized === root) return true;
  return normalized.startsWith(root + path.sep);
}

// 已存在路径：对 target 本身 realpath 解析后判断（跟随 symlink 到真实位置）。
// 用于文件读取/列表、session cwd、agent cwd 等目标必然存在的场景。
// 解析失败（不存在/坏链）时 fail-closed 返 false，安全侧默认拒绝。
export function resolveExistingAndCheck(target: string, username: string): boolean {
  try {
    return isInsideUserRoot(realpathSync(target), username);
  } catch {
    return false;
  }
}

// 待删/待建路径：只解析父目录 realpath 后判断。
// target 本身可能是待删的 symlink（不能跟随，否则会判到链接目标）或尚不存在的新路径。
export function resolveParentAndCheck(target: string, username: string): boolean {
  const abs = path.resolve(target);
  const parent = path.dirname(abs);
  let resolvedParent: string;
  try {
    resolvedParent = realpathSync(parent);
  } catch {
    return false; // 父目录不存在 → 拒绝
  }
  return isInsideUserRoot(path.join(resolvedParent, path.basename(abs)), username);
}

export function canonicalizeExistingPrefix(target: string): string {
  const absolute = path.resolve(target);
  const segments = absolute.split(path.sep).filter(Boolean);

  for (let index = segments.length; index >= 0; index--) {
    const prefix = path.sep + segments.slice(0, index).join(path.sep);
    let exists = index === 0;
    if (!exists) {
      try {
        lstatSync(prefix);
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!exists) continue;

    const realPrefix = index === 0 ? path.sep : realpathSync(prefix);
    const remainder = segments.slice(index);
    return remainder.length ? path.join(realPrefix, ...remainder) : realPrefix;
  }

  return absolute;
}

export function resolveSessionOwnership(cwd: string, username: string): boolean {
  if (!cwd) return false;
  try {
    return isInsideUserRoot(canonicalizeExistingPrefix(cwd), username);
  } catch {
    return false;
  }
}
