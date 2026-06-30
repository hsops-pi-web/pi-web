// localStorage 键名
const STORAGE_KEY = "pi-web-recent-cwds";

// 最大历史记录数量
const MAX_RECENT_CWDS = 5;

// 最近目录数据结构
export interface RecentCwd {
  path: string; // 目录绝对路径
  timestamp: string; // ISO 8601 时间戳
}
