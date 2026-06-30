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
