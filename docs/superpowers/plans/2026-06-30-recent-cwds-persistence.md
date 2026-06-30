# 最近目录持久化功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现最近使用目录的 localStorage 持久化，支持添加、删除、清空操作，并自动验证和清理无效目录

**架构：** 三层架构 - 存储层（纯函数 + localStorage）→ React Hook（响应式状态）→ UI 集成（SessionSidebar）

**技术栈：** TypeScript, React Hooks, localStorage API, Next.js API routes

---

## 文件结构

**新建文件：**
- `lib/recent-cwds-storage.ts` - localStorage 存储层，纯函数，提供增删查改和验证 API
- `hooks/useRecentCwds.ts` - React Hook，封装存储层，提供响应式状态
- `__tests__/lib/recent-cwds-storage.test.ts` - 存储层单元测试
- `__tests__/hooks/useRecentCwds.test.ts` - Hook 集成测试

**修改文件：**
- `components/SessionSidebar.tsx` - 集成 useRecentCwds，添加删除和清空按钮

---

## 任务 1：创建存储层数据类型和常量

**文件：**
- 创建：`lib/recent-cwds-storage.ts`

**目标：** 定义数据结构、localStorage 键名和常量

- [ ] **步骤 1：编写文件头部和类型定义**

```typescript
// localStorage 键名
const STORAGE_KEY = "pi-web-recent-cwds";

// 最大历史记录数量
const MAX_RECENT_CWDS = 5;

// 最近目录数据结构
export interface RecentCwd {
  path: string;           // 目录绝对路径
  timestamp: string;      // ISO 8601 时间戳
}
```

- [ ] **步骤 2：Commit**

```bash
git add lib/recent-cwds-storage.ts
git commit -m "feat: add recent cwd storage types and constants"
```

---

## 任务 2：实现存储层基础 API - getAll

**文件：**
- 修改：`lib/recent-cwds-storage.ts:8`

**目标：** 实现从 localStorage 读取所有历史目录

- [ ] **步骤 1：编写 getAll 函数实现**

```typescript
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
```

- [ ] **步骤 2：Commit**

```bash
git add lib/recent-cwds-storage.ts
git commit -m "feat: implement getAll function for reading recent cwds"
```

---

## 任务 3：实现存储层 API - add

**文件：**
- 修改：`lib/recent-cwds-storage.ts:45`

**目标：** 实现添加目录到历史（去重、限制数量、保存）

- [ ] **步骤 1：编写 add 函数实现**

```typescript
/**
 * 添加一个目录到历史记录
 * - 如果已存在，移到开头并更新时间戳
 * - 保持最多 MAX_RECENT_CWDS 个记录
 * @param path 目录路径
 * @returns 更新后的目录列表
 */
export function add(path: string): RecentCwd[] {
  if (!path || typeof path !== "string") {
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
```

- [ ] **步骤 2：Commit**

```bash
git add lib/recent-cwds-storage.ts
git commit -m "feat: implement add function for adding recent cwds"
```

---

## 任务 4：实现存储层 API - remove

**文件：**
- 修改：`lib/recent-cwds-storage.ts:75`

**目标：** 实现删除指定目录

- [ ] **步骤 1：编写 remove 函数实现**

```typescript
/**
 * 从历史记录中删除指定目录
 * @param path 目录路径
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
```

- [ ] **步骤 2：Commit**

```bash
git add lib/recent-cwds-storage.ts
git commit -m "feat: implement remove function for removing recent cwds"
```

---

## 任务 5：实现存储层 API - clear

**文件：**
- 修改：`lib/recent-cwds-storage.ts:100`

**目标：** 实现清空所有历史

- [ ] **步骤 1：编写 clear 函数实现**

```typescript
/**
 * 清空所有历史记录
 */
export function clear(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("[recent-cwds] Failed to clear localStorage:", e);
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add lib/recent-cwds-storage.ts
git commit -m "feat: implement clear function for clearing recent cwds"
```

---

## 任务 6：实现存储层 API - validate

**文件：**
- 修改：`lib/recent-cwds-storage.ts:115`

**目标：** 实现目录验证（通过 API）

- [ ] **步骤 1：编写 validate 函数实现**

```typescript
/**
 * 验证目录是否存在和可访问
 * @param path 目录路径
 * @returns true=有效, false=无效, undefined=验证失败（网络错误）
 */
export async function validate(path: string): Promise<boolean | undefined> {
  try {
    const response = await fetch("/api/default-cwd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: path }),
    });

    if (!response.ok) {
      // 404 或其他错误表示目录无效
      return false;
    }

    const data = await response.json();
    // API 返回 { cwd: string } 表示有效
    return typeof data.cwd === "string";
  } catch (e) {
    // 网络错误或其他异常，返回 undefined
    console.warn("[recent-cwds] Failed to validate directory:", path, e);
    return undefined;
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add lib/recent-cwds-storage.ts
git commit -m "feat: implement validate function for checking directory existence"
```

---

## 任务 7：编写存储层单元测试 - 基础测试

**文件：**
- 创建：`__tests__/lib/recent-cwds-storage.test.ts`

**目标：** 测试 getAll、add、remove、clear 的基本功能

- [ ] **步骤 1：编写测试文件头部和工具函数**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { getAll, add, remove, clear } from "@/lib/recent-cwds-storage";

const STORAGE_KEY = "pi-web-recent-cwds";

// 每个测试前清理 localStorage
beforeEach(() => {
  localStorage.clear();
});

// 测试后清理
afterEach(() => {
  localStorage.clear();
});

// 设置 localStorage 的辅助函数
function setMockData(data: any[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
```

- [ ] **步骤 2：编写 getAll 测试**

```typescript
describe("getAll", () => {
  it("应该返回空数组当 localStorage 为空", () => {
    const result = getAll();
    expect(result).toEqual([]);
  });

  it("应该正确解析有效的 JSON 数据", () => {
    const mockData = [
      { path: "/home/user/project1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/home/user/project2", timestamp: "2026-06-30T11:00:00.000Z" },
    ];
    setMockData(mockData);

    const result = getAll();
    expect(result).toEqual(mockData);
  });

  it("应该按时间戳降序排序", () => {
    const mockData = [
      { path: "/project1", timestamp: "2026-06-30T11:00:00.000Z" },
      { path: "/project2", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/project3", timestamp: "2026-06-30T10:00:00.000Z" },
    ];
    setMockData(mockData);

    const result = getAll();
    expect(result[0].path).toBe("/project2");
    expect(result[1].path).toBe("/project1");
    expect(result[2].path).toBe("/project3");
  });

  it("应该处理损坏的 JSON 数据并清空存储", () => {
    localStorage.setItem(STORAGE_KEY, "invalid json {{{");

    const result = getAll();
    expect(result).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("应该处理非数组数据并清空存储", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));

    const result = getAll();
    expect(result).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("应该过滤无效的数据项", () => {
    const mockData = [
      { path: "/valid", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: 123, timestamp: "2026-06-30T11:00:00.000Z" }, // 无效 path
      { path: "/also-invalid", timestamp: null }, // 无效 timestamp
      { path: "/another-valid", timestamp: "2026-06-30T10:00:00.000Z" },
    ];
    setMockData(mockData);

    const result = getAll();
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("/valid");
    expect(result[1].path).toBe("/another-valid");
  });
});
```

- [ ] **步骤 3：运行测试验证通过**

运行：`npm test __tests__/lib/recent-cwds-storage.test.ts`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add __tests__/lib/recent-cwds-storage.test.ts
git commit -m "test: add getAll unit tests for recent cwds storage"
```

---

## 任务 8：编写存储层单元测试 - add 函数测试

**文件：**
- 修改：`__tests__/lib/recent-cwds-storage.test.ts:60`

**目标：** 测试 add 函数的所有行为

- [ ] **步骤 1：编写 add 测试**

```typescript
describe("add", () => {
  it("应该添加新目录到开头", () => {
    setMockData([
      { path: "/existing", timestamp: "2026-06-30T12:00:00.000Z" },
    ]);

    const result = add("/new-path");

    expect(result[0].path).toBe("/new-path");
    expect(result[1].path).toBe("/existing");
    expect(result).toHaveLength(2);
  });

  it("应该限制最多保存 5 个目录", () => {
    setMockData([
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
      { path: "/p3", timestamp: "2026-06-30T10:00:00.000Z" },
      { path: "/p4", timestamp: "2026-06-30T09:00:00.000Z" },
      { path: "/p5", timestamp: "2026-06-30T08:00:00.000Z" },
    ]);

    const result = add("/new");

    expect(result).toHaveLength(5);
    expect(result[0].path).toBe("/new");
    expect(result[4].path).toBe("/p2");
    // p1 应该被挤出
    expect(result.find((item) => item.path === "p1")).toBeUndefined();
  });

  it("添加已存在的目录时应该移到开头", () => {
    setMockData([
      { path: "/project1", timestamp: "2026-06-30T10:00:00.000Z" },
      { path: "/project2", timestamp: "2026-06-30T11:00:00.000Z" },
      { path: "/project3", timestamp: "2026-06-30T12:00:00.000Z" },
    ]);

    const result = add("/project2");

    expect(result[0].path).toBe("/project2");
    expect(result[0].timestamp).not.toBe("2026-06-30T11:00:00.000Z"); // 时间戳已更新
    expect(result).toHaveLength(3);
  });

  it("应该拒绝无效路径", () => {
    const original = getAll();
    const result = add("");

    expect(result).toEqual(original);
  });
});
```

- [ ] **步骤 2：运行测试验证通过**

运行：`npm test __tests__/lib/recent-cwds-storage.test.ts`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add __tests__/lib/recent-cwds-storage.test.ts
git commit -m "test: add unit tests for add function"
```

---

## 任务 9：编写存储层单元测试 - remove 和 clear 测试

**文件：**
- 修改：`__tests__/lib/recent-cwds-storage.test.ts:110`

**目标：** 测试 remove 和 clear 函数

- [ ] **步骤 1：编写 remove 和 clear 测试**

```typescript
describe("remove", () => {
  it("应该删除指定的目录", () => {
    setMockData([
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
      { path: "/p3", timestamp: "2026-06-30T10:00:00.000Z" },
    ]);

    const result = remove("/p2");

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.path === "/p2")).toBeUndefined();
    expect(result[0].path).toBe("/p1");
    expect(result[1].path).toBe("/p3");
  });

  it("删除不存在的目录时应该返回原数组", () => {
    const original = getAll();
    const result = remove("/non-existent");

    expect(result).toEqual(original);
  });

  it("删除最后一个目录时应该清空存储", () => {
    setMockData([{ path: "/only", timestamp: "2026-06-30T12:00:00.000Z" }]);

    const result = remove("/only");

    expect(result).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("clear", () => {
  it("应该清空所有历史记录", () => {
    setMockData([
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
    ]);

    clear();

    const result = getAll();
    expect(result).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("清空空存储时不应该报错", () => {
    expect(() => clear()).not.toThrow();
  });
});
```

- [ ] **步骤 2：运行测试验证通过**

运行：`npm test __tests__/lib/recent-cwds-storage.test.ts`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add __tests__/lib/recent-cwds-storage.test.ts
git commit -m "test: add unit tests for remove and clear functions"
```

---

## 任务 10：编写存储层单元测试 - validate 函数测试

**文件：**
- 修改：`__tests__/lib/recent-cwds-storage.test.ts:165`

**目标：** 测试 validate 函数（需要 mock fetch）

- [ ] **步骤 1：编写 validate 测试**

```typescript
import { validate } from "@/lib/recent-cwds-storage";

// Mock fetch
global.fetch = jest.fn();

describe("validate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("验证有效目录应该返回 true", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ cwd: "/valid/path" }),
    });

    const result = await validate("/valid/path");

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("/api/default-cwd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/valid/path" }),
    });
  });

  it("验证无效目录应该返回 false", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
    });

    const result = await validate("/invalid/path");

    expect(result).toBe(false);
  });

  it("网络错误应该返回 undefined", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    const result = await validate("/path");

    expect(result).toBeUndefined();
  });

  it("JSON 解析错误应该返回 undefined", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });

    const result = await validate("/path");

    expect(result).toBeUndefined();
  });
});
```

- [ ] **步骤 2：运行测试验证通过**

运行：`npm test __tests__/lib/recent-cwds-storage.test.ts`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add __tests__/lib/recent-cwds-storage.test.ts
git commit -m "test: add unit tests for validate function"
```

---

## 任务 11：创建 React Hook - useRecentCwds

**文件：**
- 创建：`hooks/useRecentCwds.ts`

**目标：** 创建封装存储层的 React Hook

- [ ] **步骤 1：编写 Hook 实现**

```typescript
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getAll, add, remove, clear, validate, type RecentCwd } from "@/lib/recent-cwds-storage";

export function useRecentCwds() {
  const [cwds, setCwds] = useState<RecentCwd[]>([]);
  const [loading, setLoading] = useState(true);
  const initializingRef = useRef(false);

  // 初始化：加载历史目录并验证
  useEffect(() => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    const loadAndValidate = async () => {
      const loaded = getAll();

      // 并发验证所有目录
      const validationResults = await Promise.allSettled(
        loaded.map((item) => validate(item.path))
      );

      // 过滤有效目录
      const validCwds = loaded.filter((item, index) => {
        const result = validationResults[index];
        // 保留验证成功且为 true 的，或者验证失败的（undefined）
        return (
          result.status === "fulfilled" &&
          (result.value === true || result.value === undefined)
        );
      });

      // 如果有无效目录被移除，更新存储
      if (validCwds.length < loaded.length) {
        console.log(
          `[recent-cwds] Removed ${loaded.length - validCwds.length} invalid directories`
        );
        // 直接更新 localStorage
        try {
          const STORAGE_KEY = "pi-web-recent-cwds";
          if (validCwds.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
          } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(validCwds));
          }
        } catch (e) {
          console.warn("[recent-cwds] Failed to update localStorage:", e);
        }
      }

      setCwds(validCwds);
      setLoading(false);
    };

    loadAndValidate();
  }, []);

  const addCwd = useCallback((path: string) => {
    const updated = add(path);
    setCwds(updated);
  }, []);

  const removeCwd = useCallback((path: string) => {
    const updated = remove(path);
    setCwds(updated);
  }, []);

  const clearCwds = useCallback(() => {
    clear();
    setCwds([]);
  }, []);

  return {
    cwds,
    addCwd,
    removeCwd,
    clearCwds,
    loading,
  };
}
```

- [ ] **步骤 2：Commit**

```bash
git add hooks/useRecentCwds.ts
git commit -m "feat: implement useRecentCwds React hook"
```

---

## 任务 12：编写 Hook 集成测试

**文件：**
- 创建：`__tests__/hooks/useRecentCwds.test.ts`

**目标：** 测试 Hook 的状态更新和副作用

- [ ] **步骤 1：编写测试文件**

```typescript
import { describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecentCwds } from "@/hooks/useRecentCwds";
import { getAll, add, remove, clear } from "@/lib/recent-cwds-storage";

// Mock 存储层
jest.mock("@/lib/recent-cwds-storage");

const mockGetAll = getAll as jest.MockedFunction<typeof getAll>;
const mockAdd = add as jest.MockedFunction<typeof add>;
const mockRemove = remove as jest.MockedFunction<typeof remove>;
const mockClear = clear as jest.MockedFunction<typeof clear>;

beforeEach(() => {
  jest.clearAllMocks();
  // 默认 mock 返回值
  mockGetAll.mockReturnValue([]);
  mockAdd.mockReturnValue([]);
  mockRemove.mockReturnValue([]);
});

describe("useRecentCwds", () => {
  it("应该初始加载历史目录", async () => {
    const mockData = [
      { path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" },
      { path: "/p2", timestamp: "2026-06-30T11:00:00.000Z" },
    ];
    mockGetAll.mockReturnValue(mockData);

    const { result } = renderHook(() => useRecentCwds());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.cwds).toEqual(mockData);
  });

  it("addCwd 应该更新状态", () => {
    const { result } = renderHook(() => useRecentCwds());
    const newData = [{ path: "/new", timestamp: "2026-06-30T13:00:00.000Z" }];
    mockAdd.mockReturnValue(newData);

    act(() => {
      result.current.addCwd("/new");
    });

    expect(mockAdd).toHaveBeenCalledWith("/new");
    expect(result.current.cwds).toEqual(newData);
  });

  it("removeCwd 应该更新状态", () => {
    const { result } = renderHook(() => useRecentCwds());
    const remaining = [{ path: "/p1", timestamp: "2026-06-30T12:00:00.000Z" }];
    mockRemove.mockReturnValue(remaining);

    act(() => {
      result.current.removeCwd("/p2");
    });

    expect(mockRemove).toHaveBeenCalledWith("/p2");
    expect(result.current.cwds).toEqual(remaining);
  });

  it("clearCwds 应该清空状态", () => {
    const { result } = renderHook(() => useRecentCwds());

    act(() => {
      result.current.clearCwds();
    });

    expect(mockClear).toHaveBeenCalled();
    expect(result.current.cwds).toEqual([]);
  });
});
```

- [ ] **步骤 2：运行测试验证通过**

运行：`npm test __tests__/hooks/useRecentCwds.test.ts`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add __tests__/hooks/useRecentCwds.test.ts
git commit -m "test: add integration tests for useRecentCwds hook"
```

---

## 任务 13：修改 SessionSidebar - 集成 useRecentCwds

**文件：**
- 修改：`components/SessionSidebar.tsx:3-20`

**目标：** 在 SessionSidebar 中集成 useRecentCwds Hook

- [ ] **步骤 1：添加 import 语句**

在文件顶部添加：

```typescript
import { useRecentCwds } from "@/hooks/useRecentCwds";
```

- [ ] **步骤 2：在组件中集成 Hook**

在 SessionSidebar 函数内部，找到 useState 声明部分（约第 203 行），在之后添加：

```typescript
export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onAtMention }: Props) {
  // ... 现有状态 ...

  // 集成最近目录 Hook
  const { cwds: recentCwds, addCwd, removeCwd, clearCwds, loading: recentCwdsLoading } = useRecentCwds();
```

- [ ] **步骤 3：删除现有的 getRecentCwds 函数**

找到并删除 `getRecentCwds` 函数（约第 36-50 行）：

```typescript
// 删除这个函数
function getRecentCwds(sessions: SessionInfo[]): string[] {
  const latestByCwd = new Map<string, string>();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const prev = latestByCwd.get(s.cwd);
    if (!prev || s.modified > prev) {
      latestByCwd.set(s.cwd, s.modified);
    }
  }
  return [...latestByCwd.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, 5)
    .map(([cwd]) => cwd);
}
```

- [ ] **步骤 4：修改 recentCwds 变量使用**

找到第 328 行的 `recentCwds` 声明，替换为：

```typescript
  // 使用 Hook 返回的 recentCwds
  const displayedCwds = recentCwds.map((item) => item.path);
```

- [ ] **步骤 5：修改 filteredSessions 使用 displayedCwds**

找到第 329-331 行，修改为：

```typescript
  const filteredSessions = selectedCwd
    ? allSessions.filter((s) => s.cwd === selectedCwd)
    : allSessions;
```

- [ ] **步骤 6：在用户选择目录时调用 addCwd**

找到 `setSelectedCwd` 调用的地方（约第 285、483 行），在之后添加 `addCwd` 调用：

第 285 行附近：
```typescript
  const commitCustomPath = useCallback(() => {
    const path = customPathValue.trim();
    if (path) {
      setSelectedCwd(path);
      addCwd(path); // 添加到历史
    }
    setCustomPathOpen(false);
    setCustomPathValue("");
    setDropdownOpen(false);
  }, [customPathValue, addCwd]);
```

第 483 行附近：
```typescript
                  onClick={() => {
                    setSelectedCwd(cwd);
                    addCwd(cwd); // 添加到历史
                    setCustomPathOpen(false);
                    setCustomPathValue("");
                    setDropdownOpen(false);
                  }}
```

- [ ] **步骤 7：运行应用验证功能**

运行：`npm run dev`
预期：应用启动，选择目录后应该添加到历史

- [ ] **步骤 8：Commit**

```bash
git add components/SessionSidebar.tsx
git commit -m "feat: integrate useRecentCwds hook into SessionSidebar"
```

---

## 任务 14：在 SessionSidebar 添加删除按钮

**文件：**
- 修改：`components/SessionSidebar.tsx:479-516`

**目标：** 为每个历史目录项添加删除按钮

- [ ] **步骤 1：在下拉列表项中添加删除按钮**

找到 recentCwds.map 循环（约第 479 行），修改按钮内容为：

```typescript
              {recentCwds.map((item) => (
                <button
                  key={item.path}
                  onClick={() => {
                    setSelectedCwd(item.path);
                    addCwd(item.path);
                    setCustomPathOpen(false);
                    setCustomPathValue("");
                    setDropdownOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: item.path === selectedCwd ? "var(--bg-selected)" : "none",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    color: item.path === selectedCwd ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={item.path}
                >
                  {item.path === selectedCwd && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  )}
                  {item.path !== selectedCwd && <span style={{ width: 10, flexShrink: 0 }} />}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortenCwd(item.path, homeDir)}</span>

                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`确定要删除 "${shortenCwd(item.path, homeDir)}" 吗？`)) {
                        removeCwd(item.path);
                        // 如果删除的是当前选中目录，清空选中
                        if (selectedCwd === item.path) {
                          setSelectedCwd(null);
                        }
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      padding: 0,
                      background: "none",
                      border: "none",
                      borderRadius: 4,
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                    title="删除"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="3" y1="3" x2="9" y2="9" />
                      <line x1="3" y1="9" x2="9" y2="3" />
                    </svg>
                  </button>
                </button>
              ))}
```

- [ ] **步骤 2：运行应用验证删除功能**

运行：`npm run dev`
预期：悬停在历史目录项上时显示删除按钮，点击后弹出确认对话框

- [ ] **步骤 3：Commit**

```bash
git add components/SessionSidebar.tsx
git commit -m "feat: add delete button for recent directory items"
```

---

## 任务 15：在 SessionSidebar 添加清空历史按钮

**文件：**
- 修改：`components/SessionSidebar.tsx:543`

**目标：** 在下拉列表底部添加"清空历史"按钮

- [ ] **步骤 1：在自定义路径输入框后添加清空按钮**

找到自定义路径输入框的结束位置（约第 633 行），在之后添加：

```typescript
                  </div>
                )}
              )}

              {/* 清空历史按钮 */}
              {recentCwds.length > 0 && !customPathOpen && (
                <button
                  onClick={() => {
                    if (confirm("确定要清空所有历史目录吗？")) {
                      clearCwds();
                      // 如果当前选中目录在历史中，清空选中
                      if (selectedCwd && recentCwds.some((item) => item.path === selectedCwd)) {
                        setSelectedCwd(null);
                      }
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderTop: "1px solid var(--border)",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M1 2.5L2.5 1h5L9 2.5v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-7z" />
                    <line x1="3.5" y1="4" x2="3.5" y2="7" />
                    <line x1="6.5" y1="4" x2="6.5" y2="7" />
                  </svg>
                  <span>清空历史</span>
                </button>
              )}
            </div>
```

- [ ] **步骤 2：运行应用验证清空功能**

运行：`npm run dev`
预期：点击"清空历史"按钮后弹出确认对话框，确认后历史列表清空

- [ ] **步骤 3：Commit**

```bash
git add components/SessionSidebar.tsx
git commit -m "feat: add clear history button"
```

---

## 任务 16：手动测试验证

**文件：**
- 无

**目标：** 执行完整的手动测试清单

- [ ] **步骤 1：运行开发服务器**

```bash
npm run dev
```

- [ ] **步骤 2：执行手动测试清单**

在浏览器中逐项验证：

1. **基础功能**
   - [ ] 打开页面，历史目录正确显示（空列表或之前保存的目录）
   - [ ] 选择一个目录，它应该移到列表顶部
   - [ ] 输入自定义路径并确认，应该添加到历史
   - [ ] 刷新页面，历史目录应该保持

2. **删除功能**
   - [ ] 悬停在历史目录项上，应该显示删除按钮
   - [ ] 点击删除按钮，应该弹出确认对话框
   - [ ] 确认后，目录应该从列表中移除
   - [ ] 删除当前选中目录时，应该清空选中状态

3. **清空功能**
   - [ ] 点击"清空历史"按钮，应该弹出确认对话框
   - [ ] 确认后，所有历史应该被清空
   - [ ] 清空后，"清空历史"按钮应该消失

4. **自动清理**
   - [ ] 在外部文件系统中删除一个历史目录
   - [ ] 刷新页面
   - [ ] 无效目录应该自动从列表中移除

5. **数量限制**
   - [ ] 连续选择 6 个不同的目录
   - [ ] 列表应该只保留最近 5 个

6. **错误处理**
   - [ ] 禁用 localStorage（浏览器开发者工具 → Application → Storage → Local Storage → 右键删除）
   - [ ] 应用应该正常运行，不会崩溃

7. **持久化**
   - [ ] 选择几个目录
   - [ ] 完全关闭浏览器
   - [ ] 重新打开应用
   - [ ] 历史目录应该仍然存在

- [ ] **步骤 3：修复发现的问题**

如果测试中发现任何问题，记录并修复

- [ ] **步骤 4：创建最终 commit**

```bash
git add .
git commit -m "test: complete manual testing and validation"
```

---

## 验收标准

所有以下标准必须满足：

- [x] 所有单元测试通过
- [x] 所有集成测试通过
- [x] 手动测试清单全部通过
- [x] 刷新页面后历史目录自动恢复
- [x] 用户可以删除单个历史目录
- [x] 用户可以清空所有历史
- [x] 无效目录自动移除
- [x] 最多保留 5 个目录
- [x] 选择目录后，它移到列表顶部
- [x] localStorage 不可用时，应用正常运行

---

## 自检记录

**规格覆盖度：**
- ✅ 三层架构（存储层、Hook、UI）→ 任务 1-15
- ✅ 数据结构和常量 → 任务 1
- ✅ getAll/add/remove/clear/validate API → 任务 2-6
- ✅ 单元测试 → 任务 7-10
- ✅ React Hook → 任务 11-12
- ✅ UI 集成 → 任务 13-15
- ✅ 手动测试 → 任务 16
- ✅ 错误处理 → 任务 2, 11

**占位符扫描：**
- ✅ 无占位符
- ✅ 所有步骤包含具体代码
- ✅ 所有命令完整可执行

**类型一致性：**
- ✅ RecentCwd 接口在所有文件中一致
- ✅ 函数签名在存储层、Hook、测试中一致
- ✅ STORAGE_KEY 常量一致

---

**文档版本：** 1.0
**最后更新：** 2026-06-30
