// localStorage 键名
const STORAGE_KEY = "pi-web-recent-cwds";

// 最大历史记录数量
const MAX_RECENT_CWDS = 5;

// 最近目录数据结构
export interface RecentCwd {
  path: string; // 目录绝对路径
  timestamp: string; // ISO 8601 时间戳
}

/**
 * 从 localStorage 获取所有最近目录
 * 按时间戳降序排列
 */
export function getAll(): RecentCwd[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      console.warn("[recent-cwds] Invalid data format, clearing storage");
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    // 验证每个项的结构
    const valid = data.filter((item): item is RecentCwd => {
      return (
        item &&
        typeof item === "object" &&
        typeof item.path === "string" &&
        typeof item.timestamp === "string"
      );
    });

    // 如果有无效项，更新存储
    if (valid.length < data.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    }

    return valid.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch (e) {
    console.warn("[recent-cwds] Failed to read from localStorage:", e);
    // localStorage 不可用，降级为空数组
    return [];
  }
}

/**
 * 添加一个目录到历史记录
 * - 如果已存在，移到开头并更新时间戳
 * - 保持最多 MAX_RECENT_CWDS 个记录
 * @param path 目录路径
 * @returns 更新后的目录列表
 */
export function add(path: string): RecentCwd[] {
  if (!path || typeof path !== "string" || !isValidPath(path)) {
    console.warn("[recent-cwds] Invalid path:", path);
    return getAll();
  }

  const current = getAll();
  const now = new Date().toISOString();

  // 移除已存在的相同路径
  const filtered = current.filter((item) => item.path !== path);

  // 添加到开头
  const updated: RecentCwd[] = [
    { path, timestamp: now },
    ...filtered,
  ];

  // 限制数量
  const limited = updated.slice(0, MAX_RECENT_CWDS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
  } catch (e) {
    console.warn("[recent-cwds] Failed to save to localStorage:", e);
  }

  return limited;
}

/**
 * 删除指定目录
 * @param path 要删除的目录路径
 * @returns 更新后的目录列表
 */
export function remove(path: string): RecentCwd[] {
  const current = getAll();
  const filtered = current.filter((item) => item.path !== path);

  try {
    if (filtered.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch (e) {
    console.warn("[recent-cwds] Failed to update localStorage:", e);
  }

  return filtered;
}

/**
 * 清空所有最近目录记录
 */
export function clear(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("[recent-cwds] Failed to clear localStorage:", e);
  }
}

/**
 * 验证路径是否合法
 * @param path 要验证的路径
 * @returns true=合法, false=不合法
 */
function isValidPath(path: string): boolean {
  if (path.length > 500) return false;
  if (path.includes('..')) return false;
  return true;
}

/**
 * 验证目录是否存在且有效
 * @param path 要验证的目录路径
 * @returns true=有效, false=无效, undefined=验证失败(网络错误等)
 */
export async function validate(path: string): Promise<boolean | undefined> {
  try {
    const response = await fetch("/api/default-cwd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: path }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return typeof data.cwd === "string";
  } catch (e) {
    console.warn("[recent-cwds] Failed to validate directory:", path, e);
    return undefined;
  }
}
