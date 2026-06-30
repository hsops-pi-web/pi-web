# 最近目录持久化功能设计文档

**日期：** 2026-06-30
**状态：** 待实现
**优先级：** P1 - 核心功能

## 问题概述

当前 pi-web 应用中，用户选择的目录配置只存储在 React 组件状态中。页面刷新后，所有配置都会丢失，用户需要重新选择工作目录，严重影响用户体验。

**目标：** 实现最近使用目录的持久化存储，刷新页面后自动恢复。

---

## 需求规格

### 功能需求

1. **多目录历史记录**
   - 保存最近使用的 5 个目录
   - 按最后使用时间降序排列
   - 自动去重（重复目录只保留最新记录）

2. **手动管理**
   - 支持删除单个历史目录
   - 支持清空所有历史记录
   - 操作前显示确认提示

3. **自动清理**
   - 自动验证目录有效性
   - 静默移除已删除或无权访问的目录
   - 如果没有有效目录，回到初始状态

4. **持久化**
   - 使用浏览器 localStorage 存储
   - 刷新页面后自动恢复
   - 永不过期（除非手动删除或被挤出列表）

### 非功能需求

- **性能：** 初始化验证请求应并发执行，不超过 2 秒
- **兼容性：** 支持 localStorage 不可用场景（降级到内存存储）
- **可靠性：** 处理数据格式损坏、网络错误等异常情况

---

## 架构设计

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                   SessionSidebar.tsx                   │
│  - 现有组件保持不变                                      │
│  - 集成 useRecentCwds hook                              │
│  - UI 添加删除和清空按钮                                 │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                hooks/useRecentCwds.ts                   │
│  - React Hook 封装                                      │
│  - 提供: cwds, addCwd, removeCwd, clearCwds            │
│  - 处理验证和自动清理                                   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│            lib/recent-cwds-storage.ts                   │
│  - 纯函数存储层                                         │
│  - API: getAll, add, remove, clear, validate            │
│  - localStorage 读写                                     │
└─────────────────────────────────────────────────────────┘
```

### 数据结构

```typescript
interface RecentCwd {
  path: string;           // 目录绝对路径
  timestamp: string;      // ISO 8601 时间戳（如 "2026-06-30T12:34:56.789Z"）
}

// localStorage 格式
// 键: "pi-web-recent-cwds"
// 值: '[{"path":"/home/user/project","timestamp":"2026-06-30T12:34:56.789Z"}]'
```

---

## 模块设计

### 1. `lib/recent-cwds-storage.ts`

**职责：** localStorage 的读写、数据验证、去重和排序

**API：**

```typescript
/**
 * 获取所有最近目录（按时间降序）
 * @returns 最近目录列表
 */
function getAll(): RecentCwd[]

/**
 * 添加一个目录到历史
 * - 自动去重
 * - 添加到开头
 * - 保持最多 5 个
 * @param path 目录路径
 * @returns 更新后的目录列表
 */
function add(path: string): RecentCwd[]

/**
 * 删除指定目录
 * @param path 目录路径
 * @returns 更新后的目录列表
 */
function remove(path: string): RecentCwd[]

/**
 * 清空所有历史
 */
function clear(): void

/**
 * 验证目录是否存在和可访问
 * @param path 目录路径
 * @returns true=有效, false=无效, undefined=验证失败（网络错误）
 */
async function validate(path: string): Promise<boolean | undefined>
```

**关键逻辑：**

- **添加时：** 去重 → 添加到开头 → 保持最多 5 个 → 保存
- **排序：** 按 timestamp 降序
- **验证：** 调用 `/api/default-cwd` POST 请求验证路径

---

### 2. `hooks/useRecentCwds.ts`

**职责：** 封装存储层为 React Hook，提供响应式状态

**API：**

```typescript
function useRecentCwds() {
  return {
    cwds: RecentCwd[],           // 当前历史列表
    addCwd: (path: string) => void,
    removeCwd: (path: string) => void,
    clearCwds: () => void,
    loading: boolean,            // 验证加载状态
  }
}
```

**关键逻辑：**

- 组件挂载时加载历史
- 并发验证所有目录有效性
- 自动移除无效目录
- 用户操作时同步更新状态和存储

---

### 3. `components/SessionSidebar.tsx` 修改

**变更点：**

1. 集成 `useRecentCwds` hook
2. 替换现有的 `getRecentCwds(sessions)` 为 `cwds` from hook
3. 在下拉列表中每个项旁边添加删除按钮
4. 在底部添加"清空历史"按钮

**UI 变更：**

```tsx
// 历史目录项添加删除按钮
<button
  onClick={(e) => {
    e.stopPropagation();
    removeCwd(cwd);
  }}
  style={{ /* 删除按钮样式 */ }}
>
  <svg>/* X 图标 */</svg>
</button>

// 底部添加清空按钮
<button
  onClick={() => {
    if (confirm('确定要清空所有历史目录吗？')) {
      clearCwds();
    }
  }}
>
  清空历史
</button>
```

---

## 数据流设计

### 1. 初始化流程

```
用户打开页面
    ↓
SessionSidebar 挂载
    ↓
useRecentCwds hook 初始化
    ↓
从 localStorage 读取历史目录
    ↓
批量验证目录有效性（并发，Promise.allSettled）
    ↓
移除无效目录，更新 localStorage
    ↓
更新 React 状态
    ↓
UI 渲染历史列表
```

### 2. 用户选择目录流程

```
用户点击下拉列表中的目录
    ↓
setSelectedCwd(path)
    ↓
调用 addCwd(path)
    ↓
存储层：去重 → 添加到开头 → 保持最多 5 个 → 保存到 localStorage
    ↓
更新 React 状态
    ↓
UI 更新（选中项高亮、列表重新排序）
```

### 3. 删除单个目录流程

```
用户点击目录旁的删除按钮
    ↓
阻止事件冒泡（不影响选择该目录）
    ↓
调用 removeCwd(path)
    ↓
存储层：从数组中移除 → 保存到 localStorage
    ↓
如果删除的是当前选中目录：清空选中状态
    ↓
UI 更新
```

### 4. 清空历史流程

```
用户点击"清空历史"
    ↓
显示确认对话框（confirm）
    ↓
用户确认
    ↓
调用 clearCwds()
    ↓
存储层：清空 localStorage → 返回空数组
    ↓
如果当前选中目录在历史中：清空选中状态
    ↓
UI 更新（显示"Select project…"占位符）
```

---

## 错误处理

### 1. localStorage 不可用

**场景：** 用户禁用了 localStorage 或存储空间已满

**处理：**

```typescript
try {
  localStorage.getItem(KEY);
} catch (e) {
  // 降级为内存存储（session 级别）
  console.warn('localStorage unavailable, using memory fallback');
  return []; // 返回空数组，不影响基本功能
}
```

### 2. 目录验证失败

**场景：** 历史目录已被删除或无权访问

**处理：**

```typescript
// 批量验证时
const results = await Promise.allSettled(
  cwds.map(cwd => validate(cwd.path))
);

const validCwds = cwds.filter((cwd, index) =>
  results[index].status === 'fulfilled' && results[index].value === true
);

// 如果有无效目录，静默移除并更新存储
if (validCwds.length < cwds.length) {
  localStorage.setItem(KEY, JSON.stringify(validCwds));
}
```

### 3. 网络错误

**场景：** 验证 API 请求失败

**处理：**

```typescript
// 显示警告，但不影响 UI
const isValid = await validate(path);
if (isValid === undefined) {
  // 验证失败（网络错误），暂时保留该目录
  console.warn('Failed to validate directory, keeping it in history');
}
```

### 4. 数据格式损坏

**场景：** localStorage 中的 JSON 数据损坏

**处理：**

```typescript
try {
  const data = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (!Array.isArray(data)) throw new Error('Invalid format');
  return data;
} catch (e) {
  // 清空损坏的数据，从头开始
  localStorage.removeItem(KEY);
  return [];
}
```

---

## 测试策略

### 单元测试

**测试文件：** `__tests__/lib/recent-cwds-storage.test.ts`

**测试用例：**

```typescript
describe('recent-cwds-storage', () => {
  it('应该正确添加新目录到开头');
  it('应该限制最多保存 5 个目录');
  it('添加已存在的目录时应该移到开头');
  it('应该正确删除指定目录');
  it('应该正确清空所有目录');
  it('应该按时间戳降序排序');
  it('应该处理损坏的 JSON 数据');
  it('应该处理 localStorage 不可用的场景');
  it('验证失败时应该返回 undefined');
  it('验证有效目录应该返回 true');
  it('验证无效目录应该返回 false');
});
```

### 集成测试

**测试文件：** `__tests__/hooks/useRecentCwds.test.ts`

**测试用例：**

```typescript
describe('useRecentCwds', () => {
  it('应该正确加载历史目录');
  it('addCwd 应该更新状态和存储');
  it('removeCwd 应该正确删除目录');
  it('clearCwds 应该清空所有历史');
  it('应该自动移除无效目录');
  it('应该并发验证目录');
  it('验证时应该显示 loading 状态');
  it('删除当前选中目录时应该清空选中状态');
});
```

### 手动测试清单

- [ ] 打开页面，历史目录正确显示
- [ ] 选择一个目录，它应该移到列表顶部
- [ ] 输入自定义路径，应该添加到历史
- [ ] 刷新页面，历史目录应该保持
- [ ] 删除单个目录，应该从列表中移除
- [ ] 清空历史，列表应该为空
- [ ] 删除外部目录后刷新，无效目录应该自动移除
- [ ] 选择超过 5 个不同目录，应该只保留最近 5 个
- [ ] localStorage 不可用时，应用应该正常降级运行
- [ ] 数据格式损坏时，应该自动清空并重新开始

---

## 实现任务清单

1. [ ] 创建存储层模块 `lib/recent-cwds-storage.ts`
2. [ ] 创建 React Hook `hooks/useRecentCwds.ts`
3. [ ] 修改 `SessionSidebar.tsx` 集成 `useRecentCwds`
4. [ ] 在 `SessionSidebar` 下拉列表中添加删除按钮
5. [ ] 在 `SessionSidebar` 添加"清空历史"按钮
6. [ ] 实现目录验证 API 调用
7. [ ] 实现错误处理和降级策略
8. [ ] 编写单元测试 `recent-cwds-storage.test.ts`
9. [ ] 编写集成测试 `useRecentCwds.test.ts`
10. [ ] 手动测试和验证所有功能

---

## 依赖和约束

### 依赖

- Next.js React hooks（useState, useEffect, useCallback）
- 浏览器 localStorage API
- 现有 API：`/api/default-cwd`（用于验证目录）

### 约束

- 最多保存 5 个历史目录
- 必须支持 localStorage 不可用场景
- 验证失败不应阻塞 UI 渲染

---

## 未来扩展

可能的未来增强（不包含在当前实现中）：

1. **后端同步：** 将历史目录同步到服务器，实现跨设备同步
2. **智能推荐：** 基于使用频率和时间，智能推荐目录
3. **分组管理：** 支持自定义分组和标签
4. **搜索功能：** 支持搜索历史目录
5. **导入导出：** 支持导入导出历史配置

---

## 验收标准

功能完成的标准：

1. ✅ 刷新页面后，历史目录自动恢复
2. ✅ 用户可以删除单个历史目录
3. ✅ 用户可以清空所有历史
4. ✅ 无效目录自动移除
5. ✅ 最多保留 5 个目录
6. ✅ 选择目录后，它移到列表顶部
7. ✅ localStorage 不可用时，应用正常运行
8. ✅ 所有测试通过
9. ✅ 手动测试清单全部通过

---

**文档版本：** 1.0
**最后更新：** 2026-06-30
