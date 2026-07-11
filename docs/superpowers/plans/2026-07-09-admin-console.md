# pi-web-auth 管理后台与角色权限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 若执行环境提供 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，用其逐任务实施；否则按普通逐任务执行即可。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已上线的 pi-web-auth（8000 端口，已有用户注册/登录/目录隔离）增加基于角色的管理后台：管理员查看/禁用/删除用户，super_admin 提权降级，普通用户隐藏并禁用 Models/Skills 配置。

**Architecture:** 在现有 SQLite 认证层上加 `role`/`disabled` 两列 + `lib/auth/roles.ts` 集中角色判定。后端 `getSessionUser` 强化为拒绝禁用用户，新增 `getSessionUserWithRole`/`requireAdmin`/`requireSuperAdmin`。管理能力走独立 `/api/admin/*` 路由（Node runtime，路径参数寻址目标用户，内部把允许根设为目标用户目录并 realpath 防逃逸）。前端新增 `/admin` 页，复用参数化后的 FileExplorer/FileViewer（只读模式）。

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, better-sqlite3, Node 内置 crypto/test runner，`@earendil-works/pi-coding-agent`（AuthStorage/ModelRegistry/AgentSession）。

## Global Constraints

- **隔离开发（用户要求）**：本功能在**独立 git worktree** 的功能分支上开发（如 `feat/admin-console`），不在 main、也不在生产工作树 `/home/hsops/pi-web-auth` 上直接改；开发全程**不得影响正在运行的生产服务** `pi-web-auth.service`（已在 8000 端口 active）。用 worktree 而非仅切分支的原因：生产 service 的工作目录就是 `/home/hsops/pi-web-auth`，在同一工作树切分支/写 `.next` 会干扰运行实例——worktree 让开发副本与生产工作树物理分离（见 Task 0）。
- **数据根隔离（用户要求，关键）**：仅换分支/端口**不能**隔离数据——生产与开发默认共享同一 `~/.pi-web-auth/auth.db`、`~/pi-users/<user>`、Pi 会话 `~/.pi/agent/sessions`。这三处数据根**全部派生自 `os.homedir()`（Linux 即 `$HOME`）**，故开发期一律以**隔离 HOME** 启动 dev：`HOME=$DEV_HOME npm run dev -- -p 8133`（`DEV_HOME` 为专用隔离目录，如 `/home/hsops/.pi-admin-dev-home`）。这样 auth.db、测试用户目录、测试会话 jsonl 全落入隔离目录，**绝不触碰生产数据**。测试账号（alice/bob/deltest）只在隔离 HOME 下创建与删除。
- **端口隔离（用户要求）**：8000 已被运行中的 service 占用，开发期验证**一律用另一端口 8133**：`HOME=$DEV_HOME npm run dev -- -p 8133`（覆盖 package.json 里默认的 `-p 8000`）。**绝不**跑默认 `npm run dev`（会撞 8000 且用生产 HOME）。执行前先 `ss -ltnp | grep :8133` 确认 8133 空闲；如占用另择未占端口。**绝不 `systemctl restart pi-web-auth`**，除非最终部署且用户明确批准。
- **绝不在开发期跑 `next build`**（污染 `.next/`，破坏运行中的 dev/prod），仅生产部署阶段构建。
- **隔离 HOME 贯穿一切开发命令（含 `npm test`，用户要求，修 R3#5）**：`DEV_HOME=/home/hsops/.pi-admin-dev-home` 是**字面量常量**，不是靠 Task 0 的 `export` 跨会话传递的变量——**新 subagent / 新 shell 不继承前一个 Task 的临时环境变量**，故不得依赖 `export DEV_HOME` 已存在。每个 Task 的命令块**开头自带一行** `DEV_HOME=/home/hsops/.pi-admin-dev-home`（局部定义，块内 `$DEV_HOME` 即可用），或直接用字面量。
  - `npm test` 也必须隔离：`HOME=/home/hsops/.pi-admin-dev-home npm test`。现有 `paths` 相关测试会在 `os.homedir()/pi-users` 下建目录，不隔离会污染生产 `~/pi-users`。
  - `npm run dev` 同理：`HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`。**绝不**出现只带 `-p 8133` 而无 `HOME=` 的 dev/test 命令。
- 测试：Node 内置 runner，`HOME=/home/hsops/.pi-admin-dev-home npm test`（作用域 `__tests__/lib/auth/**/*.test.ts`）。纯逻辑函数必须单测。
- 类型检查：最终验证用 `node_modules/.bin/tsc --noEmit`（项目已装 tsc）。
- super_admin 用户名硬编码常量 `SUPER_ADMIN = 'hsops'`，集中在 `lib/auth/roles.ts` 一处。
- 角色三值：`'user' | 'admin' | 'super_admin'`。DB 列 `role TEXT NOT NULL DEFAULT 'user'`、`disabled INTEGER NOT NULL DEFAULT 0`。
- 权限矩阵（后端按目标当前 role 校验，前端隐藏仅体验）：admin 只能禁用/启用/删除 `user`；super_admin 可管理 `user`+`admin` 但不能对自己做破坏性操作；仅 super_admin 可改角色（user<->admin）；super_admin 不可被降级/禁用/删除（含本人，硬拒）。
- super_admin 内容保护：普通 admin 不得查看 super_admin 的文件/对话（403）；super_admin 本人不受限，经 admin 通道（`/admin` 后台）或普通通道均可查看自己（`guardAdminViewTarget` 对"请求者=目标本人"放行）。此为已确认的需求收敛。
- 越权统一返 403；未登录返 401。所有他人目录访问用 `realpathSync` 限定在目标用户根内，解析失败 fail-closed 拒绝。
- 纯逻辑测试文件遵循现有 `delete-helpers.ts` 模式：**自包含**（内联 userRoot 等，不跨 `.ts` import），以兼容 webpack 生产构建与 `node --test` 两条工具链。
- 提交粒度：每个 Task 结束一次 commit，中文 commit message。

---

## File Structure

新建：
- `lib/auth/roles.ts` — 角色常量与纯判定：`Role` 类型、`SUPER_ADMIN`、`isAdmin`、`isSuperAdmin`、`canManage`、`canChangeRole`。
- `app/api/admin/users/route.ts` — GET 列所有用户。
- `app/api/admin/users/[username]/route.ts` — PATCH 改角色 / DELETE 删用户。
- `app/api/admin/users/[username]/disable/route.ts` — POST 禁用/启用。
- `app/api/admin/users/[username]/sessions/route.ts` — GET 目标用户会话列表。
- `app/api/admin/users/[username]/sessions/[id]/route.ts` — GET 会话详情（只读）。
- `app/api/admin/files/[username]/[[...path]]/route.ts` — GET 目标用户目录文件树/内容（只读，可选 catch-all）。
- `app/api/files/[...path]/file-serve.ts` — 从普通 files 路由抽出的共享纯 helper（路径重建/MIME/streaming/download），admin 文件通道复用。
- `app/admin/page.tsx` — 管理后台页。
- `lib/auth/admin-guard.ts` — 管理 API 共用：解析目标用户、super_admin 内容保护判断（集中一处）。
- `lib/auth/delete-user.ts` — 删除用户序列（含 jsonl 集合扫描），纯副作用编排；userRootPath/canonicalRoot 分离防误删软链目标。
- `lib/auth/delete-user-helpers.ts` — jsonl 归属过滤纯逻辑（自包含可测，Task 7）。
- `lib/auth/delete-lock.ts` — 删除锁纯状态机（`createDeleteLock` 工厂：引用计数 + in-flight 等待 + operation guard）、删除窗口错误分类 `createDeleteWindowAbortError(cleanupErr)` 与 wrapper 命令判定 `assertSessionCommandAllowed(...)`，无 pi/无 fs 依赖，供 rpc-manager 与单测共同 import（Task 6）。
- `__tests__/lib/auth/roles.test.ts`、`__tests__/lib/auth/delete-user-helpers.test.ts`、`__tests__/lib/auth/session-ownership.test.ts`（Task 6.5：cwd 已删/坏软链/外部软链子路径/软链环/无权限祖先）、`__tests__/lib/auth/delete-lock.test.ts`（Task 6.7：import 真实 delete-lock，测引用计数/等待/清理失败传播/新建与已有会话 operation guard 完整时序）。

注：`resolveSessionOwnership`/`canonicalizeExistingPrefix` 加在既有 `lib/auth/paths.ts`（见修改清单）；删除锁状态机在新模块 `lib/auth/delete-lock.ts`，`lib/rpc-manager.ts` 做薄包装（canon + 委托）并保留依赖注册表的 `abortSessionsUnderCwd`。`lib/pi-types.ts` 的 `AgentSessionLike` 补 `dispose?()`（见修改清单）。

修改：
- `lib/auth/paths.ts` — 新增 `resolveSessionOwnership(cwd, username)`：session/jsonl 归属专用（cwd 存在走 realpath 防逃逸，cwd 已删走规范化路径严格边界），供会话列表/详情/删除扫描复用；文件读取仍用 `resolveExistingAndCheck`（要求 realpath 成功）。
- `lib/auth/db.ts` — 加 role/disabled 列迁移 + bootstrap hsops。
- `lib/auth/session.ts` — `getSessionUser` 查 disabled；新增 `getSessionUserWithRole`/`requireAdmin`/`requireSuperAdmin`。
- `app/api/auth/login/route.ts` — 禁用用户 403。
- `app/api/auth/me/route.ts` — 返回 role。
- `app/api/auth/register/route.ts` — hsops 注册即 super_admin。
- 配置类路由入口换 `requireAdmin`：`app/api/models-config/route.ts`、`.../test/route.ts`、`app/api/skills/route.ts`、`.../search/route.ts`、`.../install/route.ts`、`app/api/auth/providers/route.ts`、`app/api/auth/all-providers/route.ts`、`app/api/auth/api-key/[provider]/route.ts`、`app/api/auth/login/[provider]/route.ts`、`app/api/auth/logout/[provider]/route.ts`。
- `lib/file-paths.ts` — 抽 `buildFileUrl(path, type, base?)`；`getFileDownloadUrl` 加可选 `base`。
- `app/api/files/[...path]/route.ts` — 把 `filePathFromSegments`/MIME/streaming/download 等纯 helper 抽到同目录 `file-serve.ts` 并 import（行为不变），供 admin 通道复用。
- `components/AppShell.tsx` — 按 role 隐藏 Models/Skills + 后台入口。
- `components/FileExplorer.tsx` — `readOnly` + `urlBase` 注入；`fetchEntries` 加 urlBase 参数，`TreeNode` props 加 readOnly/urlBase 并**递归透传**，删除/mention 按钮加 `!readOnly` 守卫；所有读取 `urlBase` 的 callback/effect 同步补依赖。
- `components/FileViewer.tsx` — 各子 viewer 的 read/download/watch 用 `buildFileUrl`（注入 base），只读关 watch；图片/音频 src 走 `type=read`（依赖 admin 后端 streamFile）；所有读取 `urlBase`/`readOnly` 的 callback/effect 同步补依赖并保证切换只读时清理旧 EventSource。
- `lib/rpc-manager.ts` — import 纯模块 `delete-lock.ts` 并薄包装导出删除锁 `markRootDeleting`/`unmarkRootDeleting`/`waitForStartsUnderRoot`/`withStartGuard`/`withCwdOperationGuard`（canon 后委托）；保留依赖注册表的 `abortSessionsUnderCwd`（canonical 比较）；`startRpcSession` 在 existing/inflight fast path 前 canonical 化并检查删除状态、注册前二次检查清理已建 inner；`AgentSessionWrapper.send` 拒绝已销毁 wrapper 与删除窗口内非 abort 命令（修 R3#2/#3/#4/#5、R5#1/#2/#4/#5）。
- `lib/pi-types.ts` — `AgentSessionLike` 接口补 `dispose?(): void;`（二次检查清理调 `inner.dispose?.()`，修 R5#4）。
- `app/api/agent/new/route.ts` — 把 `mkdirSync(cwd)` + `startRpcSession` 整段用 `withStartGuard` 包住，纳入删除锁临界区（修 R3#1 目录重建竞态）。
- `app/api/agent/[id]/route.ts` — POST 的已有/新建 wrapper 选择与命令 `send` 整段用 `withCwdOperationGuard` 包住，封住已鉴权旧请求向已有会话继续写的竞态。

---

## Task 0: 建隔离开发 worktree + 隔离数据根（前置，用户要求）

**Files:** 无代码；git worktree + 隔离 HOME 目录。

- [ ] **Step 1: 从最新 main 建独立 worktree + 功能分支（并携带本 spec/plan，修 R3#3）**

**前提（R3#3 + R3#7）**：本计划文件当前**未被 git 跟踪**（`?? docs/.../plans/2026-07-09-admin-console.md`）、设计文件的最新修改也**未提交**（`M docs/.../specs/2026-07-09-admin-console-design.md`）。两个后果都要处理：
1. 若直接 `git worktree add ... main`，新 worktree 检出 main 旧树，**不含这两份最新文档**，执行者会照旧版执行（R3#3）。
2. 若把两文档留在生产工作树未提交/未跟踪，**功能分支合并回 main 时未跟踪的 plan 会触发 `error: The following untracked working tree files would be overwritten by merge`**，且违反"部署前工作树 clean"（Task 16 Step3）的要求（R3#7）。
故须**把两文档从生产工作树转移到功能分支，并让生产工作树恢复 clean**——用 `git stash -u`（含未跟踪）转移，不用"复制后留副本"。

生产 service 的工作目录就是 `/home/hsops/pi-web-auth`；在该工作树切分支或写 `.next` 会干扰运行中的实例。用独立 worktree 把开发副本与生产工作树物理隔离（推荐按 `superpowers:using-git-worktrees`；下面是等价的原生命令）：

```bash
cd /home/hsops/pi-web-auth
git fetch origin 2>/dev/null || true

# 1) 转移两文档到 stash（含未跟踪 plan），使生产工作树恢复 clean（修 R3#7）。
#    只 stash 这两个文档，避免误藏其他改动；若无其他改动可直接 git stash -u。
git stash push -u -m "admin-console-docs" -- \
  docs/superpowers/specs/2026-07-09-admin-console-design.md \
  docs/superpowers/plans/2026-07-09-admin-console.md
git status --porcelain   # 期望空（生产工作树 clean，两文档已入 stash）

# 2) 建 worktree（基于最新 main），检出功能分支
git worktree add -b feat/admin-console ../pi-web-auth-admin main
cd ../pi-web-auth-admin
git branch --show-current   # 期望 feat/admin-console

# 3) 在新 worktree 恢复两文档并作为首个 commit（执行基准落在功能分支）
git stash apply "stash@{0}" 2>/dev/null || git checkout stash@{0} -- \
  docs/superpowers/specs/2026-07-09-admin-console-design.md \
  docs/superpowers/plans/2026-07-09-admin-console.md
git add docs/superpowers/specs/2026-07-09-admin-console-design.md \
        docs/superpowers/plans/2026-07-09-admin-console.md
git commit -m "docs: 携带管理后台设计与实现计划到功能分支(执行基准)"

# 4) 两文档已提交进功能分支，丢弃 stash（生产工作树保持 clean，不再持有副本）
git stash drop "stash@{0}" 2>/dev/null || true

npm ci 2>/dev/null || npm install   # worktree 独立 node_modules（含 tsc）
```
Expected: 生产工作树 `/home/hsops/pi-web-auth` **`git status --porcelain` 为空（clean）**；独立目录 `/home/hsops/pi-web-auth-admin` 当前分支 `feat/admin-console`，其 `docs/superpowers/{specs,plans}/` 已含本设计与计划且作为首个 commit。**后续所有 Task 的编辑、dev、commit 都在此 worktree 内，且以此 worktree 中的 plan 文件为执行基准**。这样 Task 16 合并回 main 时，main 无这两文件的未跟踪副本，不会触发 "would be overwritten by merge"，也满足部署前工作树 clean。
> 若 `git stash apply` 因 worktree 隔离取不到 stash（stash 属仓库级、跨 worktree 可见，通常可用），退化方案：在 step 1 前先 `cp` 两文档到 `/tmp`，step 3 从 `/tmp` 拷回并提交，step 1 仍 `git stash -u` 或 `git checkout -- spec + rm plan` 清理生产工作树。关键不变：**生产工作树最终 clean，两文档只存在于功能分支**。

- [ ] **Step 2: 建隔离 HOME 数据根（关键，防碰生产数据）**

三处数据根（auth.db / pi-users / pi 会话）都基于 `$HOME`。建一个专用隔离 HOME，dev 全程用它，生产数据零触碰：

```bash
export DEV_HOME=/home/hsops/.pi-admin-dev-home
mkdir -p "$DEV_HOME"
# 冒烟确认隔离生效：隔离 HOME 下的数据根应指向 DEV_HOME 而非 /home/hsops
HOME="$DEV_HOME" node -e "const os=require('os'),p=require('path'); console.log('authdb=',p.join(os.homedir(),'.pi-web-auth','auth.db')); console.log('users=',p.join(os.homedir(),'pi-users'));"
```
Expected: 打印路径均在 `/home/hsops/.pi-admin-dev-home` 下（非 `/home/hsops`）。之后所有 dev/curl/测试账号都在此 HOME 下，生产 `~/.pi-web-auth/auth.db`、`~/pi-users`、`~/.pi/agent` 不被读写。（Pi 会话目录亦可另用 `PI_CODING_AGENT_DIR` 覆盖，但隔离 HOME 已一并覆盖，无需额外设。）

- [ ] **Step 3: 确认不碰运行中服务 + 端口空闲**

```bash
ss -ltnp 2>/dev/null | grep ':8000' && echo "8000 运行中(勿动)" || echo "8000 空闲"
ss -ltnp 2>/dev/null | grep ':8133' && echo "8133 被占(另择端口)" || echo "8133 可用于 dev"
```
Expected: 8000 为运行中的 service（开发期不重启它）、8133 空闲可作 dev 端口。**本 Task 无 commit**（仅环境准备）。

---

## Task 1: 角色判定纯函数 `lib/auth/roles.ts`（TDD）

**Files:**
- Create: `lib/auth/roles.ts`
- Test: `__tests__/lib/auth/roles.test.ts`

**Interfaces:**
- Produces:
  - `type Role = "user" | "admin" | "super_admin"`
  - `const SUPER_ADMIN = "hsops"`
  - `isAdmin(role: Role): boolean` — admin 或 super_admin 为 true
  - `isSuperAdmin(role: Role): boolean`
  - `canManage(actorRole: Role, targetRole: Role): boolean` — 能否对目标做禁用/启用/删除
  - `canChangeRole(actorRole: Role): boolean` — 能否改他人角色（仅 super_admin）
  - `isValidRole(v: unknown): v is Role`

判定规则（供后续所有管理 API 复用）：
- `canManage`：目标为 super_admin 恒 false（含本人）；actor=super_admin 可管 user/admin；actor=admin 仅可管 user；actor=user 恒 false。
- `canChangeRole`：仅 super_admin true。
- "不能对自己做破坏性操作"在 API 层用 `username===actor` 额外挡（同为 super_admin 时 canManage 已 false，本人保护天然成立）。

- [ ] **Step 1: 写失败测试**

`__tests__/lib/auth/roles.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAdmin, isSuperAdmin, canManage, canChangeRole, isValidRole, SUPER_ADMIN,
} from "../../../lib/auth/roles.ts";

test("SUPER_ADMIN 常量", () => {
  assert.equal(SUPER_ADMIN, "hsops");
});

test("isAdmin", () => {
  assert.equal(isAdmin("user"), false);
  assert.equal(isAdmin("admin"), true);
  assert.equal(isAdmin("super_admin"), true);
});

test("isSuperAdmin", () => {
  assert.equal(isSuperAdmin("user"), false);
  assert.equal(isSuperAdmin("admin"), false);
  assert.equal(isSuperAdmin("super_admin"), true);
});

test("canManage 全 3x3 组合", () => {
  assert.equal(canManage("user", "user"), false);
  assert.equal(canManage("user", "admin"), false);
  assert.equal(canManage("user", "super_admin"), false);
  assert.equal(canManage("admin", "user"), true);
  assert.equal(canManage("admin", "admin"), false);
  assert.equal(canManage("admin", "super_admin"), false);
  assert.equal(canManage("super_admin", "user"), true);
  assert.equal(canManage("super_admin", "admin"), true);
  assert.equal(canManage("super_admin", "super_admin"), false);
});

test("canChangeRole 仅 super_admin", () => {
  assert.equal(canChangeRole("user"), false);
  assert.equal(canChangeRole("admin"), false);
  assert.equal(canChangeRole("super_admin"), true);
});

test("isValidRole", () => {
  assert.equal(isValidRole("user"), true);
  assert.equal(isValidRole("admin"), true);
  assert.equal(isValidRole("super_admin"), true);
  assert.equal(isValidRole("root"), false);
  assert.equal(isValidRole(""), false);
  assert.equal(isValidRole(null), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm test`
Expected: FAIL（找不到模块 `lib/auth/roles.ts`）。

- [ ] **Step 3: 写实现**

`lib/auth/roles.ts`:
```ts
export type Role = "user" | "admin" | "super_admin";

export const SUPER_ADMIN = "hsops";

export function isValidRole(v: unknown): v is Role {
  return v === "user" || v === "admin" || v === "super_admin";
}

export function isAdmin(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin(role: Role): boolean {
  return role === "super_admin";
}

// 能否对目标做禁用/启用/删除。只按角色判定；本人保护在 API 层附加。
export function canManage(actorRole: Role, targetRole: Role): boolean {
  if (targetRole === "super_admin") return false;
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin") return targetRole === "user";
  return false;
}

// 能否改他人角色（提权/降级）。仅 super_admin。
export function canChangeRole(actorRole: Role): boolean {
  return actorRole === "super_admin";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm test`
Expected: PASS，全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add lib/auth/roles.ts __tests__/lib/auth/roles.test.ts
git commit -m "feat: 角色判定纯函数(roles.ts)+全组合单测"
```

---

## Task 2: DB 加 role/disabled 列 + bootstrap hsops

**Files:**
- Modify: `lib/auth/db.ts`

**Interfaces:**
- Consumes: `SUPER_ADMIN`（Task 1，`lib/auth/roles.ts`）。
- Produces: `getDb()` 返回库的 `users` 表含 `role`/`disabled` 列；hsops 若存在则 role=super_admin。对新库与既有 `~/.pi-web-auth/auth.db` 均幂等。

现状（勿整体重写，仅在建表 `db.exec(...)` 之后、`globalThis.__piAuthDb = db;` 之前插入迁移与 bootstrap）：`getDb()` 挂 `globalThis.__piAuthDb` 单例，建 `users(id,username UNIQUE,password_hash,created_at)` 与 `sessions(token,username,expires_at)`，无 role/disabled。

- [ ] **Step 1: 顶部 import**

在 `lib/auth/db.ts` 顶部 import 区加：
```ts
import { SUPER_ADMIN } from "./roles";
```

- [ ] **Step 2: 插入迁移与 bootstrap**

在建表 `db.exec(\`...\`);` 之后、`globalThis.__piAuthDb = db;` 之前插入：
```ts
  // 迁移：既有库补列（SQLite 加列不支持 IF NOT EXISTS，先查 pragma）
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const has = (c: string) => cols.some((x) => x.name === c);
  if (!has("role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!has("disabled")) {
    db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  }
  // bootstrap：hsops 已存在则提为 super_admin（未存在时由 register 流程处理）
  db.prepare("UPDATE users SET role='super_admin' WHERE username=?").run(SUPER_ADMIN);
```

- [ ] **Step 3: 验证迁移幂等且列存在**

> 不要用 `node --experimental-strip-types -e "import('./lib/auth/db.ts')…"`：db.ts 及其依赖用无扩展名本地 import（如 `from "./roles"`），strip-types 直跑会 `ERR_MODULE_NOT_FOUND`，不能作为迁移验证。改为经 dev server 触发迁移（`getDb()` 在首个请求时执行 ALTER），再用 sqlite3 CLI 读表结构：

Run（dev 用隔离 HOME + 隔离端口 8133，勿撞运行中的 8000）：
```bash
# 0) 本命令块自带 DEV_HOME 字面量定义（不依赖 Task 0 的 export 跨 subagent 存活）
DEV_HOME=/home/hsops/.pi-admin-dev-home
# 1) 后台起 dev（隔离 HOME + 隔离端口），等待就绪
HOME="$DEV_HOME" npm run dev -- -p 8133 &
DEV_PID=$!
sleep 6
# 2) 打一个会真正走到 getDb() 的公开接口触发迁移。
#    不能用 /api/auth/me：middleware 对受保护路由在路由加载前就返 401，getDb 不一定执行。
#    改打公开的 /api/auth/login，发一组不存在的账号密码——login handler 会实际调用 getDb() 查用户。
curl -s -o /dev/null -X POST -H "Content-Type: application/json" \
  -d '{"username":"__migrate_probe__","password":"x"}' \
  http://127.0.0.1:8133/api/auth/login
# 3) 用 sqlite3 CLI 直接读列（避开 strip-types 动态导入）；注意读的是隔离 HOME 下的 auth.db
sqlite3 "$DEV_HOME/.pi-web-auth/auth.db" "PRAGMA table_info(users);" | awk -F'|' '{print $2}' | tr '\n' ',' ; echo
# 4) 收尾：停 dev
kill $DEV_PID
```
Expected: 列名含 `role` 与 `disabled`；`login` 探测返回 401/404（账号不存在，无妨——关键是 handler 已调 `getDb()` 跑迁移）；重复执行不报错（`ADD COLUMN` 有 `has()` 幂等守卫）。若列缺失则 Step 2 迁移未生效，需修。

- [ ] **Step 4: Commit**

```bash
git add lib/auth/db.ts
git commit -m "feat: users表加role/disabled列迁移+bootstrap hsops为super_admin"
```

---

## Task 3: session.ts 强化 + requireAdmin/requireSuperAdmin

**Files:**
- Modify: `lib/auth/session.ts`

**Interfaces:**
- Consumes: `Role`、`isAdmin`、`isSuperAdmin`（Task 1）。
- Produces:
  - `getSessionUser(request): string | null` — 现有签名不变，但内部改为拒绝 `disabled=1` 用户（返 null）。全部 17 处现有调用点因此自动拒禁用用户。
  - `getSessionUserWithRole(request): { username: string; role: Role } | null` — 同源实现，多返回 role。
  - `requireAdmin(request): { username: string; role: Role } | NextResponse` — 未登录返 401 NextResponse；非 admin 返 403 NextResponse；否则返 `{username, role}`。
  - `requireSuperAdmin(request): { username: string; role: Role } | NextResponse` — 同上，仅 super_admin 放行，否则 403。
  - 调用方约定：`const g = requireAdmin(req); if (g instanceof NextResponse) return g;` 之后 `g.username`/`g.role` 可用。

现状（勿整体重写，替换 `getSessionUser` 并新增其余）：`getSessionUser` 只查 `sessions` 表未过期，返 username，不看 disabled。`createSession`/`destroySession`/`readCookieToken`/`SESSION_COOKIE`/`SESSION_MAX_AGE_SEC` 保持不变。

- [ ] **Step 1: 顶部 import**

`lib/auth/session.ts` 顶部加：
```ts
import { NextResponse } from "next/server";
import type { Role } from "./roles";
import { isAdmin, isSuperAdmin } from "./roles";
```

- [ ] **Step 2: 抽内部解析函数并改写 getSessionUser**

用下面整体替换现有 `getSessionUser` 函数：
```ts
// 内部：token -> {username, role}，校验未过期且未禁用；过期删行。
function resolveSession(request: Request): { username: string; role: Role } | null {
  const token = readCookieToken(request);
  if (!token) return null;
  const row = getDb().prepare(
    `SELECT s.username AS username, s.expires_at AS expires_at,
            u.role AS role, u.disabled AS disabled
     FROM sessions s JOIN users u ON u.username = s.username
     WHERE s.token = ?`
  ).get(token) as
    | { username: string; expires_at: number; role: string; disabled: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  if (row.disabled === 1) return null; // 禁用即视为未登录
  return { username: row.username, role: (row.role as Role) ?? "user" };
}

export function getSessionUser(request: Request): string | null {
  return resolveSession(request)?.username ?? null;
}

export function getSessionUserWithRole(
  request: Request
): { username: string; role: Role } | null {
  return resolveSession(request);
}

export function requireAdmin(
  request: Request
): { username: string; role: Role } | NextResponse {
  const s = resolveSession(request);
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isAdmin(s.role)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  return s;
}

export function requireSuperAdmin(
  request: Request
): { username: string; role: Role } | NextResponse {
  const s = resolveSession(request);
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isSuperAdmin(s.role)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  return s;
}
```

- [ ] **Step 3: 冒烟验证（dev 运行，禁用用户被拒）**

手测（Task 8 之后可端到端；此处先保证编译不崩）：
```bash
HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133
```
另开终端确认服务起在 **8133**（勿撞运行中的 8000）且无编译错误（`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8133/login` 返 200）。停 dev。

- [ ] **Step 4: Commit**

```bash
git add lib/auth/session.ts
git commit -m "feat: getSessionUser拒绝禁用用户+新增getSessionUserWithRole/requireAdmin/requireSuperAdmin"
```

---

## Task 4: 登录拒绝禁用用户 + register 提权 hsops + me 返回 role

**Files:**
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/auth/register/route.ts`
- Modify: `app/api/auth/me/route.ts`

**Interfaces:**
- Consumes: `SUPER_ADMIN`（Task 1）；`getSessionUserWithRole`（Task 3）。
- Produces: 登录接口对 `disabled=1` 用户返 403；hsops 注册时 role 直接写 super_admin；`/api/auth/me` 返回 `{username, role}`。

- [ ] **Step 1: login 查 disabled**

`app/api/auth/login/route.ts` 现状：查 `SELECT password_hash FROM users WHERE username=?` 后 verify 即建 session。改为同时查 disabled：
```ts
    const row = getDb().prepare("SELECT password_hash, disabled FROM users WHERE username=?")
      .get(username) as { password_hash: string; disabled: number } | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return fail();
    if (row.disabled === 1) {
      return NextResponse.json({ error: "账号已被禁用" }, { status: 403 });
    }
```
（保留原 `fail()`=401「用户名或密码错误」不变；仅在密码校验通过后追加 disabled 判断，禁用返 403 且不建 cookie。）

- [ ] **Step 2: register 对 hsops 写 super_admin**

`app/api/auth/register/route.ts` 现状 INSERT：
```ts
  db.prepare("INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)")
    .run(username, hashPassword(password), new Date().toISOString());
```
顶部加 `import { SUPER_ADMIN } from "@/lib/auth/roles";`，并把 INSERT 改为按用户名决定 role：
```ts
  const role = username === SUPER_ADMIN ? "super_admin" : "user";
  db.prepare("INSERT INTO users(username,password_hash,created_at,role) VALUES(?,?,?,?)")
    .run(username, hashPassword(password), new Date().toISOString(), role);
```

- [ ] **Step 3: me 返回 role**

`app/api/auth/me/route.ts` 现状用 `getSessionUser(req)` 返 `{username}`。改为：
```ts
import { NextResponse } from "next/server";
import { getSessionUserWithRole } from "@/lib/auth/session";

export async function GET(req: Request) {
  const s = getSessionUserWithRole(req);
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ username: s.username, role: s.role });
}
```

- [ ] **Step 4: 验证编译**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（另开终端 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8133/login` 返 200，无编译错误），停 dev。

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/login/route.ts app/api/auth/register/route.ts app/api/auth/me/route.ts
git commit -m "feat: 登录拒绝禁用用户(403)+hsops注册即super_admin+me返回role"
```

---

## Task 5: 配置类路由收紧为 admin-only

**Files:**
- Modify: `app/api/models-config/route.ts`（GET+PUT）
- Modify: `app/api/models-config/test/route.ts`（POST）
- Modify: `app/api/skills/route.ts`（GET+PATCH）
- Modify: `app/api/skills/search/route.ts`（handler 内的鉴权）
- Modify: `app/api/skills/install/route.ts`（POST）
- Modify: `app/api/auth/providers/route.ts`（GET）
- Modify: `app/api/auth/all-providers/route.ts`（GET）
- Modify: `app/api/auth/api-key/[provider]/route.ts`（GET+POST+DELETE）
- Modify: `app/api/auth/login/[provider]/route.ts`（GET+POST，**当前无鉴权**）
- Modify: `app/api/auth/logout/[provider]/route.ts`（POST，**当前无鉴权**）

**Interfaces:**
- Consumes: `requireAdmin`（Task 3）。
- Produces: 上述路由对普通 user 返 403，仅 admin/super_admin 放行。`/api/models` GET 不在此列（保留全登录用户只读，供切换模型读列表）。

**统一改法**：每个 handler 顶部原本形如
```ts
const username = getSessionUser(req);
if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });
```
替换为
```ts
const guard = requireAdmin(req);
if (guard instanceof NextResponse) return guard;
```
并把文件顶部 import 从 `getSessionUser` 改为 `requireAdmin`（若同文件仍有别处用到 username，可用 `guard.username`）。`NextResponse` 已在这些文件导入；`login/[provider]`、`logout/[provider]` 当前用 `Response.json`，需补 `import { NextResponse } from "next/server";`。

- [ ] **Step 1: models-config 三个 + skills 三个**

对 `app/api/models-config/route.ts`（GET、PUT 各一处）、`app/api/models-config/test/route.ts`（POST）、`app/api/skills/route.ts`（GET、PATCH）、`app/api/skills/install/route.ts`（POST）：顶部 import 改 `requireAdmin`，每个 handler 开头的 `getSessionUser` 两行按上面统一改法替换。

`app/api/skills/search/route.ts`：其鉴权调用在 handler 内（import 已有 `getSessionUser`），同样把 import 与调用点改为 `requireAdmin` 模式。

- [ ] **Step 2: provider/api-key 三个**

对 `app/api/auth/providers/route.ts`（GET）、`app/api/auth/all-providers/route.ts`（GET）、`app/api/auth/api-key/[provider]/route.ts`（GET、POST、DELETE 三处）：同样统一改法。

- [ ] **Step 3: login/logout provider（补鉴权）**

`app/api/auth/login/[provider]/route.ts` 与 `app/api/auth/logout/[provider]/route.ts` 当前**无任何鉴权**。分别在 POST（两文件）与 GET（login 的 SSE handler）开头加：
```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
// ...在 handler 第一行：
const guard = requireAdmin(req);
if (guard instanceof NextResponse) return guard;
```
**参数名注意**：`login/[provider]/route.ts` 的 POST 与 GET 现有签名已是 `req: Request`，直接用。**`logout/[provider]/route.ts` 的 POST 现有签名是 `_req: Request`（下划线前缀，原未使用），加 `requireAdmin(req)` 时必须先把参数名 `_req` 改成 `req`**，否则引用未定义变量编译报错。
注意 login 的 GET 是 SSE（返回 `ReadableStream`），鉴权放在建流之前直接返回 403 NextResponse 即可（浏览器 EventSource 会收到非 200 而报错，属预期）。

- [ ] **Step 4: 验证 — 无编译错误 + 未登录仍 401**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（隔离 HOME + 隔离端口，勿撞 8000），另开终端：
```bash
# 未登录访问配置类接口应 401（middleware 无 cookie 拦截）
curl -s -o /dev/null -w "models-config=%{http_code}\n" http://127.0.0.1:8133/api/models-config
curl -s -o /dev/null -w "skills=%{http_code}\n" "http://127.0.0.1:8133/api/skills?cwd=/tmp"
```
Expected: 两者均 401（无 cookie 被 middleware 拦）。普通 user 用有效 cookie 访问返 403 留待 Task 12 端到端验证。停 dev。

- [ ] **Step 5: Commit**

```bash
git add app/api/models-config app/api/skills app/api/auth/providers app/api/auth/all-providers app/api/auth/api-key app/api/auth/login/\[provider\] app/api/auth/logout/\[provider\]
git commit -m "feat: 配置类与provider/OAuth/api-key路由收紧为requireAdmin(补login/logout provider鉴权)"
```

---

## Task 6: rpc-manager 暴露按 cwd 终止会话辅助 + in-flight start 删除锁（修 R3#2）

**Files:**
- Create: `lib/auth/delete-lock.ts`
- Modify: `lib/rpc-manager.ts`
- Modify: `lib/pi-types.ts`

> **硬前置（执行顺序）**：先跳到并完整执行下方 **Task 6.5**（含测试、提交），确认 `lib/auth/paths.ts` 已导出 `canonicalizeExistingPrefix` 后，再返回执行本 Task。有效顺序为 `Task 5 → Task 6.5 → Task 6 → Task 6.6 → Task 6.7`。否则本 Task 给 `rpc-manager.ts` 增加的 import 在编译验证时不存在。Task 6.5 保留在本节之后仅为保持删除锁专题的阅读结构，执行者不得按版面顺序直接先跑 Task 6。

**Interfaces:**
- 架构（修 R5#5）：删除锁状态机在**新纯模块 `lib/auth/delete-lock.ts`**（`createDeleteLock()` 工厂，引用计数 Map + operationCwds `{cwd,done}` + `withStartGuardCanonical`），无 pi/fs 依赖、路径参数约定 canonical。`lib/rpc-manager.ts` 做**薄包装**：`getDeleteLock()` 取 globalThis 单例，导出的 `markRootDeleting`/`unmarkRootDeleting`/`waitForStartsUnderRoot`/`withStartGuard`/`withCwdOperationGuard` 先 `canon` 再委托纯模块。纯模块为兼容既有计划仍保留方法名 `withStartGuardCanonical`，但其登记对象同时覆盖 start 与已有会话命令。
- Produces（rpc-manager 导出，签名对调用方不变）：
  - `abortSessionsUnderCwd(rootDir: string): Promise<number>` — 依赖会话注册表故留 rpc-manager。遍历注册表，对 **`canon(wrapper.cwd)`** 落在 `canon(rootDir)` 内的每个 wrapper `await send({type:"abort"})` 后 `destroy()`、移除；返回终止数。**fail-closed**：任一 abort 抛错则向上抛。canonical 比较使外部软链别名不漏 abort（R3#5）。
  - `markRootDeleting(rootDir)` / `unmarkRootDeleting(rootDir)` — 薄包装：`canon(rootDir)` 后委托纯模块引用计数（mark +1、unmark -1，归 0 才移除，R3#4 并发不提前解锁）。
  - `waitForStartsUnderRoot(rootDir): Promise<void>` — 薄包装：`canon(rootDir)` 后委托纯模块，等所有 canonical cwd 落在其内的 in-flight `done` settle。**fail-closed**：普通启动失败被吞，删除窗口清理失败（`err.deleteWindowCleanup===true`）重新抛出（R3#4/R5#1）。覆盖 `startRpcSession` 的 start、`/api/agent/new` 的 `withStartGuard` 段与 `/api/agent/[id]` 的 `withCwdOperationGuard` 命令段。
  - `withStartGuard<T>(cwd, body): Promise<T>` — 薄包装：`canon(cwd)` 后委托纯模块 `withStartGuardCanonical`。前置检查拒绝删除窗口内请求；登记 in-flight（`done` 反映 body 结果，含删除窗口清理失败传播），使 `waitForStartsUnderRoot` 能等到本段（R3#1）。
  - `withCwdOperationGuard<T>(cwd, body): Promise<T>` — 与 `withStartGuard` 使用同一真实锁状态机，专供已有会话命令派发；删除标记后拒绝新命令，标记前已登记的命令由删除流程等待 settle。
  - `assertSessionCommandAllowed(alive,deleting,commandType): void`（`delete-lock.ts`）— wrapper 与单测共用：已销毁时所有命令拒绝；删除窗口内只有 `abort` 豁免。
- **修改 `startRpcSession`**：入口 `const canonicalCwd = canon(cwd)` 与删除状态检查必须放在 existing/inflight fast path **之前**，禁止已有 wrapper 或共享启动 Promise 绕过删除锁。下游 `SessionManager.create`/`SettingsManager.create`/`DefaultResourceLoader`/`createAgentSession`/`wrapper.cwd` 全用 canonicalCwd，jsonl header 也存 canonical（R3#3）。经 `getDeleteLock()` 的 `isCwdUnderDeletingRoot`/`registerStart`/`unregisterStart`/`nextKey` 参与临界区：创建前后各检查一次，落在删除 root 则抛错拒绝（第二次检查销毁已建 inner、删已落 jsonl，**按清理成败分流**：仅失败才 `deleteWindowCleanup` 传播，成功抛普通错误由等待函数吞掉，R5#1）。
- **修改 `AgentSessionWrapper.send`**：读取命令类型后先拒绝 `_alive===false`；除内部删除必须使用的 `abort` 外，所有命令先 `assertCwdNotDeleting(this.cwd)`。这不是 `/api/agent/[id]` operation guard 的替代，而是防止其他直接调用方或 wrapper 销毁竞态绕过。

现状（供参照）：`getRegistry()` 返回 `globalThis.__piSessions`（`Map<string, AgentSessionWrapper>`）；`getLocks()` 返回 `globalThis.__piStartLocks`（`Map<sessionId, Promise<{session,realSessionId}>>`，现有 in-flight start 锁，仍保留）；`AgentSessionWrapper` 有 `cwd: string`、`async send(command)`、`destroy()`；`send({type:"abort"})` 内部调 `inner.abort()`。**wrapper 无公开 `abort()`**，故用 `send`。rpc-manager 顶层静态 import `@earendil-works/pi-coding-agent`，`startRpcSession` 内 `SessionManager.create/open` 等；`inner` 有 `abort()`、`sessionFile`、`sessionId`，pi 的 `AgentSession` 还有 `dispose()`（项目 `AgentSessionLike` 接口需补 `dispose?()`）。

- [ ] **Step 1: 新建纯锁模块 `lib/auth/delete-lock.ts` + rpc-manager 薄包装（修 R5#5：测真实代码）**

**为何抽独立模块（R5#5）**：删除锁状态机若内联在 `lib/rpc-manager.ts`，因后者顶层静态 import pi，`node --experimental-strip-types` 无法直接测其真实实现（测试只能复制算法，生产写错测试仍过）。故把锁状态机抽到**无 pi 依赖的纯模块** `lib/auth/delete-lock.ts`（只 `import path from "path"`，无本地无扩展名 import），rpc-manager 与单测**共同 import 同一真实实现**。约定：delete-lock 的所有路径参数**已是 canonical**（canon 由 rpc-manager 在调用前做），故 delete-lock 内不依赖 paths.ts、可被 strip-types 加载。用 `createDeleteLock()` 工厂：生产用 globalThis 单例，测试每用例 new 独立实例（隔离、可测时序）。

`lib/auth/delete-lock.ts`:
```ts
import path from "path";

export type OperationEntry = { cwd: string; done: Promise<unknown> };

export type DeleteWindowAbortError = Error & { deleteWindowCleanup?: true };

// startRpcSession 与单测共用同一分类逻辑：只有清理失败才打 fail-closed 标记；
// 清理成功后的“放弃启动”是普通错误，等待删除时可安全吞掉。
export function createDeleteWindowAbortError(cleanupErr: unknown): DeleteWindowAbortError {
  const hasCleanupError = cleanupErr !== null;
  const err = new Error(
    hasCleanupError
      ? `删除窗口清理失败: ${String(cleanupErr)}`
      : "用户目录删除中，已清理并放弃会话"
  ) as DeleteWindowAbortError;
  if (hasCleanupError) err.deleteWindowCleanup = true;
  return err;
}

// wrapper 与单测共用：已销毁会话拒绝所有命令；删除窗口仅允许内部 abort。
export function assertSessionCommandAllowed(
  alive: boolean,
  deleting: boolean,
  commandType: string
): void {
  if (!alive) throw new Error("AgentSession 已销毁");
  if (deleting && commandType !== "abort") {
    throw new Error("用户目录正在删除，拒绝会话操作");
  }
}

export interface DeleteLock {
  markRootDeleting(canonicalRoot: string): void;       // 引用计数 +1
  unmarkRootDeleting(canonicalRoot: string): void;     // 引用计数 -1，归 0 移除
  isCwdUnderDeletingRoot(canonicalCwd: string): boolean;
  registerStart(key: string, canonicalCwd: string, done: Promise<unknown>): void;
  unregisterStart(key: string): void;
  waitForStartsUnderRoot(canonicalRoot: string): Promise<void>;
  withStartGuardCanonical<T>(canonicalCwd: string, body: () => Promise<T>): Promise<T>;
  nextKey(prefix: string): string;
}

// 纯锁状态机（无 pi/无 fs/无本地 import）。所有路径参数约定为 canonical。
export function createDeleteLock(): DeleteLock {
  const deletingRoots = new Map<string, number>();   // canonical root -> 引用计数
  const operationCwds = new Map<string, OperationEntry>(); // start/command key -> {canonical cwd, 完成 promise}
  let seq = 0;
  const under = (root: string, cwd: string) => cwd === root || cwd.startsWith(root + path.sep);
  const isCwdUnderDeletingRoot = (canonicalCwd: string): boolean => {
    for (const root of deletingRoots.keys()) if (under(root, canonicalCwd)) return true;
    return false;
  };
  const waitForStartsUnderRoot = async (canonicalRoot: string): Promise<void> => {
    const pending: Promise<unknown>[] = [];
    for (const { cwd, done } of operationCwds.values()) {
      if (under(canonicalRoot, cwd)) {
        pending.push(done.catch((e: unknown) => {
          // 删除窗口清理失败传播；普通启动失败吞掉（修 R3#4/R5#1）
          if ((e as { deleteWindowCleanup?: boolean } | null)?.deleteWindowCleanup) throw e;
          return undefined;
        }));
      }
    }
    await Promise.all(pending);
  };
  return {
    markRootDeleting: (r) => deletingRoots.set(r, (deletingRoots.get(r) ?? 0) + 1),
    unmarkRootDeleting: (r) => {
      const n = (deletingRoots.get(r) ?? 0) - 1;
      if (n <= 0) deletingRoots.delete(r); else deletingRoots.set(r, n);
    },
    isCwdUnderDeletingRoot,
    registerStart: (k, cwd, done) => operationCwds.set(k, { cwd, done }),
    unregisterStart: (k) => operationCwds.delete(k),
    waitForStartsUnderRoot,
    withStartGuardCanonical: async (canonicalCwd, body) => {
      if (isCwdUnderDeletingRoot(canonicalCwd)) throw new Error("用户目录正在删除，拒绝创建会话");
      const key = `__guard__${++seq}`;
      // done 反映本段结果：body 内删除窗口清理失败会经 done 传播到 waitForStartsUnderRoot（消除时序竞态）
      const done = (async () => {
        if (isCwdUnderDeletingRoot(canonicalCwd)) throw new Error("用户目录删除中，拒绝创建会话");
        return await body();
      })();
      operationCwds.set(key, { cwd: canonicalCwd, done });
      try { return await done; } finally { operationCwds.delete(key); }
    },
    nextKey: (prefix) => `${prefix}${++seq}`,
  };
}
```

**rpc-manager 薄包装**：`lib/rpc-manager.ts` 顶部确保 `import path from "path";`，并 import 纯模块与 canonical 化 helper：
```ts
import {
  createDeleteLock,
  createDeleteWindowAbortError,
  assertSessionCommandAllowed,
  type DeleteLock,
} from "./auth/delete-lock";
import { canonicalizeExistingPrefix } from "@/lib/auth/paths";

declare global {
  // ...已有 __piSessions / __piStartLocks...
  var __piDeleteLock: DeleteLock | undefined;
}
function getDeleteLock(): DeleteLock {
  if (!globalThis.__piDeleteLock) globalThis.__piDeleteLock = createDeleteLock();
  return globalThis.__piDeleteLock;
}
// canon：仅委托 canonicalizeExistingPrefix（仅 ENOENT 降级、其他错误抛出，修 R5#2），不再 catch 降级。
function canon(p: string): string {
  return canonicalizeExistingPrefix(p || "");
}
// rpc-manager 侧薄包装：先 canon，再委托纯锁模块。canon 抛错（路径异常）时传播 → 调用方 fail-closed。
export function markRootDeleting(rootDir: string): void { getDeleteLock().markRootDeleting(canon(rootDir)); }
export function unmarkRootDeleting(rootDir: string): void { getDeleteLock().unmarkRootDeleting(canon(rootDir)); }
export async function waitForStartsUnderRoot(rootDir: string): Promise<void> {
  return getDeleteLock().waitForStartsUnderRoot(canon(rootDir));
}
export async function withStartGuard<T>(cwd: string, body: () => Promise<T>): Promise<T> {
  return withCwdOperationGuard(cwd, body);
}
export async function withCwdOperationGuard<T>(cwd: string, body: () => Promise<T>): Promise<T> {
  return getDeleteLock().withStartGuardCanonical(canon(cwd), body);
}
function isCwdDeleting(cwd: string): boolean {
  return getDeleteLock().isCwdUnderDeletingRoot(canon(cwd));
}
```
> `abortSessionsUnderCwd` 依赖会话注册表（pi wrapper），留在 rpc-manager（见 Step 3），不进纯模块；它用 `canon(wrapper.cwd)` 比较，而 `wrapper.cwd` 已是 canonical（Step 2 持久化），canon 幂等。

- [ ] **Step 2: wrapper 命令二次防线 + startRpcSession fast path 前置检查及清理传播**

先改 `AgentSessionWrapper.send` 的开头。`abortSessionsUnderCwd` 在删除标记后必须仍能调用 `send({type:"abort"})`，因此只豁免 `abort`，不得豁免 prompt/compact/fork/set_model 等其他命令。把现有函数开头从 `this.resetIdleTimer(); const type = ...` 精确替换为：
```ts
const type = command.type as string;
const deleting = type === "abort" ? false : isCwdDeleting(this.cwd);
assertSessionCommandAllowed(this._alive, deleting, type);
this.resetIdleTimer();
```
此代码块位于 `async send(...)` 函数体最前面；后面紧接已有 `switch (type)`，所有 case 和函数尾括号不移动、不复制。实现后检查 `send` 内只能有一个 `const type` 和一个 `switch (type)`。

再改造 `startRpcSession`。**四处要点**：(a) 入口把 cwd canonical 化和首次删除检查放到 existing/inflight fast path 前，fast path 也不能绕过；(b) 下游 `SessionManager.create`/`SettingsManager.create`/`DefaultResourceLoader`/`createAgentSession`/`wrapper.cwd` **全部改用 canonical cwd**，使 jsonl header 也存 canonical；(c) 二次检查须真正清理已建 inner，且**放在 `wrapper.start()` 之后、`cacheSessionPath`/`wrapper.onDestroy`/`registry.set` 之前**；(d) 删除窗口的清理失败必须**传播**（不吞），使删除编排 fail-closed。

下面给出**完整替换后的 `startRpcSession`**（对照现有 `lib/rpc-manager.ts:365-445`，新增/改动行以注释标出）：
```ts
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[]
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  // 必须在 existing/inflight fast path 前 canonicalize + 检查，禁止快速返回绕过删除锁。
  const canonicalCwd = canon(cwd);
  const lock = getDeleteLock();
  if (lock.isCwdUnderDeletingRoot(canonicalCwd)) {
    throw new Error("用户目录正在删除，拒绝启动或复用会话");
  }

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const startKey = lock.nextKey("__start__"); // 独立于 sessionId，供 registerStart/unregisterStart

  const starting = (async () => {
    try {
      const { SessionManager, getAgentDir, DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
      const agentDir = getAgentDir();

      const sessionManager = sessionFile
        ? SessionManager.open(sessionFile, undefined)
        : SessionManager.create(canonicalCwd, undefined);              // was cwd
      const extraExtensionPaths = getExtraExtensionPaths();
      const settingsManager = extraExtensionPaths.length > 0 ? SettingsManager.create(canonicalCwd, agentDir) : undefined;  // was cwd
      const resourceLoader = extraExtensionPaths.length > 0
        ? new DefaultResourceLoader({
            cwd: canonicalCwd,                                          // was cwd
            agentDir,
            settingsManager,
            additionalExtensionPaths: extraExtensionPaths,
          })
        : undefined;
      if (resourceLoader) await resourceLoader.reload();

      let toolsOption: string[] | undefined;
      if (toolNames !== undefined) {
        toolsOption = toolNames.length === 0 ? [] : undefined;
      }

      const { session: inner } = await createAgentSession({
        cwd: canonicalCwd,                                             // was cwd
        agentDir,
        sessionManager,
        ...(settingsManager ? { settingsManager } : {}),
        ...(resourceLoader ? { resourceLoader } : {}),
        ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
      });

      if (toolNames && toolNames.length > 0) {
        setActiveTools(inner, toolNames);
      }
      if (toolNames?.length === 0) {
        inner.agent.state.systemPrompt = "";
      }

      const wrapper = new AgentSessionWrapper(inner);
      wrapper.cwd = canonicalCwd;                                      // was cwd
      wrapper.start();

      const realSessionId = inner.sessionId as string;
      const realSessionFile = inner.sessionFile as string | undefined;

      // === 二次检查（新增，修 R3#2/#4/R5#1/#4）===
      // 位置：wrapper.start() 之后、cacheSessionPath/onDestroy/registry.set 之前。
      // 覆盖"markRootDeleting 发生在本次创建期间"的窗口——此时 inner/wrapper 已建但尚未进注册表。
      if (lock.isCwdUnderDeletingRoot(canonicalCwd)) {
        // 删除窗口清理：销毁 inner + 删已落 jsonl。区分两种结果（修 R5#1）：
        //   - 清理全部成功 → 抛"普通"错误（无 deleteWindowCleanup 标记），waitForStartsUnderRoot 吞掉，删除继续。
        //   - 清理有失败    → 标记 deleteWindowCleanup=true 传播，使删除编排 fail-closed（inner/jsonl 未清净）。
        let cleanupErr: unknown = null;
        try {
          wrapper.destroy();          // 清 idleTimer + unsubscribe
          await inner.abort();        // 停止 inner 正在进行的 turn/写入
        } catch (e) { cleanupErr = e; }
        try {
          inner.dispose?.();          // 移除 inner 内部监听/扩展资源（pi AgentSession.dispose，修 R5#4）
        } catch (e) { cleanupErr = cleanupErr ?? e; }
        try {
          if (realSessionFile) { rmSync(realSessionFile, { force: true }); invalidateSessionPathCache(realSessionId); }
        } catch (e) { cleanupErr = cleanupErr ?? e; }
        throw createDeleteWindowAbortError(cleanupErr);  // 生产纯模块统一分类 helper，测试 import 同一函数
      }
      // === 二次检查结束 ===

      if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);
      wrapper.onDestroy(() => registry.delete(realSessionId));
      registry.set(realSessionId, wrapper);

      return { session: wrapper, realSessionId };
    } finally {
      lock.unregisterStart(startKey); // start settle（成功/失败/被拒）后清 cwd 记录
    }
  })().finally(() => locks.delete(sessionId));  // 原有 finally 清 locks 不变

  lock.registerStart(startKey, canonicalCwd, starting); // 记录 canonical in-flight cwd + 完成信号
  locks.set(sessionId, starting);
  return starting;
}
```
> 顶部按需补 import：`import { rmSync } from "fs";`（若未有）、`import { invalidateSessionPathCache } from "@/lib/session-reader";`。
> **`inner.dispose?()`（修 R5#4）**：pi 的 `AgentSession` 有 `dispose()`（移除内部事件监听、失效扩展 ctx、`cleanupSessionResources`），比 `wrapper.destroy()`（只清 wrapper 的 timer/订阅）更彻底。项目自定义接口 `AgentSessionLike`（`lib/pi-types.ts`）当前**未声明 `dispose`**，需给它补 `dispose?(): void;`（可选，因不同实现未必都有），再在二次检查里 `inner.dispose?.()` 并把失败并入 `cleanupErr`。若 `inner` 无 `abort()`（以实际 pi API 为准），退化为仅 `wrapper.destroy()` + `dispose?()` + 删 session 文件，且退化仍须把删文件失败并入 `cleanupErr`。
> **清理成败分流（修 R5#1）**：只有 `cleanupErr` 非空才给错误打 `deleteWindowCleanup=true` 传播、令删除 fail-closed；清理全部成功时抛不带标记的普通错误，由 `waitForStartsUnderRoot` 吞掉，删除继续（inner/jsonl 已清净，无需中止）。绝不"撞上一个 in-flight start 就整体失败"。
> **canonical cwd 持久化（R3#3）**：下游全用 `canonicalCwd`，使 `SessionManager.create` 写进 jsonl header 的 cwd 即 canonical。即便日后启动用的软链别名被删，删除用户时 `wrapper.cwd`（canonical）与 header cwd（canonical）都能正确归属，不漏 abort/漏删。
> 说明：两次检查夹住整个创建临界区。**Q1 的 mkdir 竞态另需在 `/api/agent/new` 拦（见 Task 6.6）**，因为目录创建发生在调用 `startRpcSession` 之前。

- [ ] **Step 3: 新增 abortSessionsUnderCwd（canonical 比较，依赖 registry 故留 rpc-manager）**

`markRootDeleting`/`unmarkRootDeleting`/`waitForStartsUnderRoot`/`withStartGuard`/`withCwdOperationGuard` 已在 Step 1 作为 rpc-manager 薄包装导出（委托纯模块 `delete-lock.ts`）。本步只加**依赖会话注册表**的 `abortSessionsUnderCwd`（不进纯模块，因它需遍历 pi wrapper）。在 `getRpcSession(...)` 附近追加：
```ts
// 终止并移除 canonical cwd 落在 rootDir 内的所有运行中会话。删除用户前调用，
// 防止残留会话（含经外部软链别名启动的）继续向已删目录写入。wrapper 无公开 abort()，用 send 命令。
// fail-closed：send({type:"abort"}) 抛错则整体抛出，由调用方中止删除、保留用户行。
// 修 R3#5：用 canon(wrapper.cwd) 与 canon(root) 比较——wrapper.cwd 已 canonical（Step 2 持久化），canon 幂等。
export async function abortSessionsUnderCwd(rootDir: string): Promise<number> {
  const root = canon(rootDir);
  const registry = getRegistry();
  let count = 0;
  for (const [id, wrapper] of Array.from(registry.entries())) {
    const cwd = canon(wrapper.cwd || "");
    if (cwd === root || cwd.startsWith(root + path.sep)) {
      // 不吞异常：abort 失败即终止失败，须让删除序列 fail-closed。
      await wrapper.send({ type: "abort" });
      wrapper.destroy();
      registry.delete(id);
      count++;
    }
  }
  return count;
}
```
> **R3#1 目录重建竞态**：`/api/agent/new` 的 `mkdirSync(cwd)` 发生在 `startRpcSession` **之前**，仅靠 startRpcSession 的检查挡不住"先 mkdir 重建目录"。`withStartGuard`（Step 1）把 mkdir+start 整段登记为 in-flight：删除的 `waitForStartsUnderRoot` 等它结束才扫描/删目录，且 guard 前置检查拒绝删除窗口新起的请求（见 Task 6.6）。
> **已有会话命令竞态**：`/api/agent/[id]` 原 fast path 不调用 `startRpcSession`，故 Task 6.6 必须用 `withCwdOperationGuard` 包住重新取 wrapper + send；本 Task 的 wrapper alive/删除检查是第二道防线。删除先等这些 operation settle，再调用本步的 abort，避免旧鉴权请求在 abort 窗口追加新 prompt。
> **R3#4 并发删除**：引用计数（delete-lock）——两个 DELETE 同一 root，计数到 2；先完成的 unmark 只减到 1，锁仍在；后完成减到 0 才移除。
> **R3#5 canonical 一致**：`isCwdUnderDeletingRoot`/`waitForStartsUnderRoot`/`abortSessionsUnderCwd` 及 registerStart 存储全用 canonical（纯模块约定 + rpc-manager 薄包装 canon），与 `resolveSessionOwnership` 口径统一，外部软链别名不漏判。

- [ ] **Step 4: 验证编译**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（隔离 HOME + 隔离端口，确认无编译错误），停 dev。

- [ ] **Step 5: Commit**

```bash
git add lib/auth/delete-lock.ts lib/rpc-manager.ts lib/pi-types.ts
git commit -m "feat: 删除锁覆盖启动与已有会话命令并加强wrapper状态检查"
```

---

## Task 6.5: session/jsonl 归属 helper `resolveSessionOwnership`（TDD，修 R3#1）

**Files:**
- Modify: `lib/auth/paths.ts`
- Test: `__tests__/lib/auth/session-ownership.test.ts`

**背景（R3#1 + R3#2 修正）**：会话列表/详情/删除扫描原都用 `resolveExistingAndCheck(cwd)`，它对 cwd 做 `realpathSync`——**cwd 目录一旦被用户删除（如删了某个项目目录），realpath 抛错即返 false**，导致该 cwd 的历史 jsonl 对话：管理员看不到、删除用户时也删不掉。这与"查看全部对话""删除连带删全部对话"矛盾。
但**简单地"realpath 抛 ENOENT 就降级字符串判断"会误判坏软链/外部软链子路径**（R3#2 修正）：`alice/escape -> /etc` 时 `realpathSync("alice/escape/not-exist")` 抛 ENOENT（`/etc/not-exist` 不存在），若直接对原始字符串 `.../alice/escape/not-exist` 判边界会**错判在 alice 根内**，实际它指向 `/etc` 外部。正确做法是**对路径已存在的最长前缀做 realpath（跟随其中的 symlink），只把不存在的纯尾部当字符串拼接**，再判边界。这样：真正被删的根内目录 → 前缀是用户根内的真实路径 → true；`escape/not-exist` → 前缀 `escape` realpath 到 `/etc` → 拼 `not-exist` 落在根外 → false。

**Interfaces:**
- Produces（两个函数，前者供后者与 Q5 复用）：
  - `canonicalizeExistingPrefix(target: string): string` — 从 `target` 绝对化后，找**存在的最长祖先前缀**对其 `realpathSync`（解析该前缀内的所有 symlink），再把不存在的剩余段原样拼回。仅 `ENOENT` 表示该前缀不存在并继续缩短；`EACCES`/`ELOOP`/`EPERM` 等其他错误向上抛，由调用方 fail-closed。
  - `resolveSessionOwnership(cwd: string, username: string): boolean` —
    - 空 cwd → false。
    - 否则 `isInsideUserRoot(canonicalizeExistingPrefix(cwd), username)`：cwd 完全存在时等价 realpath（防 symlink 逃逸）；cwd 尾部已删时用"已存在前缀的 realpath + 字符串尾部"判边界（保留 R3#1 历史 jsonl，且不被坏/外部软链绕过 R3#2）。
    - `canonicalizeExistingPrefix` 内部 realpath 抛非 ENOENT 错误（坏链权限等）→ 向上抛 → `resolveSessionOwnership` catch 后 fail-closed 返 false。
  - **仅用于 session/jsonl 归属判定**（列表过滤、删除扫描）。**文件读取/列表仍必须用 `resolveExistingAndCheck`**（要求 target 整体 realpath 成功），不放宽——放宽会让指向不存在路径的读取绕过 realpath。

- [ ] **Step 1: 写失败测试**

`__tests__/lib/auth/session-ownership.test.ts`（用隔离临时目录，覆盖 cwd 存在 / cwd 已删 / 越界 / 坏软链 / 外部软链子路径五类）:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { mkdirSync, rmSync, symlinkSync, chmodSync } from "fs";
import { resolveSessionOwnership } from "../../../lib/auth/paths.ts";

// 说明：resolveSessionOwnership 内部用 getUserRoot(os.homedir()/pi-users/<user>)。
// 本测试须在隔离 HOME 下跑（见 Task 15 前置：HOME=/home/hsops/.pi-admin-dev-home npm test），
// 使 os.homedir() 指向隔离目录，测试建的 pi-users/<user> 落在隔离 HOME 内。
const root = path.join(os.homedir(), "pi-users", "owntest");

test("cwd 存在且在 root 内 → true（realpath 通过）", () => {
  mkdirSync(path.join(root, "proj"), { recursive: true });
  assert.equal(resolveSessionOwnership(path.join(root, "proj"), "owntest"), true);
  rmSync(root, { recursive: true, force: true });
});

test("cwd 已删但路径在 root 内 → true（前缀 realpath+尾部，修 R3#1 核心）", () => {
  // 只建 root，不建 deleted-proj，模拟"用户删了项目目录，jsonl 仍在"
  mkdirSync(root, { recursive: true });
  assert.equal(resolveSessionOwnership(path.join(root, "deleted-proj"), "owntest"), true);
  rmSync(root, { recursive: true, force: true });
});

test("cwd 已删且在 root 外 → false", () => {
  assert.equal(resolveSessionOwnership("/home/other/pi-users/x/proj", "owntest"), false);
});

test("前缀相近但非子路径 → false", () => {
  assert.equal(resolveSessionOwnership(path.join(os.homedir(), "pi-users", "owntest2", "p"), "owntest"), false);
});

test("外部软链的不存在子路径 → false（修 R3#2：escape->/etc 下 not-exist 不得误判在根内）", () => {
  mkdirSync(root, { recursive: true });
  symlinkSync("/etc", path.join(root, "escape")); // root 内软链指向外部 /etc
  // escape/not-exist：/etc/not-exist 不存在（ENOENT），但前缀 escape realpath 到 /etc，落在根外
  assert.equal(resolveSessionOwnership(path.join(root, "escape", "not-exist"), "owntest"), false);
  // 即便 escape 本身（存在，指向 /etc）也不属该用户
  assert.equal(resolveSessionOwnership(path.join(root, "escape"), "owntest"), false);
  rmSync(root, { recursive: true, force: true });
});

test("坏软链（指向不存在目标）→ false（fail-closed，不降级字符串）", () => {
  mkdirSync(root, { recursive: true });
  symlinkSync(path.join(root, "nowhere-target"), path.join(root, "broken")); // 目标不存在
  // broken 本身 lstat 存在但 realpath(broken) 抛 ENOENT；前缀解析到 broken 时 realpathSync 抛错 → fail-closed
  assert.equal(resolveSessionOwnership(path.join(root, "broken", "x"), "owntest"), false);
  rmSync(root, { recursive: true, force: true });
});

test("软链环 → false（realpath 抛 ELOOP，fail-closed，修 R3#2）", () => {
  mkdirSync(root, { recursive: true });
  // 造环：a->b, b->a
  symlinkSync(path.join(root, "b"), path.join(root, "a"));
  symlinkSync(path.join(root, "a"), path.join(root, "b"));
  // realpathSync 遇环抛 ELOOP（非 ENOENT）→ canonicalizeExistingPrefix 上抛 → resolveSessionOwnership fail-closed
  assert.equal(resolveSessionOwnership(path.join(root, "a", "x"), "owntest"), false);
  rmSync(root, { recursive: true, force: true });
});

test("无权限祖先 → false（realpath 抛 EACCES，fail-closed，修 R3#2）", () => {
  // 说明：需非 root 用户运行才有意义（root 绕过权限）。CI 若以 root 跑，此用例可能得 true，
  // 应在文档标注并优先在普通用户环境验证；核心断言是"EACCES 不降级为字符串边界"。
  mkdirSync(path.join(root, "secret"), { recursive: true });
  try {
    chmodSync(path.join(root, "secret"), 0o000); // 去掉进入权限
    // 访问 secret 下子路径时 realpath 对 secret 抛 EACCES（非 ENOENT）→ 上抛 → fail-closed
    const r = resolveSessionOwnership(path.join(root, "secret", "x"), "owntest");
    // 普通用户：EACCES→false。若以 root 运行绕过权限，允许 true（环境差异，见上）。
    assert.ok(r === false || process.getuid?.() === 0);
  } finally {
    try { chmodSync(path.join(root, "secret"), 0o700); } catch { /* ignore */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("空 cwd → false", () => {
  assert.equal(resolveSessionOwnership("", "owntest"), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm test`
Expected: FAIL（`resolveSessionOwnership` 未导出）。

- [ ] **Step 3: 写实现**

在 `lib/auth/paths.ts` 追加（复用已有 `isInsideUserRoot`；`realpathSync` 已 import；需 `lstatSync`）:
```ts
import { realpathSync, lstatSync } from "fs"; // realpathSync 已有，补 lstatSync

// 对 target 做"部分 realpath"：用 lstat（不跟随）找**本身存在的最长祖先前缀**（软链本身也算存在），
// 对该前缀 realpathSync（跟随其中所有 symlink），再把不存在的剩余段原样拼回。
// - 纯不存在尾部（cwd 已删）→ 前缀是真实祖先，尾部字符串拼回，保留 R3#1 历史归属。
// - 外部软链子路径（escape->/etc 下 not-exist）→ 前缀含 escape，realpath 解析到 /etc，落在根外。
// - 坏软链（指向不存在目标）→ 前缀 lstat 存在但 realpathSync 抛 ENOENT → 向上抛 → 调用方 fail-closed。
// 用 lstat（非 existsSync）找前缀是关键：existsSync 跟随软链，会把坏软链当"不存在"而误当字符串尾部。
// fail-closed（修 R3#2）：只有明确 ENOENT 才判"该前缀不存在、继续找更短祖先"；EACCES/ELOOP/EPERM 等
// 其他 lstat/realpath 错误一律**向上抛出**（不降级为字符串拼接），避免无权限祖先/软链环下的逃逸被误判在根内。
export function canonicalizeExistingPrefix(target: string): string {
  const abs = path.resolve(target);
  const segs = abs.split(path.sep).filter(Boolean);
  for (let i = segs.length; i >= 0; i--) {
    const prefix = path.sep + segs.slice(0, i).join(path.sep);
    let exists = i === 0; // 根恒存在
    if (!exists) {
      try {
        lstatSync(prefix); // lstat 不跟随，软链本身也算存在
        exists = true;
      } catch (e) {
        // 仅 ENOENT 视为"不存在、继续找更短祖先"；其他错误（EACCES/ELOOP/EPERM…）向上抛 → fail-closed
        if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
        exists = false;
      }
    }
    if (exists) {
      const realPrefix = i === 0 ? path.sep : realpathSync(prefix); // 坏软链/环/无权在此抛 → 上抛 fail-closed
      const rest = segs.slice(i);
      return rest.length ? path.join(realPrefix, ...rest) : realPrefix;
    }
  }
  return abs; // 理论到不了（root 恒存在）
}

// session/jsonl 归属专用（修 R3#1/R3#2）：用"已存在前缀 realpath + 字符串尾部"判边界。
// cwd 完全存在 → 等价 realpath 防逃逸；cwd 尾部已删 → 保留历史 jsonl 归属；
// 经外部/坏 symlink 的子路径 → 前缀 realpath 解析到真实位置或抛错，落在根外/fail-closed（不被绕过）。
// 只用于 session/jsonl 归属判定；文件读取仍用 resolveExistingAndCheck（要求整体 realpath 成功）。
export function resolveSessionOwnership(cwd: string, username: string): boolean {
  if (!cwd) return false;
  try {
    return isInsideUserRoot(canonicalizeExistingPrefix(cwd), username);
  } catch {
    return false; // realpath 抛错（坏链/权限等）→ fail-closed
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm test`
Expected: PASS（含"cwd 已删但路径在 root 内 → true"）。

- [ ] **Step 5: Commit**

```bash
git add lib/auth/paths.ts __tests__/lib/auth/session-ownership.test.ts
git commit -m "feat: resolveSessionOwnership(cwd已删仍判归属,修历史jsonl漏查漏删)+单测"
```

---

## Task 6.6: 新建与已有会话请求统一纳入删除锁临界区

**Files:**
- Modify: `app/api/agent/new/route.ts`
- Modify: `app/api/agent/[id]/route.ts`

**背景（R3#1）**：竞态有两条。第一，`app/api/agent/new/route.ts` 在 `startRpcSession` 前先 `mkdirSync(cwd)`，已鉴权并暂停的请求可能在删除后重建目录；须把 mkdir + start + 首条命令整段放入 `withStartGuard`。第二，`app/api/agent/[id]/route.ts` 当前在 `await req.json()` 后对已有 wrapper 走 `getRpcSession(id) -> existing.send(body)` fast path，完全绕过 `startRpcSession`；该请求若在删除标记前通过鉴权、在删除窗口内恢复，可能向正在 abort 的 wrapper 再发 prompt。须把“再次取得已有 wrapper或启动 + send”整段放入 `withCwdOperationGuard`。wrapper 自身的 alive/删除状态检查由 Task 6 Step 2 提供二次防线。

**Interfaces:**
- Consumes: `withStartGuard`、`withCwdOperationGuard`（Task 6，`lib/rpc-manager.ts`）。
- Produces: 删除窗口内到达的 `/api/agent/new` 请求被拒绝（不重建目录）；删除窗口内到达的 `/api/agent/[id]` POST 命令被拒绝（不再向已有 wrapper 写）；删除流程 `waitForStartsUnderRoot` 会等待标记前已登记的 mkdir/start/command 段 settle 后再 abort、扫描和删除。

现状（供参照，`app/api/agent/new/route.ts`）：`POST` 校验登录/cwd 归属后 `mkdirSync(cwd)`，构造 tempKey，`await startRpcSession(tempKey, "", cwd, toolNames)`，随后 `set_model`/`set_thinking_level`/发首条命令，返回 `{ sessionId, data }`。

- [ ] **Step 1: 用 withStartGuard 包住 mkdir + startRpcSession**

顶部加 `import { withStartGuard } from "@/lib/rpc-manager";`（已 import `startRpcSession`）。把原来"`mkdirSync(cwd)` → `startRpcSession` → set_model/send → 组装返回"整段移入 `withStartGuard(cwd, async () => { ... })`：
```ts
    // 原：mkdirSync(cwd, { recursive: true });  ...startRpcSession...
    // 改为整段纳入删除锁临界区（修 R3#1）：guard 前置检查拒绝删除窗口内的请求，
    // 并登记 in-flight，使删除的 waitForStartsUnderRoot 等到本段结束再删目录。
    const payload = await withStartGuard(cwd, async () => {
      mkdirSync(cwd, { recursive: true });
      const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } =
        command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown };
      const tempKey = `__new__${Date.now()}`;
      const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);
      if (provider && modelId) await session.send({ type: "set_model", provider, modelId });
      if (thinkingLevel) await session.send({ type: "set_thinking_level", level: thinkingLevel });
      const result = await session.send(promptCommand);
      return { success: true, sessionId: realSessionId, data: result };
    });
    return NextResponse.json(payload);
```
被删除锁拒绝时 `withStartGuard` 抛错，落入 `POST` 既有 `catch`，返回 500 `{ error }`（前端表现为该次新建失败；用户已被禁用/删除，属预期）。若希望更明确可在 catch 中对该错误返回 409，但非必需。

> 注意：`mkdirSync` 前的 cwd 归属校验（`resolveExistingAndCheck`/`resolveParentAndCheck`）保持不变，仍在 guard 外先做（那是路径越权校验，与删除锁正交）；guard 只负责把"真正创建目录并启动"的副作用纳入删除临界区。

- [ ] **Step 2: `/api/agent/[id]` POST 用 withCwdOperationGuard 包住已有/新建 wrapper 与 send**

顶部把 rpc-manager import 改为：
```ts
import {
  startRpcSession,
  getRpcSession,
  withCwdOperationGuard,
} from "@/lib/rpc-manager";
```

保留 GET handler 不变；将 POST handler 完整替换为：
```ts
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const guard = await checkSessionOwnership(req, id);
  if (!guard.ok) {
    const msg = guard.status === 401 ? "未登录" : "Session not found";
    return NextResponse.json({ error: msg }, { status: guard.status });
  }

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    // 先取可信 cwd；已有 wrapper.cwd 已在 startRpcSession 中 canonical 化。
    const running = getRpcSession(id);
    const cwd = running?.isAlive()
      ? running.cwd
      : SessionManager.open(guard.filePath).getHeader()?.cwd ?? process.cwd();

    // guard 覆盖“再次取 wrapper/必要时启动/send”整段：
    // 删除标记后到达的旧鉴权请求会被拒，标记前进入的命令会被删除流程等待 settle。
    const result = await withCwdOperationGuard(cwd, async () => {
      let session = getRpcSession(id);
      if (!session?.isAlive()) {
        const started = await startRpcSession(id, guard.filePath, cwd);
        session = started.session;
      }
      return session.send(body);
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

不得保留原来的 `existing?.isAlive() -> existing.send(body)` guard 外 fast path。`checkSessionOwnership` 仍在 `req.json()` 前做第一次权限校验；即使请求随后暂停，恢复时也必须经过 cwd operation guard。删除已经完成并解锁时，wrapper 与 jsonl 已被移除，`SessionManager.open(guard.filePath)` 会失败，不会重建会话。

- [ ] **Step 3: 验证编译**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（隔离 HOME + 隔离端口，确认无编译错误），停 dev。

- [ ] **Step 4: Commit**

```bash
git add app/api/agent/new/route.ts app/api/agent/\[id\]/route.ts
git commit -m "feat: 新建与已有会话命令统一纳入删除锁临界区"
```

---

## Task 6.7: 删除锁并发单测（import 真实 delete-lock 模块，修 R5#5）

**Files:**
- Create: `__tests__/lib/auth/delete-lock.test.ts`

**背景（R5#5）**：为引用计数、等待逻辑、新建 guard、已有 wrapper command guard 与 alive/abort 规则加可控 Promise 自动化测试，且必须**测真实生产实现**。Task 6 已把锁状态机、删除窗口错误分类和 wrapper 命令判定抽到无 pi 依赖的 `lib/auth/delete-lock.ts`，本测试直接 import 真实 `createDeleteLock`、`createDeleteWindowAbortError`、`assertSessionCommandAllowed`，不复制算法。

- [ ] **Step 1: 写测试（import 真实模块 + 可控 Promise 完整时序）**

`__tests__/lib/auth/delete-lock.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDeleteLock,
  createDeleteWindowAbortError,
  assertSessionCommandAllowed,
} from "../../../lib/auth/delete-lock.ts"; // 真实生产实现

const ROOT = "/home/hsops/pi-users/alice"; // 测试用已 canonical 的绝对路径（无软链，canon 即自身）

test("引用计数：mark 两次、unmark 一次仍锁定，再 unmark 才解除（修 R3#4）", () => {
  const L = createDeleteLock();
  L.markRootDeleting(ROOT); L.markRootDeleting(ROOT);
  assert.equal(L.isCwdUnderDeletingRoot(ROOT + "/proj"), true);
  L.unmarkRootDeleting(ROOT);
  assert.equal(L.isCwdUnderDeletingRoot(ROOT + "/proj"), true, "第一个删除结束不应解开第二个的锁");
  L.unmarkRootDeleting(ROOT);
  assert.equal(L.isCwdUnderDeletingRoot(ROOT + "/proj"), false, "计数归 0 才解除");
});

test("边界：前缀相近的兄弟目录不误判在删除 root 内", () => {
  const L = createDeleteLock();
  L.markRootDeleting(ROOT);
  assert.equal(L.isCwdUnderDeletingRoot("/home/hsops/pi-users/alice2/p"), false);
  assert.equal(L.isCwdUnderDeletingRoot(ROOT), true); // 根本身也算
});

test("等待逻辑：waitForStartsUnderRoot 直到匹配的 in-flight 都 settle 才 resolve", async () => {
  const L = createDeleteLock();
  let resolveA!: () => void;
  const a = new Promise<void>((r) => { resolveA = r; });
  L.registerStart("k1", ROOT + "/p1", a);
  L.registerStart("k2", "/home/hsops/pi-users/bob/p", Promise.resolve()); // 不匹配 root
  let done = false;
  const w = L.waitForStartsUnderRoot(ROOT).then(() => { done = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(done, false, "in-flight 未 settle 前不应 resolve");
  resolveA(); L.unregisterStart("k1");
  await w;
  assert.equal(done, true, "in-flight settle 后 resolve");
});

test("普通启动失败被吞，不阻断删除等待", async () => {
  const L = createDeleteLock();
  L.registerStart("k1", ROOT + "/p1", Promise.reject(new Error("普通启动失败")));
  await assert.doesNotReject(L.waitForStartsUnderRoot(ROOT));
});

test("删除窗口清理失败（deleteWindowCleanup）传播，使编排 fail-closed（修 R3#4/R5#1）", async () => {
  const L = createDeleteLock();
  const err = Object.assign(new Error("清理失败"), { deleteWindowCleanup: true });
  L.registerStart("k1", ROOT + "/p1", Promise.reject(err));
  await assert.rejects(L.waitForStartsUnderRoot(ROOT), /清理失败/);
});

test("删除窗口错误分类：仅 cleanupErr 存在时标记 fail-closed（真实生产 helper）", () => {
  const cleaned = createDeleteWindowAbortError(null);
  assert.equal(cleaned.deleteWindowCleanup, undefined, "清理成功的放弃启动必须是普通错误");
  assert.match(cleaned.message, /已清理并放弃/);

  const failed = createDeleteWindowAbortError(new Error("rm failed"));
  assert.equal(failed.deleteWindowCleanup, true, "清理失败必须传播 fail-closed 标记");
  assert.match(failed.message, /清理失败/);
});

// ★ 完整 guard 等待时序（修 R5#5）：guard 进入→body 暂停→删除 mark→wait 保持等待→body settle→wait 完成
test("withStartGuard 完整时序：guard 进行中删除必须等它 settle", async () => {
  const L = createDeleteLock();
  let releaseBody!: () => void;
  const bodyGate = new Promise<void>((r) => { releaseBody = r; });
  let bodyDone = false;
  // 1) guard 已进入（未标记删除），body 被可控 Promise 暂停
  const guardP = L.withStartGuardCanonical(ROOT + "/proj", async () => {
    await bodyGate; bodyDone = true; return "ok";
  });
  await Promise.resolve(); await Promise.resolve(); // 让 guard 进入 body（已 registerStart）
  // 2) 删除开始并 mark
  L.markRootDeleting(ROOT);
  // 3) waitForStartsUnderRoot 必须保持等待（body 未 settle）
  let waitDone = false;
  const waitP = L.waitForStartsUnderRoot(ROOT).then(() => { waitDone = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(waitDone, false, "body 未 settle 前 wait 不应完成");
  assert.equal(bodyDone, false);
  // 4) body settle 后 wait 才完成
  releaseBody();
  assert.equal(await guardP, "ok");
  await waitP;
  assert.equal(waitDone, true, "body settle 后 wait 完成");
  assert.equal(bodyDone, true);
  L.unmarkRootDeleting(ROOT);
});

test("withStartGuard：已标记删除后拒绝新启动（前置检查），解锁后放行", async () => {
  const L = createDeleteLock();
  L.markRootDeleting(ROOT);
  await assert.rejects(L.withStartGuardCanonical(ROOT + "/proj", async () => "ok"), /正在删除/);
  L.unmarkRootDeleting(ROOT);
  assert.equal(await L.withStartGuardCanonical(ROOT + "/proj", async () => "ok"), "ok");
});

test("withStartGuard：body 内删除窗口清理失败经 done 传播到 wait", async () => {
  const L = createDeleteLock();
  let releaseBody!: () => void;
  const gate = new Promise<void>((r) => { releaseBody = r; });
  const err = Object.assign(new Error("窗口清理失败"), { deleteWindowCleanup: true });
  const guardP = L.withStartGuardCanonical(ROOT + "/proj", async () => { await gate; throw err; })
    .catch(() => {}); // guard 调用方自己会拿到 reject，这里吞掉避免 unhandled
  await Promise.resolve(); await Promise.resolve();
  L.markRootDeleting(ROOT);
  const waitP = assert.rejects(L.waitForStartsUnderRoot(ROOT), /窗口清理失败/);
  releaseBody();
  await guardP; await waitP;
  L.unmarkRootDeleting(ROOT);
});

test("已有 wrapper 命令：标记前进入则删除等待，标记后新命令拒绝", async () => {
  const L = createDeleteLock();
  let commandEntered!: () => void;
  let releaseCommand!: () => void;
  const entered = new Promise<void>((r) => { commandEntered = r; });
  const gate = new Promise<void>((r) => { releaseCommand = r; });

  const commandP = L.withStartGuardCanonical(ROOT + "/proj", async () => {
    commandEntered();
    await gate;
    return "sent";
  });
  await entered;
  L.markRootDeleting(ROOT);

  let waitDone = false;
  const waitP = L.waitForStartsUnderRoot(ROOT).then(() => { waitDone = true; });
  await Promise.resolve();
  assert.equal(waitDone, false, "已有命令未 settle 前删除不得继续 abort/扫描");
  await assert.rejects(
    L.withStartGuardCanonical(ROOT + "/proj", async () => "late"),
    /正在删除/
  );

  releaseCommand();
  assert.equal(await commandP, "sent");
  await waitP;
  assert.equal(waitDone, true);
  L.unmarkRootDeleting(ROOT);
});

test("wrapper 命令判定：destroy 后全拒绝；删除中仅 abort 豁免", () => {
  assert.throws(() => assertSessionCommandAllowed(false, false, "prompt"), /已销毁/);
  assert.throws(() => assertSessionCommandAllowed(true, true, "prompt"), /正在删除/);
  assert.doesNotThrow(() => assertSessionCommandAllowed(true, true, "abort"));
  assert.doesNotThrow(() => assertSessionCommandAllowed(true, false, "prompt"));
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm test`
Expected: PASS（引用计数、边界、等待、失败吞/传播、真实清理错误分类、新建 guard、已有 wrapper command guard、alive/abort 豁免共 11 组用例全过）。

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/auth/delete-lock.test.ts
git commit -m "test: 删除锁并发单测覆盖新建与已有会话命令guard"
```

---

## Task 7: 删除用户 jsonl 归属过滤纯逻辑（TDD）

**Files:**
- Create: `lib/auth/delete-user-helpers.ts`
- Test: `__tests__/lib/auth/delete-user-helpers.test.ts`

**Interfaces:**
- Produces: `filterJsonlUnderRoot(sessionCwdPairs: { file: string; cwd: string }[], rootDir: string): string[]` — 给定 (jsonl 文件路径, 其 cwd) 列表与目标用户根目录，返回 cwd 落在 root 内的 jsonl 文件路径集合。**自包含**（内联 path 解析，不跨 `.ts` import），与现有 `delete-helpers.ts` 同风格，兼容 webpack 与 node --test。
- **职责边界**：本函数只做**字符串路径归属**判断（`path.resolve` 前缀），不做 realpath。设计 §124 要求的归属校验（`resolveSessionOwnership`，Task 6.5）由调用方 Task 9 在传入前先过滤——因 realpath 有文件系统副作用，放进纯函数会破坏"自包含可测"约束。两层配合：编排层 `resolveSessionOwnership` 处理 symlink 逃逸（cwd 存在时 realpath）与 cwd 已删（字符串边界），纯函数再做确定性字符串归属（本 Task 单测覆盖后者，cwd 已删态由 Task 6.5 单测覆盖）。

- [ ] **Step 1: 写失败测试**

`__tests__/lib/auth/delete-user-helpers.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterJsonlUnderRoot } from "../../../lib/auth/delete-user-helpers.ts";

const root = "/home/hsops/pi-users/alice";

test("保留 cwd 在 root 内的 jsonl", () => {
  const pairs = [
    { file: "/a/1.jsonl", cwd: "/home/hsops/pi-users/alice" },
    { file: "/a/2.jsonl", cwd: "/home/hsops/pi-users/alice/proj" },
    { file: "/a/3.jsonl", cwd: "/home/hsops/pi-users/bob" },
    { file: "/a/4.jsonl", cwd: "/home/hsops/pi-users/alice2" }, // 前缀相近但非子路径
  ];
  const out = filterJsonlUnderRoot(pairs, root);
  assert.deepEqual(out, ["/a/1.jsonl", "/a/2.jsonl"]);
});

test("空 cwd 或空列表", () => {
  assert.deepEqual(filterJsonlUnderRoot([], root), []);
  assert.deepEqual(filterJsonlUnderRoot([{ file: "/a/x.jsonl", cwd: "" }], root), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm test`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写实现**

`lib/auth/delete-user-helpers.ts`:
```ts
import path from "path";

// 自包含：不跨 .ts import（兼容 webpack 生产构建与 node --test）。
// 返回 cwd 等于 root 或在 root 内的 jsonl 文件路径集合。
export function filterJsonlUnderRoot(
  sessionCwdPairs: { file: string; cwd: string }[],
  rootDir: string
): string[] {
  const root = path.resolve(rootDir);
  const out: string[] = [];
  for (const { file, cwd } of sessionCwdPairs) {
    if (!cwd) continue;
    const c = path.resolve(cwd);
    if (c === root || c.startsWith(root + path.sep)) out.push(file);
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/auth/delete-user-helpers.ts __tests__/lib/auth/delete-user-helpers.test.ts
git commit -m "feat: 删除用户jsonl归属过滤纯函数+单测"
```

---

## Task 8: 管理通道共用守卫 `lib/auth/admin-guard.ts`

**Files:**
- Create: `lib/auth/admin-guard.ts`

**Interfaces:**
- Consumes: `requireAdmin`、`getSessionUserWithRole`（Task 3）；`isSuperAdmin`、`SUPER_ADMIN`、`Role`（Task 1）；`getDb`（`lib/auth/db.ts`）。
- Produces:
  - `getUserRole(username: string): Role | null` — 查 users 表返回目标用户当前 role，不存在返 null。
  - `guardAdminViewTarget(request, targetUsername): { actor: {username, role}; targetRole: Role } | NextResponse` — 组合校验查看类通道：先 `requireAdmin`；查目标 role（不存在 404）；若目标为 super_admin 且请求者非本人 → 403（super_admin 内容保护）。用于所有 `/api/admin/users/[username]/*` 与 `/api/admin/files/[username]/*` 的 GET。

super_admin 内容保护集中在此一处，避免各路由重复。

- [ ] **Step 1: 写实现**

`lib/auth/admin-guard.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "./db";
import { requireAdmin } from "./session";
import { isSuperAdmin, type Role } from "./roles";

export function getUserRole(username: string): Role | null {
  const row = getDb().prepare("SELECT role FROM users WHERE username=?")
    .get(username) as { role: string } | undefined;
  return row ? ((row.role as Role) ?? "user") : null;
}

// 查看类通道守卫：requireAdmin + 目标存在性 + super_admin 内容保护。
export function guardAdminViewTarget(
  request: Request,
  targetUsername: string
): { actor: { username: string; role: Role }; targetRole: Role } | NextResponse {
  const actor = requireAdmin(request);
  if (actor instanceof NextResponse) return actor;
  const targetRole = getUserRole(targetUsername);
  if (!targetRole) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  // super_admin 的内容仅本人可看；其他 admin（含普通 admin）一律 403
  if (isSuperAdmin(targetRole) && actor.username !== targetUsername) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  return { actor, targetRole };
}
```

- [ ] **Step 2: 验证编译**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（隔离 HOME + 隔离端口，确认无编译错误），停 dev。

- [ ] **Step 3: Commit**

```bash
git add lib/auth/admin-guard.ts
git commit -m "feat: admin-guard共用守卫(getUserRole+guardAdminViewTarget含super_admin内容保护)"
```

---

## Task 9: 删除用户编排 `lib/auth/delete-user.ts`（顺序敏感，fail-closed）

**Files:**
- Create: `lib/auth/delete-user.ts`

**Interfaces:**
- Consumes: `getDb`（db.ts）；`getUserRoot`、`resolveSessionOwnership`、`canonicalizeExistingPrefix`（paths.ts，修 R3#1/R3#5：cwd 已删仍判归属，canonical 统一防外部软链漏删）；`lstatSync`（fs，核验用户根本身是否软链）；`listAllSessions`、`invalidateSessionPathCache`（`lib/session-reader.ts`，前者返回 `SessionInfo{path,id,cwd,...}`）；`filterJsonlUnderRoot`（Task 7）；`abortSessionsUnderCwd`、`markRootDeleting`、`unmarkRootDeleting`、`waitForStartsUnderRoot`（Task 6，覆盖 in-flight start/目录创建/已有会话命令 + R3#4 引用计数）。
- Produces: `deleteUserCompletely(username: string): Promise<{ ok: true } | { ok: false; error: string }>` — 按 §5.2 序列删除，fail-closed（终止会话/删 jsonl/删目录任一失败即中止，保留 users 行且 disabled=1，返回 error）；`finally` 中 `unmarkRootDeleting` 解锁。**两 root 分离（修 R3#1）**：`userRootPath = getUserRoot(username)`（原始，仅 `rmSync` 删它本身；若它是 symlink 则 fail-closed 拒删）；`canonicalRoot = canonicalizeExistingPrefix(userRootPath)`（仅用于锁/归属/会话比较）。

**序列（严格按序，fail-closed；先删 jsonl 后删目录，见设计 §5.2）**：
- **前置 A（先禁用，修 R5#3）**：**在任何可能失败的根校验之前**先 `UPDATE users SET disabled=1` + `DELETE FROM sessions`。这样即便后续根校验/规范化失败提前返回，账号也已被禁、无法登录——防"恶意用户把根换成软链让 DELETE 失败、账号却仍可登录"。
- **前置 B（根安全校验）**：`lstatSync(userRootPath)` 若为 symlink → **fail-closed 返回 error**（不删软链，也不删其目标；此时已禁用，可修复后重试）；ENOENT 视为无目录可删、继续；其他错误（EACCES 等）fail-closed（已禁用）。再 `canonicalizeExistingPrefix(userRootPath)` 得 `canonicalRoot`，抛错（EACCES/ELOOP 等，仅 ENOENT 降级）→ fail-closed 返回（已禁用）。
0. **标记删除锁（R3#2 正式步骤）**：`markRootDeleting(canonicalRoot)`——此后 `startRpcSession`/agent-new 拒绝该 root 下新启动，`/api/agent/[id]` 与 wrapper 二次防线拒绝已有会话的非 abort 新命令。放在 try 外，`finally` `unmarkRootDeleting(canonicalRoot)` 解除（引用计数），防永久锁死。
1. **再撤一次 session（幂等）**：`DELETE FROM sessions WHERE username=?`，覆盖前置到标记之间可能新建的 session。（disabled=1 已在前置 A 完成。）
2. **等 in-flight 清空 + 终止运行中会话**：`await waitForStartsUnderRoot(canonicalRoot)`（等标记前已进临界区的启动/建目录/已有会话命令 settle）→ `await abortSessionsUnderCwd(canonicalRoot)` 终止已注册会话；**任一抛错（含删除窗口清理失败）则中止**（保留 disabled=1 的 users 行）。此二者 + 第 0 步标记 + 注册前二次检查，共同消灭扫描后才落地的会话和命令写入。
3. **趁目录还在扫 jsonl（归属校验，cwd 已删仍算归属）**：`listAllSessions()` → 对每个 session 先 `resolveSessionOwnership(s.cwd, username)`（修 R3#1：cwd 存在走 realpath 防 symlink 逃逸，cwd 已删走字符串边界，使删了项目目录但 jsonl 仍在的历史会话仍被纳入待删集合）→ 通过者取 canonical cwd 交 `filterJsonlUnderRoot`（与 canonicalRoot 同口径）做最终归属，得固定 `{id, path}` 列表存下。放在禁用+终止会话之后扫，确保会话已停、不再产生新 jsonl。
4. **先删 jsonl，再删目录**：逐个 `rmSync(jsonl)`（删后 `invalidateSessionPathCache(id)` 清缓存），全部删净后再 **`rmSync(userRootPath,{recursive:true,force:true})`——删原始目录项，绝不删 canonicalRoot（修 R3#1）**；**任一抛错则中止**（保留 users 行，可重试）。顺序关键：先删 jsonl 保证失败时目录仍在、重试可重新枚举归属。
5. 全部成功后才 `DELETE FROM users WHERE username=?`；无论成败 `finally` 中 `unmarkRootDeleting(canonicalRoot)`。

- [ ] **Step 1: 写实现**

`lib/auth/delete-user.ts`:
```ts
import { rmSync, lstatSync } from "fs";
import { getDb } from "./db";
import { getUserRoot, resolveSessionOwnership, canonicalizeExistingPrefix } from "./paths";
import { listAllSessions, invalidateSessionPathCache } from "@/lib/session-reader";
import { filterJsonlUnderRoot } from "./delete-user-helpers";
import {
  abortSessionsUnderCwd, markRootDeleting, unmarkRootDeleting, waitForStartsUnderRoot,
} from "@/lib/rpc-manager";

export async function deleteUserCompletely(
  username: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  // 分离两个 root（修 R3#1 严重：绝不 rmSync canonical root，否则用户根是软链时会删软链目标目录）：
  // - userRootPath：原始 ~/pi-users/<user> 路径，仅用于最终 rmSync（删的必须是这个目录项本身）。
  // - canonicalRoot：canonical 化后的路径，仅用于删除锁 / 归属判定 / 运行中会话比较（与 canonical cwd 同口径）。
  const userRootPath = getUserRoot(username);

  // ★ 先禁用 + 撤登录，再做任何可能失败的根校验（修 R5#3）：
  //   否则恶意用户把自己的根换成软链 → 根校验失败提前返回 → 账号仍可登录。
  //   把"禁用+撤登录"放在最前，保证即便后续任一步失败，账号也已被禁、无法登录、下一跳跳登录。
  db.prepare("UPDATE users SET disabled=1 WHERE username=?").run(username);
  db.prepare("DELETE FROM sessions WHERE username=?").run(username);

  // 安全前置：用户根本身若是 symlink，fail-closed 拒绝删除（不删其目标，也不误删软链）。
  // 此时 disabled=1 已生效，返回 error 后账号仍处于"已禁用、可重试删除"状态（符合设计 fail-closed）。
  try {
    const st = lstatSync(userRootPath);
    if (st.isSymbolicLink()) {
      return { ok: false, error: `用户根 ${userRootPath} 是软链，拒绝删除（防误删软链目标）；用户已禁用，可修复后重试` };
    }
  } catch (e) {
    // ENOENT：无目录可删，继续（后续 rmSync force 幂等）；EACCES 等 → fail-closed 返回（已禁用）。
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      return { ok: false, error: `无法核验用户根: ${String(e)}；用户已禁用，可重试` };
    }
  }
  // canonical 化用户根（供锁/归属比较）。canonicalizeExistingPrefix 仅 ENOENT 降级、其他错误抛出（修 R5#2），
  // 故用 try 包裹：EACCES/ELOOP 等 → fail-closed 返回（此时已禁用）。
  let canonicalRoot: string;
  try {
    canonicalRoot = canonicalizeExistingPrefix(userRootPath);
  } catch (e) {
    return { ok: false, error: `无法规范化用户根: ${String(e)}；用户已禁用，可重试` };
  }
  // 0) 标记正在删除：此后 startRpcSession/agent-new 拒绝新启动，agent/[id] 拒绝已有会话新命令。
  //    放在 try 外、finally 解除，确保无论成败都不会永久锁死该用户目录。
  markRootDeleting(canonicalRoot);
  try {
    // 1) 禁用 + 撤登录已在前置完成；此处再撤一次 session（覆盖前置到标记之间新建的 session，幂等）。
    db.prepare("DELETE FROM sessions WHERE username=?").run(username);
    // 2) 等标记前已进入临界区的 start/建目录/已有会话命令全部 settle，再终止运行中会话。
    //    二者合起来消灭"扫描后才落地的新会话"（R3#2 正式步骤，非可选）。
    //    清理失败会从 waitForStartsUnderRoot / abortSessionsUnderCwd 抛出 → 落入 catch，fail-closed。
    await waitForStartsUnderRoot(canonicalRoot);
    await abortSessionsUnderCwd(canonicalRoot); // 内部不吞异常，抛错则落入 catch，fail-closed
    // 3) 趁目录还在，算出待删 jsonl 集合（归属校验 → 字符串归属），
    //    得到固定 {id, path} 列表，之后删 jsonl 不再依赖归属重算。
    //    用 resolveSessionOwnership（非 resolveExistingAndCheck）：cwd 已删的历史 jsonl
    //    仍按字符串边界归属该用户，确保"删用户连带删全部对话"覆盖 cwd 已删的会话（修 R3#1）。
    const sessions = await listAllSessions();
    // 每个 session 存 canonical cwd（canonicalizeExistingPrefix）：既用于 resolveSessionOwnership 归属，
    // 也作为 filterJsonlUnderRoot 的输入——两处口径统一，外部软链别名不被第二次原始字符串过滤排除（修 R3#5）。
    const safe = sessions
      .filter((s) => s.cwd && resolveSessionOwnership(s.cwd, username))
      .map((s) => ({ id: s.id, file: s.path, cwd: canonicalizeExistingPrefix(s.cwd as string) }));
    const jsonlFiles = filterJsonlUnderRoot(
      safe.map((s) => ({ file: s.file, cwd: s.cwd })), // cwd 已 canonical
      canonicalRoot                                     // 与 canonical cwd 同口径
    );
    const idByPath = new Map(safe.map((s) => [s.file, s.id]));
    // 4) 先删 jsonl（删后清路径缓存），全部删净后再删目录。任一抛错向上抛 → catch fail-closed。
    for (const f of jsonlFiles) {
      rmSync(f, { force: true }); // 抛错即中止，保留 users 行可重试
      const id = idByPath.get(f);
      if (id) invalidateSessionPathCache(id);
    }
    // 关键：删的是 userRootPath（原始目录项），不是 canonicalRoot——绝不删软链目标（修 R3#1）。
    rmSync(userRootPath, { recursive: true, force: true });
    // 5) 全部清理成功后才删用户行。
    db.prepare("DELETE FROM users WHERE username=?").run(username);
    return { ok: true };
  } catch (e) {
    // fail-closed：任一步失败，users 行保留（已 disabled=1），返回 error 供重试。
    return { ok: false, error: String(e) };
  } finally {
    // 解除删除锁（canonicalRoot，与 markRootDeleting 同参）：引用计数减 1，归 0 才真正移除。
    // 成功删净后该 root 已不存在，解锁无害；失败保留 disabled=1，重试会重新 markRootDeleting。
    // 不在 finally 解锁会永久禁止该目录新建会话。
    unmarkRootDeleting(canonicalRoot);
  }
}
```
> **fail-closed 关键**：第 2/4 步任一异常都不得吞掉——`abortSessionsUnderCwd` 抛错（会话未能终止）或 `rmSync` 抛错（jsonl/目录未删净）时，必须跳过第 5 步删用户行，返回 `{ok:false}`。绝不出现"用户行已删但目录/进程/对话还在"的半删状态。用户行仍在且 `disabled=1`，管理员可重新点删除重入整个序列。
> **顺序关键（先 jsonl 后目录）**：第 3 步的固定 `{id,path}` 列表只在当前请求内有效；跨请求重试是**重新扫描重算**（第 3 步的 `resolveSessionOwnership` 对 cwd 已删的 jsonl 仍按字符串边界归属，故 R3#1 的历史 jsonl 也覆盖）。真正的重试保证来自"先删 jsonl 后删目录"的顺序——jsonl 未删净时目录必然还在，任一 jsonl 删除失败即中止、目录未删，下次重试可重新枚举并按第 3 步归属逻辑再算集合删净残留（R2#1）。
> **竞态收敛（R3#2，正式步骤）**：删除竞态分三段堵死——(a) 先禁用+撤 session；(b) `markRootDeleting` + `waitForStartsUnderRoot` + `startRpcSession` fast path 前/注册前检查，覆盖新建与目录创建；(c) `/api/agent/[id]` 的 `withCwdOperationGuard` + wrapper alive/删除状态二次防线，覆盖已通过鉴权并暂停后恢复的已有会话命令。删除等待所有标记前登记的操作 settle，再 abort wrapper、扫描并删除，故扫描后不能再落地 jsonl/目录或追加命令写入。`finally` 解除标记，避免永久锁死。

- [ ] **Step 2: 验证编译**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（隔离 HOME + 隔离端口，确认无编译错误），停 dev。

- [ ] **Step 3: Commit**

```bash
git add lib/auth/delete-user.ts
git commit -m "feat: 删除用户编排(标记删除锁→禁用撤登录→等启动+终止会话→扫jsonl→先删jsonl后删目录→删用户行,fail-closed)"
```

---

## Task 10: 用户管理 API（列表 / 改角色 / 禁用 / 删除）

**Files:**
- Create: `app/api/admin/users/route.ts`（GET）
- Create: `app/api/admin/users/[username]/route.ts`（PATCH 改角色 / DELETE 删用户）
- Create: `app/api/admin/users/[username]/disable/route.ts`（POST 禁用/启用）

**Interfaces:**
- Consumes: `requireAdmin`、`requireSuperAdmin`、`getSessionUserWithRole`（Task 3）；`canManage`、`canChangeRole`、`isValidRole`、`isSuperAdmin`、`Role`（Task 1）；`getUserRole`（Task 8）；`deleteUserCompletely`（Task 9）；`getDb`（db.ts）。
- Produces: 见下各 handler。所有写操作先取目标当前 role 再判权限，前端隐藏不作数。

- [ ] **Step 1: GET /api/admin/users**

`app/api/admin/users/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth/db";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const rows = getDb().prepare(
    "SELECT username, role, disabled, created_at FROM users ORDER BY created_at ASC"
  ).all();
  return NextResponse.json({ users: rows });
}
```

- [ ] **Step 2: PATCH / DELETE /api/admin/users/[username]**

`app/api/admin/users/[username]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth/db";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/admin-guard";
import { canManage, canChangeRole, isValidRole, isSuperAdmin, SUPER_ADMIN } from "@/lib/auth/roles";
import { deleteUserCompletely } from "@/lib/auth/delete-user";

export const dynamic = "force-dynamic";

// 改角色：仅 super_admin；只能在 user<->admin 间；不能改 super_admin 本身或改成 super_admin。
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const guard = requireSuperAdmin(req);
  if (guard instanceof NextResponse) return guard;
  // 显式走 canChangeRole 作单一权限来源（设计 §4.1）：requireSuperAdmin 已保证仅 super_admin 到此，
  // 此处再调 canChangeRole(guard.role) 使"改角色权限"判定集中在 roles.ts 一处，helper 不成死代码。
  if (!canChangeRole(guard.role)) {
    return NextResponse.json({ error: "无权限改角色" }, { status: 403 });
  }
  const { username } = await params;
  const targetRole = getUserRole(username);
  if (!targetRole) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (isSuperAdmin(targetRole) || username === SUPER_ADMIN) {
    return NextResponse.json({ error: "不可修改 super_admin 角色" }, { status: 403 });
  }
  const body = await req.json() as { role?: unknown };
  if (!isValidRole(body.role) || (body.role !== "user" && body.role !== "admin")) {
    return NextResponse.json({ error: "只能设为 user 或 admin" }, { status: 400 });
  }
  getDb().prepare("UPDATE users SET role=? WHERE username=?").run(body.role, username);
  return NextResponse.json({ ok: true, username, role: body.role });
}

// 删用户：requireAdmin + canManage(目标当前 role)；super_admin 一律拒；不能删自己。
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const { username } = await params;
  const targetRole = getUserRole(username);
  if (!targetRole) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (username === guard.username) {
    return NextResponse.json({ error: "不能删除自己" }, { status: 403 });
  }
  if (!canManage(guard.role, targetRole)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const result = await deleteUserCompletely(username);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: POST /api/admin/users/[username]/disable**

`app/api/admin/users/[username]/disable/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/auth/db";
import { requireAdmin } from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/admin-guard";
import { canManage } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const { username } = await params;
  const targetRole = getUserRole(username);
  if (!targetRole) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (username === guard.username) {
    return NextResponse.json({ error: "不能禁用自己" }, { status: 403 });
  }
  if (!canManage(guard.role, targetRole)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({})) as { disabled?: unknown };
  // 严格校验：只接受明确的 0/1（或等价 false/true），其他（缺字段、{}、错误字符串）返 400，
  // 不做“非 1 即启用”的宽松解释，避免误启用。
  let disabled: 0 | 1;
  if (body.disabled === 1 || body.disabled === true) disabled = 1;
  else if (body.disabled === 0 || body.disabled === false) disabled = 0;
  else return NextResponse.json({ error: "disabled 必须为 0 或 1" }, { status: 400 });
  const db = getDb();
  db.prepare("UPDATE users SET disabled=? WHERE username=?").run(disabled, username);
  if (disabled === 1) {
    // 禁用即踢下线：清其所有 session
    db.prepare("DELETE FROM sessions WHERE username=?").run(username);
  }
  return NextResponse.json({ ok: true, username, disabled });
}
```

- [ ] **Step 4: 验证编译 + 未登录 401**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（隔离 HOME + 隔离端口），另开终端：
```bash
curl -s -o /dev/null -w "users=%{http_code}\n" http://127.0.0.1:8133/api/admin/users
```
Expected: 401（无 cookie）。停 dev。

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/users
git commit -m "feat: 用户管理API(列表/改角色/禁用/删除,按目标role校验+super_admin硬保护)"
```

---

## Task 11: 管理查看通道（会话列表 / 会话详情 / 文件）

**Files:**
- Create: `app/api/admin/users/[username]/sessions/route.ts`（GET）
- Create: `app/api/admin/users/[username]/sessions/[id]/route.ts`（GET）
- Create: `app/api/admin/files/[username]/[[...path]]/route.ts`（GET，**可选** catch-all：空段时列目标用户根）
- Create: `app/api/files/[...path]/file-serve.ts`（从普通路由抽出的共享纯 helper。**导出** `filePathFromSegments`/`getImageMime`/`getAudioMime`/`getLanguage`/`streamFile`/`downloadFile`，并**一并迁移它们依赖的文件内私有函数** `getExt`/`normalizeSlashes`/`isWindowsAbsolutePath`/`createFileBodyStream`/`contentDispositionAttachment` 及常量 `IMAGE_EXT_TO_MIME`/`AUDIO_EXT_TO_MIME`/`EXT_TO_LANGUAGE`/`WINDOWS_ABSOLUTE_RE`——不能只搬 6 个导出而漏掉私有依赖）
- Modify: `app/api/files/[...path]/route.ts`（删除已迁移的函数/常量定义，改为从 `./file-serve` import 上述 6 个 helper，行为不变）

**Interfaces:**
- Consumes: `guardAdminViewTarget`（Task 8）；`listAllSessions`、`resolveSessionPath`、`buildSessionContext`（`lib/session-reader.ts`）；`resolveSessionOwnership`（paths.ts，**会话列表/详情归属**，cwd 已删仍算归属，修 R3#1）、`resolveExistingAndCheck`（paths.ts，**文件通道读取**，要求 realpath 成功）；`filePathFromSegments`/`getImageMime`/`getAudioMime`/`getLanguage`/`streamFile`/`downloadFile`（新 `file-serve.ts`）；`SessionManager`（pi-coding-agent）。
- Produces: 三个只读 GET 通道，允许根为**目标用户**目录。本次只暴露 GET，不提供 DELETE/PUT（他人内容编辑/删除为预留功能，见 §6）。文件通道寻址与普通路由一致（绝对路径 + `filePathFromSegments` 重建 + realpath 校验），图片/音频经 `streamFile` 返二进制。

所有 handler 首行调 `guardAdminViewTarget(req, username)`（含 requireAdmin + 目标存在 + super_admin 内容保护）。

- [ ] **Step 0: 抽出 `file-serve.ts` 共享 helper（前置小重构，行为不变）**

普通路由 `app/api/files/[...path]/route.ts` 现把 MIME/streaming/路径重建逻辑定义为文件内私有函数。为让 admin 通道复用同一套逻辑（修计划#5），先把这些纯函数**连同其私有依赖**抽到同目录新文件 `app/api/files/[...path]/file-serve.ts` 并 `export`。**必须整组迁移**：6 个对外 helper 依赖 `getExt`/`createFileBodyStream`/`contentDispositionAttachment` 等私有函数与 `IMAGE_EXT_TO_MIME` 等常量，只搬 6 个导出会编译失败。

新建 `app/api/files/[...path]/file-serve.ts`（从 route.ts 原样迁移，仅在 6 个复用函数前加 `export`）:
```ts
import fs from "fs";
import path from "path";

export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
export const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
  ico: "image/x-icon", avif: "image/avif",
};

const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  weba: "audio/webm", webm: "audio/webm",
};

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
};

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

function getExt(filePath: string): string {
  return path.basename(filePath).toLowerCase().split(".").pop() ?? "";
}

export function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getExt(filePath)] ?? null;
}

export function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getExt(filePath)] ?? null;
}

export function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

export function filePathFromSegments(segments: string[]): string {
  const joined = segments.join("/");
  const slashJoined = normalizeSlashes(joined);
  if (isWindowsAbsolutePath(slashJoined)) return slashJoined;
  return "/" + joined.replace(/^\/+/, "");
}

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const fileStream = fs.createReadStream(filePath, range);
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream.on("data", (chunk: Buffer) => {
        if (closed) return;
        try { controller.enqueue(new Uint8Array(chunk)); }
        catch { closed = true; fileStream.destroy(); }
      });
      fileStream.once("end", () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* client canceled probe */ }
      });
      fileStream.once("error", (error) => {
        if (closed) return;
        closed = true;
        try { controller.error(error); } catch { /* response abandoned */ }
      });
    },
    cancel() { closed = true; fileStream.destroy(); },
  });
}

export function streamFile(filePath: string, stat: fs.Stats, contentType: string, rangeHeader: string | null): Response {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
  };
  if (!rangeHeader) {
    return new Response(createFileBodyStream(filePath), {
      headers: { ...headers, "Content-Length": String(stat.size) },
    });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
  }
  end = Math.min(end, stat.size - 1);
  const chunkSize = end - start + 1;
  return new Response(createFileBodyStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

function contentDispositionAttachment(filePath: string): string {
  const name = path.basename(filePath).replace(/[\r\n"]/g, "_");
  const asciiName = name.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function downloadFile(filePath: string, stat: fs.Stats): Response {
  return new Response(createFileBodyStream(filePath), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": contentDispositionAttachment(filePath),
      "Cache-Control": "no-cache",
      "Accept-Ranges": "bytes",
      "Content-Length": String(stat.size),
    },
  });
}
```

普通路由 `app/api/files/[...path]/route.ts` 改动：删除上面已迁移的全部函数与常量定义（`IMAGE_EXT_TO_MIME`/`AUDIO_EXT_TO_MIME`/`EXT_TO_LANGUAGE`/`WINDOWS_ABSOLUTE_RE`/`getExt`/`getImageMime`/`getAudioMime`/`getLanguage`/`normalizeSlashes`/`isWindowsAbsolutePath`/`filePathFromSegments`/`createFileBodyStream`/`streamFile`/`contentDispositionAttachment`/`downloadFile` 及 `TEXT_PREVIEW_MAX_BYTES`/`IMAGE_PREVIEW_MAX_BYTES`），顶部改为从 `./file-serve` import：
```ts
import {
  filePathFromSegments, getImageMime, getAudioMime, getLanguage,
  streamFile, downloadFile, TEXT_PREVIEW_MAX_BYTES, IMAGE_PREVIEW_MAX_BYTES,
} from "./file-serve";
```
保留 route.ts 自身仍用到的 `IGNORED_NAMES`/`IGNORED_SUFFIXES`（普通 list 过滤用，admin 通道不复用）。GET/DELETE handler 主体逻辑不变，`npm run build` 通过即证明行为等价。

- [ ] **Step 1: 目标用户会话列表**

`app/api/admin/users/[username]/sessions/route.ts`（复用 `app/api/sessions/route.ts` 的过滤逻辑，但用目标用户名）:
```ts
import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { resolveSessionOwnership } from "@/lib/auth/paths";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const g = guardAdminViewTarget(req, username);
  if (g instanceof NextResponse) return g;
  const sessions = await listAllSessions();
  const cwdAllowed = new Map<string, boolean>();
  const filtered = sessions.filter((s) => {
    if (!s.cwd) return false;
    let allowed = cwdAllowed.get(s.cwd);
    if (allowed === undefined) {
      // resolveSessionOwnership：cwd 已删的历史会话仍归属该用户，不漏查（修 R3#1）
      allowed = resolveSessionOwnership(s.cwd, username); // 目标用户根
      cwdAllowed.set(s.cwd, allowed);
    }
    return allowed;
  });
  return NextResponse.json({ sessions: filtered });
}
```

- [ ] **Step 2: 目标用户会话详情（只读）**

`app/api/admin/users/[username]/sessions/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { statSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { resolveSessionOwnership } from "@/lib/auth/paths";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ username: string; id: string }> }
) {
  const { username, id } = await params;
  const g = guardAdminViewTarget(req, username);
  if (g instanceof NextResponse) return g;

  const filePath = await resolveSessionPath(id);
  if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const sm = SessionManager.open(filePath);
  const cwd = sm.getHeader()?.cwd ?? "";
  // 归属校验：该会话 cwd 必须在目标用户目录内，否则 404（不泄露存在性）。
  // 用 resolveSessionOwnership：cwd 已删的历史会话仍可查看，不误判 404（修 R3#1）。
  if (!cwd || !resolveSessionOwnership(cwd, username)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const entries = sm.getEntries() as never;
  const leafId = sm.getLeafId();
  const context = buildSessionContext(entries, leafId);
  let modified = sm.getHeader()?.timestamp ?? new Date().toISOString();
  try { modified = statSync(filePath).mtime.toISOString(); } catch { /* header ts */ }
  return NextResponse.json({ context, cwd, modified });
}
```

- [ ] **Step 3: 目标用户文件通道（只读 list/read/download，无 watch）**

`app/api/admin/files/[username]/[[...path]]/route.ts`——**寻址方式与普通 files 路由对齐**，用**可选** catch-all（`[[...path]]`）以便前端首次可请求 `/api/admin/files/<user>`（无段）列出用户根：前端 `buildFileUrl` 发送**绝对路径**（`encodeFilePathForApi` 去前导 `/` 后按段编码），服务端用 `filePathFromSegments(segments)` 从 `/` 重建绝对路径，**绝不能** `path.join(getUserRoot(username), ...segments)`（那会得到 `~/pi-users/alice/home/hsops/pi-users/alice/...` 的翻倍路径）。空段（前端未知根路径时的首个请求）回退到 `getUserRoot(username)`。`[username]` 段仅用于鉴权与 super_admin 保护，不参与路径拼接。重建后统一 `resolveExistingAndCheck(filePath, username)` 校验落在目标用户根内（realpath 防逃逸）。**list 分支对目录项用 `lstatSync`（不跟随 symlink），逃逸软链不泄露外部目标元数据（修 R3#8）**。图片/音频复用 streamFile 返二进制（修计划#5），文本返 JSON：
```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUserRoot, resolveExistingAndCheck } from "@/lib/auth/paths";
import { guardAdminViewTarget } from "@/lib/auth/admin-guard";
// 从普通 files 路由抽出并共享的纯 helper（见下方注记）：
import {
  filePathFromSegments, getImageMime, getAudioMime, getLanguage,
  streamFile, downloadFile,
} from "@/app/api/files/[...path]/file-serve";

export const dynamic = "force-dynamic";

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string; path?: string[] }> }
) {
  const { username, path: segments } = await params;
  const g = guardAdminViewTarget(req, username);
  if (g instanceof NextResponse) return g;

  const type = req.nextUrl.searchParams.get("type") ?? "list";
  // 空段（首个根请求）→ 用户根；否则与普通路由同法从 / 重建绝对路径
  // （不 path.join(getUserRoot,...segments)，避免路径翻倍）。
  const filePath = segments && segments.length
    ? filePathFromSegments(segments)
    : getUserRoot(username);
  // realpath 校验：解析后必须落在目标用户根内，防 symlink 逃逸。
  if (!resolveExistingAndCheck(filePath, username)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (type === "list") {
    if (!stat.isDirectory()) return NextResponse.json({ error: "Not a dir" }, { status: 400 });
    const names = fs.readdirSync(filePath);
    const entries = names.map((name) => {
      const full = path.join(filePath, name);
      try {
        // 修 R3#8：用 lstatSync（不跟随 symlink），避免列表阶段读取逃逸软链的外部目标元数据
        //（类型/大小/mtime）。symlink 项统一标为非目录、size 0，不在列表暴露其指向。
        const s = fs.lstatSync(full);
        if (s.isSymbolicLink()) {
          // 逃逸软链在 read/download 阶段会被 resolveExistingAndCheck realpath 拒绝；
          // 列表阶段仅显示链接名，不跟随、不展开、不泄露目标属性。
          return { name, isDir: false, size: 0, modified: s.mtime.toISOString(), isSymlink: true };
        }
        return { name, isDir: s.isDirectory(), size: s.isFile() ? s.size : 0, modified: s.mtime.toISOString() };
      } catch { return null; }
    }).filter(Boolean);
    // 返回 path: filePath，供前端将根目录的绝对路径作为 FileExplorer 的 cwd（不硬编码 /home/hsops）
    return NextResponse.json({ entries, path: filePath });
  }
  if (type === "read") {
    if (!stat.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });
    // 修计划#5：图片/音频复用 streamFile 返二进制流，使前端 <img>/<audio src=type=read> 正常工作
    const imageMime = getImageMime(filePath);
    if (imageMime) {
      if (stat.size > IMAGE_PREVIEW_MAX_BYTES) return NextResponse.json({ error: "Image too large (>10MB)" }, { status: 413 });
      return streamFile(filePath, stat, imageMime, req.headers.get("range"));
    }
    const audioMime = getAudioMime(filePath);
    if (audioMime) return streamFile(filePath, stat, audioMime, req.headers.get("range"));
    if (stat.size > TEXT_PREVIEW_MAX_BYTES) return NextResponse.json({ error: "File too large for preview (>256KB)" }, { status: 413 });
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ content, language: getLanguage(filePath), size: stat.size });
  }
  if (type === "download") {
    if (!stat.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });
    return downloadFile(filePath, stat);
  }
  // watch 及其他类型在 admin 只读通道不支持
  return NextResponse.json({ error: "Unsupported type" }, { status: 400 });
}
```
> **helper 复用**：本 Step 的 import 来自 Step 0 抽出的 `file-serve.ts`。admin 通道与普通路由共用同一套 MIME/streaming/路径重建逻辑（修计划#5，避免图片/音频语义分叉）。`file-serve.ts` 的完整内容与普通路由改动见下方 **Step 0**（与本 Task 后续同一次 commit）。

- [ ] **Step 4: 验证编译 + 未登录 401**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`（隔离 HOME + 隔离端口），另开终端：
```bash
curl -s -o /dev/null -w "admin-sessions=%{http_code}\n" http://127.0.0.1:8133/api/admin/users/alice/sessions
curl -s -o /dev/null -w "admin-files=%{http_code}\n" http://127.0.0.1:8133/api/admin/files/alice
```
Expected: 均 401（无 cookie）。停 dev。

- [ ] **Step 5: Commit**

```bash
# 关键：本 Task 含 file-serve.ts 抽取（Step 0）+ 普通 files 路由改 import，二者必须与 admin 通道同一次提交，
# 否则 PR 缺少被 import 的共享模块或普通路由仍内联旧逻辑，构建失败。
git add \
  app/api/files/\[...path\]/file-serve.ts \
  app/api/files/\[...path\]/route.ts \
  app/api/admin/files \
  app/api/admin/users/\[username\]/sessions
git commit -m "feat: 抽file-serve共享helper + 管理只读查看通道(会话列表/详情/文件,允许根=目标用户+super_admin保护)"
```

---

## Task 12: file-paths 抽 buildFileUrl + FileExplorer/FileViewer 只读参数化

**Files:**
- Modify: `lib/file-paths.ts`
- Modify: `components/FileExplorer.tsx`
- Modify: `components/FileViewer.tsx`

**Interfaces:**
- Produces: `buildFileUrl(filePath, type, base?)` 统一构造四类地址；FileExplorer 新增 `readOnly?`/`urlBase?`；FileViewer 新增 `readOnly?`/`urlBase?`。普通用户路径行为完全不变（默认 base=`/api/files`，readOnly=false）。

现状：`lib/file-paths.ts` 有 `encodeFilePathForApi`、`getFileDownloadUrl(filePath)`（固定 `/api/files/...?type=download`）等。FileExplorer 硬编码 `authFetch(\`/api/files/${encoded}?type=list\`)`，始终渲染删除按钮，支持 mention。FileViewer 各子viewer 硬编码 `/api/files/${encoded}?type=read|watch` 与 `getFileDownloadUrl`。

- [ ] **Step 1: 加 buildFileUrl 到 lib/file-paths.ts**

追加（保留现有导出，`getFileDownloadUrl` 改为委托 buildFileUrl）：
```ts
export type FileUrlType = "list" | "read" | "download" | "watch";

// 统一文件地址构造。base 默认 /api/files（普通用户）；admin 只读传 /api/admin/files/<目标用户>。
export function buildFileUrl(
  filePath: string,
  type: FileUrlType,
  base = "/api/files"
): string {
  const encoded = encodeFilePathForApi(filePath);
  return `${base}/${encoded}?type=${type}`;
}
```
把原 `getFileDownloadUrl` 改为：
```ts
export function getFileDownloadUrl(filePath: string, base = "/api/files"): string {
  return buildFileUrl(filePath, "download", base);
}
```

- [ ] **Step 2: FileExplorer + TreeNode 加 readOnly + urlBase（关键：递归透传）**

现状（务必对照源码）：`fetchEntries(dirPath)` 是**模块级函数**，硬编码 `authFetch(\`/api/files/${encoded}?type=list\`)`；`TreeNode` 是**独立模块级组件**，其 `loadChildren` 直接调模块级 `fetchEntries(node.fullPath)`，并在末尾**递归渲染子 `TreeNode`**；删除按钮与 mention 按钮都**硬编码在 TreeNode 内部**。因此只改顶层 `FileExplorer` 不够——`urlBase`/`readOnly` 必须一路透传到每层递归的 TreeNode，否则根目录走 admin API、展开子目录却回落到 `/api/files`，且子层删除按钮依旧出现。

**2a. `fetchEntries` 加 `urlBase` 参数**（`buildFileUrl` 从 `@/lib/file-paths` import）：
```ts
async function fetchEntries(dirPath: string, urlBase?: string): Promise<FileNode[]> {
  const res = await authFetch(buildFileUrl(dirPath, "list", urlBase));
  if (!res.ok) return [];
  // ...其余映射逻辑不变（joinFilePath 等）
}
```

**2b. `Props` 与 `FileExplorer` 签名**：
```ts
interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string) => void;
  readOnly?: boolean;   // admin 只读：隐藏删除、禁 mention
  urlBase?: string;     // 注入 API 基址，默认 /api/files
}
// 签名解构：export function FileExplorer({ cwd, onOpenFile, refreshKey, onAtMention, readOnly = false, urlBase }: Props)
```
FileExplorer 顶层 effect 内的 `fetchEntries(cwd)` 改为 `fetchEntries(cwd, urlBase)`，并把该 effect 依赖数组从 `[cwd, refreshKey, localRefresh]` 改为 `[cwd, refreshKey, localRefresh, urlBase]`；渲染顶层 `TreeNode` 时把 `readOnly`/`urlBase` 一并传入（见 2d）。`urlBase` 变化必须重新拉根目录，不能继续显示旧通道数据。

**2c. `TreeNode` 参数类型加 `readOnly`/`urlBase`**，并让 `loadChildren` 用 urlBase：
```ts
function TreeNode({
  node, depth, cwd, onOpenFile, onAtMention,
  expandedPaths, onToggleExpanded, refreshKey, bumpRefresh,
  readOnly, urlBase,                      // 新增
}: {
  // ...原有类型...
  readOnly?: boolean;
  urlBase?: string;
}) {
  // loadChildren 内：
  const entries = await fetchEntries(node.fullPath, urlBase);   // 原为 fetchEntries(node.fullPath)
  // ...
}
```
`loadChildren` 的 `useCallback` 依赖数组同步从 `[loaded, node.fullPath]` 改为 `[loaded, node.fullPath, urlBase]`，否则展开目录可能继续调用旧的 `/api/files` closure，且 `react-hooks/exhaustive-deps` 会报警。
删除按钮块加只读守卫：`{hovered && (<button …删除…/>)}` → `{!readOnly && hovered && (…)}`；mention 同理 `{onAtMention && hovered && …}` → `{!readOnly && onAtMention && hovered && …}`（admin 只读文件通道也不提供删除 DELETE，前端隐藏与后端一致）。

**2d. 每处 `<TreeNode …/>` 递归调用都透传 `readOnly`/`urlBase`**——共两处：TreeNode 内部渲染 `children.map((child) => <TreeNode … />)` 一处，FileExplorer 顶层 `roots.map((node) => <TreeNode … />)` 一处。两处都追加 `readOnly={readOnly} urlBase={urlBase}`。**漏任一处都会导致该层及其子树回落到 `/api/files`**。

- [ ] **Step 3: FileViewer 加 readOnly + urlBase，只读关 watch**

现状（对照源码）：`FileViewer` 分发器按扩展名把渲染派给**独立子组件** `ImageViewer`/`AudioViewer`/`DownloadOnlyViewer`/`TextFileViewer`，各子组件自持 URL 构造：`ImageViewer`/`AudioViewer` 用 `` `/api/files/${encoded}?type=read` `` 作 `<img src>`/`<audio src>`，`TextFileViewer` 用 `authFetch(type=read)`，`DownloadButton`（独立组件，签名 `{ filePath }`，内部硬用 `getFileDownloadUrl(filePath)`，**被 5 处子 viewer 复用**）作下载链接，三者各有 `type=watch` 的 EventSource。

`components/FileViewer.tsx` 的 `Props` 加：
```ts
interface Props {
  filePath: string;
  cwd?: string;
  readOnly?: boolean;
  urlBase?: string;
}
```
分发器 `FileViewer` 把 `readOnly`/`urlBase` 透传给**每个**子 viewer（`<ImageViewer … urlBase={urlBase} readOnly={readOnly} />` 等；子组件参数类型相应加这两项）。各子 viewer 改动：
- **图片/音频 src**：`src = buildFileUrl(filePath, "read", urlBase)`（+ 原有 `&v=${bust}` cache-buster 拼在其后）取代硬编码 `/api/files/...?type=read`。**依赖后端**：admin 路由 `type=read` 对图片/音频已改为 `streamFile` 返二进制（修计划#5），故 `<img>/<audio>` 直接用该 URL 可正常加载；若后端未 stream 而返 JSON，图片会裂图——两者是配套改动。
- **文本 read**：`authFetch(buildFileUrl(filePath, "read", urlBase))`。
- **download（关键：DownloadButton 是独立组件，须加 prop 并逐点透传）**：`DownloadButton` 现签名为 `function DownloadButton({ filePath }: { filePath: string })`，内部硬用 `getFileDownloadUrl(filePath)`（默认 `/api/files`）。只把内部改成 `getFileDownloadUrl(filePath, urlBase)` **不够**——`urlBase` 得先进到组件里。改法：
  1. `DownloadButton` 签名加 `urlBase`：`function DownloadButton({ filePath, urlBase }: { filePath: string; urlBase?: string })`，内部 `href={getFileDownloadUrl(filePath, urlBase)}`。
  2. **所有 `<DownloadButton filePath={filePath} />` 调用点都追加 `urlBase={urlBase}`**——当前 FileViewer 有 5 处（各子 viewer 底部下载区：ImageViewer/AudioViewer/DownloadOnlyViewer/TextFileViewer 及分发器兜底）。**漏任一处该处下载仍走 `/api/files`，admin 下载会 404 或串到普通通道**。透传前提是这些子 viewer 自身已从分发器接收 `urlBase`（见上「分发器把 readOnly/urlBase 透传给每个子 viewer」）。
- **watch（EventSource）**：所有 watch URL 改为 `buildFileUrl(filePath, "watch", urlBase)`，仅当 `!readOnly` 才建立（admin 只读通道无 watch，建了也会 400）。注意三个 effect 的结构不同：
  1. `ImageViewer`/`AudioViewer` 的 effect 只负责状态重置与 watch；先关闭 `esRef.current` 并完成状态重置，再 `if (readOnly) return;`，否则从普通模式切到只读时可能遗留旧 EventSource。
  2. `TextFileViewer` 的同一个 effect 同时负责**首次 `fetchContent` 和 watch**；首次 read 必须始终执行，只能在 `fetchContent(...).finally(...)` 之后、创建 EventSource 之前加 `if (readOnly) return;`。绝不能在 effect 首行 return，否则 admin 文本文件永远不加载。
- **hook 依赖（必须同步修改）**：`ImageViewer`/`AudioViewer` watch effect 使用 `[filePath, readOnly, urlBase]`；`TextFileViewer.fetchContent` 的 `useCallback` 从 `[]` 改为 `[urlBase]`；Text effect 依赖使用 `[filePath, fetchContent, readOnly, urlBase]`。切换用户/基址/只读模式时先执行旧 effect cleanup，再按新 props 建立正确读取状态；不得用 eslint disable 掩盖缺依赖。

- [ ] **Step 4: 验证 — 普通用户功能不回归**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`，浏览器登录普通用户，确认文件树仍能展开、打开文件、删除按钮仍在（readOnly 默认 false）、mention 正常、文件变更 watch 仍刷新。截图留证（verification 阶段用）。停 dev。

- [ ] **Step 5: Commit**

```bash
git add lib/file-paths.ts components/FileExplorer.tsx components/FileViewer.tsx
git commit -m "feat: buildFileUrl统一寻址+FileExplorer/FileViewer只读参数化(readOnly/urlBase)"
```

---

## Task 13: AppShell 按 role 隐藏 Models/Skills + 后台入口

**Files:**
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: `/api/auth/me` 现返回 `{username, role}`（Task 4）。
- Produces: 普通 user 不渲染 Models/Skills 入口；admin/super_admin 渲染，且用户菜单多「管理后台」入口跳 `/admin`。

现状：AppShell `useEffect` fetch `/api/auth/me` 存 `authUser`（仅 username）。Models/Skills 是底部一个数组 `.map` 出的两个按钮。顶栏用户菜单含「退出登录」。

- [ ] **Step 1: 存 role**

新增 state 并在 me 回调里存 role：
```ts
const [authRole, setAuthRole] = useState<"user" | "admin" | "super_admin" | null>(null);
```
在现有 `.then((d) => { if (d?.username) setAuthUser(d.username); ... })` 内追加 `if (d?.role) setAuthRole(d.role);`。

- [ ] **Step 2: 隐藏 Models/Skills**

Models/Skills 按钮数组渲染整体用 `isAdmin` 包裹。在组件内定义 `const isAdminUser = authRole === "admin" || authRole === "super_admin";`，把渲染这两个按钮的 `<div style={{ padding: "8px" … }}>…</div>` 整块改为 `{isAdminUser && (<div …>…</div>)}`。

- [ ] **Step 3: 用户菜单加「管理后台」入口**

在用户菜单下拉里、「退出登录」按钮之前，加（仅 admin 可见）：
```tsx
{isAdminUser && (
  <button
    onClick={() => { window.location.href = "/admin"; }}
    style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      padding: "8px 10px", fontSize: 12, cursor: "pointer",
      background: "none", border: "none", color: "var(--text)",
      borderRadius: 5, textAlign: "left",
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
  >
    管理后台
  </button>
)}
```

- [ ] **Step 4: 验证**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`。普通 user 登录：右下角无 Models/Skills，用户菜单无「管理后台」。hsops 登录：三者都在。截图留证。停 dev。（隔离 HOME 首次为空，需先经注册接口创建 hsops 与一个普通 user；hsops 注册即 bootstrap 为 super_admin。）

- [ ] **Step 5: Commit**

```bash
git add components/AppShell.tsx
git commit -m "feat: AppShell按role隐藏Models/Skills+admin显示管理后台入口"
```

---

## Task 14: 管理后台页 `app/admin/page.tsx`

**Files:**
- Create: `app/admin/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/users`（Task 10）；`PATCH`/`DELETE /api/admin/users/[username]`、`POST .../disable`（Task 10）；`GET /api/admin/users/[username]/sessions`、`.../sessions/[id]`（Task 11）；`GET /api/admin/files/[username]/[[...path]]`（Task 11）；`FileExplorer`/`FileViewer` 只读模式（Task 12）；`MessageView`（`components/MessageView.tsx`，只读对话渲染，见 Step 2）；`canManage`、`SUPER_ADMIN`、`isSuperAdmin`（Task 1，前端复用同源权限判定）。
- Produces: 独立页 `/admin`。非 admin 进入时首个 `/api/admin/users` 返 403 → `window.location.href = "/"`。

布局：左侧用户列表（用户名 + 角色徽章 + 禁用状态 + 创建时间 + 操作按钮）；右侧选中用户后两个 tab「文件」「对话」。本次只读查看，无编辑/删单文件。

- [ ] **Step 1: 页面骨架 + 鉴权跳转 + 用户列表**

`app/admin/page.tsx`（客户端组件）：
```tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "@/components/FileExplorer";
import { FileViewer } from "@/components/FileViewer";
import { canManage } from "@/lib/auth/roles"; // 前端复用同源权限判定（纯函数）

interface AdminUser {
  username: string;
  role: "user" | "admin" | "super_admin";
  disabled: number;
  created_at: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"files" | "chats">("files");
  const [openFile, setOpenFile] = useState<{ path: string; name: string } | null>(null);
  const [meRole, setMeRole] = useState<"user" | "admin" | "super_admin" | null>(null);
  const [meUsername, setMeUsername] = useState<string | null>(null); // 判断“是否本人”用
  const [userRoot, setUserRoot] = useState<string>(""); // 目标用户根的绝对路径，从 admin files list 的 path 字段取，不硬编码
  // 文件根加载状态：区分加载中/成功/无权限(403)/其他错误，避免 super_admin 目标 403 时永久"加载中"（修 R3#6）
  const [fileState, setFileState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.status === 403 || res.status === 401) { window.location.href = "/"; return; }
    const data = await res.json();
    setUsers(data.users ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.role) setMeRole(d.role);
      if (d?.username) setMeUsername(d.username);
    });
    loadUsers();
  }, [loadUsers]);

  const isSuper = meRole === "super_admin";
  const adminBase = selected ? `/api/admin/files/${selected}` : "/api/files";

  // 选中用户后，先请求其根目录，从返回的 path 取绝对根路径作为 FileExplorer 的 cwd
  // （不硬编码 /home/hsops/pi-users/...；根路径由服务端 getUserRoot 决定）。
  // 显式区分 403（无权限，如普通 admin 选 super_admin）与其他错误，避免永久"加载中"（修 R3#6）。
  useEffect(() => {
    if (!selected) { setUserRoot(""); setFileState("loading"); return; }
    setUserRoot("");
    setFileState("loading");
    let cancelled = false;
    fetch(`/api/admin/files/${selected}?type=list`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 403) { setFileState("forbidden"); return; }
        if (!r.ok) { setFileState("error"); return; }
        const d = await r.json().catch(() => null);
        if (cancelled) return;
        if (d?.path) { setUserRoot(d.path); setFileState("ok"); }
        else setFileState("error");
      })
      .catch(() => { if (!cancelled) setFileState("error"); });
    return () => { cancelled = true; };
  }, [selected]);

  // 操作：禁用/启用、删除、改角色（下面 Step 2 的按钮调这些）
  const toggleDisable = async (u: AdminUser) => {
    await fetch(`/api/admin/users/${u.username}/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: u.disabled ? 0 : 1 }),
    });
    loadUsers();
  };
  const deleteUser = async (u: AdminUser) => {
    if (!confirm(`彻底删除用户 ${u.username}？将连带删除其工作目录与全部对话，不可恢复`)) return;
    const res = await fetch(`/api/admin/users/${u.username}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error ?? "删除失败"); return; }
    if (selected === u.username) setSelected(null);
    loadUsers();
  };
  const changeRole = async (u: AdminUser, role: "user" | "admin") => {
    const res = await fetch(`/api/admin/users/${u.username}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error ?? "改角色失败"); return; }
    loadUsers();
  };

  return (
    <div style={{ display: "flex", height: "100dvh", background: "var(--bg)", color: "var(--text)" }}>
      {/* 左：用户列表 */}
      <div style={{ width: 320, borderRight: "1px solid var(--border)", overflowY: "auto", flexShrink: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
          用户管理 <a href="/" style={{ float: "right", fontSize: 12, color: "var(--accent)" }}>返回</a>
        </div>
        {users.map((u) => {
          const isSuperTarget = u.role === "super_admin";
          // 前端按权限矩阵算可管理性（与后端 canManage 同源）：
          // 需 meRole 能管 u.role，且不是本人（本人破坏性操作后端也拒）。
          const canManageTarget =
            meRole != null && meUsername != null &&
            u.username !== meUsername && canManage(meRole, u.role);
          // 改角色按钮：仅 super_admin 可改，且目标非 super_admin、非本人。
          const canChangeTarget = isSuper && !isSuperTarget && u.username !== meUsername;
          return (
            <div key={u.username}
              onClick={() => { setSelected(u.username); setOpenFile(null); }}
              style={{
                padding: "10px 16px", cursor: "pointer",
                background: selected === u.username ? "var(--bg-selected)" : "none",
                borderBottom: "1px solid var(--border)",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 500 }}>{u.username}</span>
                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--bg-hover)", color: "var(--text-muted)" }}>{u.role}</span>
                {u.disabled === 1 && <span style={{ fontSize: 10, color: "var(--err, #dc2626)" }}>已禁用</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{u.created_at}</div>
              {/* 操作按钮：按权限矩阵禁用/隐藏（后端仍是安全边界，前端仅体验） */}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                <button disabled={!canManageTarget} onClick={() => toggleDisable(u)}
                  style={{ fontSize: 11, opacity: canManageTarget ? 1 : 0.35, cursor: canManageTarget ? "pointer" : "not-allowed" }}>
                  {u.disabled ? "启用" : "禁用"}
                </button>
                <button disabled={!canManageTarget} onClick={() => deleteUser(u)}
                  style={{ fontSize: 11, color: "#e5484d", opacity: canManageTarget ? 1 : 0.35, cursor: canManageTarget ? "pointer" : "not-allowed" }}>删除</button>
                {canChangeTarget && (
                  u.role === "admin"
                    ? <button onClick={() => changeRole(u, "user")} style={{ fontSize: 11 }}>取消管理员</button>
                    : <button onClick={() => changeRole(u, "admin")} style={{ fontSize: 11 }}>设为管理员</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 右：文件 / 对话 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {!selected ? (
          <div style={{ margin: "auto", color: "var(--text-dim)" }}>选择一个用户查看其文件与对话</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 4, padding: 8, borderBottom: "1px solid var(--border)" }}>
              <button onClick={() => setTab("files")} style={{ fontWeight: tab === "files" ? 600 : 400 }}>文件</button>
              <button onClick={() => setTab("chats")} style={{ fontWeight: tab === "chats" ? 600 : 400 }}>对话</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              {tab === "files" ? (
                <div style={{ display: "flex", height: "100%" }}>
                  <div style={{ width: 280, borderRight: "1px solid var(--border)", overflow: "auto" }}>
                    {fileState === "ok" && userRoot ? (
                      <FileExplorer
                        cwd={userRoot}
                        urlBase={adminBase}
                        readOnly
                        onOpenFile={(path, name) => setOpenFile({ path, name })}
                      />
                    ) : fileState === "forbidden" ? (
                      <div style={{ padding: 12, fontSize: 12, color: "var(--err, #dc2626)" }}>无权限查看该用户内容</div>
                    ) : fileState === "error" ? (
                      <div style={{ padding: 12, fontSize: 12, color: "var(--err, #dc2626)" }}>加载失败，请重试</div>
                    ) : (
                      <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>加载中…</div>
                    )}
                  </div>
                  <div style={{ flex: 1, overflow: "auto" }}>
                    {openFile && <FileViewer filePath={openFile.path} cwd={userRoot} urlBase={adminBase} readOnly />}
                  </div>
                </div>
              ) : (
                <AdminChats username={selected} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 对话子组件 AdminChats（复用 MessageView 只读渲染）**

在同文件底部加只读对话查看（列表 + 点开详情，调 admin 会话通道）。详情**复用主界面的 `MessageView`**——不传 `onFork`/`onNavigate`/`onEditContent`/`onAtMention` 等交互回调即天然只读，避免 JSON dump：
```tsx
import { MessageView } from "@/components/MessageView";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";

interface AdminSessionDetail {
  context: { messages: AgentMessage[]; entryIds?: string[] };
  cwd: string;
  modified: string;
}

function AdminChats({ username }: { username: string }) {
  const [sessions, setSessions] = useState<{ id: string; name?: string; firstMessage: string; modified: string }[]>([]);
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  // 列表加载状态：区分无权限(403)/错误/成功，避免把 403 当"无对话"（修 R3#6）
  const [chatState, setChatState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  useEffect(() => {
    setDetail(null);
    setChatState("loading");
    let cancelled = false;
    fetch(`/api/admin/users/${username}/sessions`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 403) { setChatState("forbidden"); setSessions([]); return; }
        if (!r.ok) { setChatState("error"); setSessions([]); return; }
        const d = await r.json().catch(() => null);
        if (cancelled) return;
        setSessions(d?.sessions ?? []);
        setChatState("ok");
      })
      .catch(() => { if (!cancelled) { setChatState("error"); setSessions([]); } });
    return () => { cancelled = true; };
  }, [username]);
  const open = async (id: string) => {
    const res = await fetch(`/api/admin/users/${username}/sessions/${id}`);
    if (res.ok) setDetail(await res.json());
  };
  // 与 ChatWindow 同法：先建 toolResult 配对表，供 MessageView 关联工具调用与结果
  const toolResults = (() => {
    const m = new Map<string, ToolResultMessage>();
    for (const msg of detail?.context.messages ?? []) {
      if (msg.role === "toolResult") m.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
    }
    return m;
  })();
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ width: 300, borderRight: "1px solid var(--border)", overflow: "auto" }}>
        {chatState === "loading" && <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>加载中…</div>}
        {chatState === "forbidden" && <div style={{ padding: 16, color: "var(--err, #dc2626)", fontSize: 12 }}>无权限查看该用户内容</div>}
        {chatState === "error" && <div style={{ padding: 16, color: "var(--err, #dc2626)", fontSize: 12 }}>加载失败，请重试</div>}
        {chatState === "ok" && sessions.length === 0 && <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>无对话</div>}
        {chatState === "ok" && sessions.map((s) => (
          <div key={s.id} onClick={() => open(s.id)}
            style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
            <div style={{ fontWeight: 500 }}>{s.name || s.firstMessage.slice(0, 40)}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{s.modified}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 0" }}>
        {detail ? (
          <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px" }}>
            {detail.context.messages
              .filter((m) => m.role !== "toolResult") // 结果由对应工具调用块内联渲染
              .map((msg, idx) => (
                <MessageView
                  key={idx}
                  message={msg}
                  cwd={detail.cwd}
                  toolResults={toolResults}
                  // 不传 onFork/onNavigate/onEditContent → 只读，无编辑/分叉入口
                />
              ))}
          </div>
        ) : (
          <div style={{ color: "var(--text-dim)", padding: 16 }}>选择一条对话查看（只读）</div>
        )}
      </div>
    </div>
  );
}
```
> **只读性来自省略回调**：`MessageView` 的编辑/分叉/导航入口都由可选回调 `onFork`/`onNavigate`/`onEditContent` 驱动，不传即不渲染这些按钮，无需改 `MessageView` 本身。工具结果按 `ChatWindow` 同法用 `toolResults` Map 传入，由工具调用块内联展示。

- [ ] **Step 3: 验证 — dev 下 admin 页可用**

Run: `HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133`。以 hsops 登录 → 用户菜单进「管理后台」→ 左列出现用户列表 → 选一用户 → 文件 tab 可浏览其目录（只读，无删除按钮）、对话 tab 可看其会话列表与详情。截图留证。停 dev。

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: 管理后台页(/admin)左用户列表右文件/对话只读查看+禁用删除改角色操作"
```

---

## Task 15: 端到端越权与角色验证（手测，留证）

**Files:**
- 无新增；纯验证。发现问题回到对应 Task 修。

**前置**：Task 15 是最终破坏性验收，先重建专用隔离 HOME，再起 8133 dev。重建范围严格限制为 `/home/hsops/.pi-admin-dev-home`，绝不触碰生产 HOME。服务 PID 和后续 cookie 分别写入权限为 600 的临时 env 文件；账号准备完成后的每个验证块都显式 `source /tmp/pi-admin-e2e.env`，不依赖前一个 shell 的变量：
```bash
set -euo pipefail
DEV_HOME=/home/hsops/.pi-admin-dev-home
test "$DEV_HOME" = "/home/hsops/.pi-admin-dev-home"
if ss -ltn 2>/dev/null | grep -q ':8133 '; then
  echo "8133 已被占用，先停止旧隔离 dev" >&2; exit 1
fi
rm -rf "$DEV_HOME/.pi-web-auth" "$DEV_HOME/pi-users" "$DEV_HOME/.pi"
mkdir -p "$DEV_HOME"
HOME="$DEV_HOME" setsid npm run dev -- -p 8133 > /tmp/pi-admin-e2e-dev.log 2>&1 &
DEV_PID=$!
umask 077
printf 'DEV_HOME=%q\nBASE=%q\nDEV_PID=%q\n' \
  "$DEV_HOME" "http://127.0.0.1:8133" "$DEV_PID" > /tmp/pi-admin-e2e-server.env
ready=0
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8133/login > /dev/null; then ready=1; break; fi
  kill -0 "$DEV_PID"
  sleep 1
done
test "$ready" = 1
kill -0 "$DEV_PID"
```
Expected: 60 秒内 `/login` 返回成功，`kill -0` 确认 dev 仍运行；日志在 `/tmp/pi-admin-e2e-dev.log`。**数据隔离**：auth.db/pi-users/Pi 会话全部位于隔离 HOME，清理和测试不会触碰生产数据。

准备账号并持久化凭据。注册必须硬断言 HTTP 200；因为本 Task 已重建隔离 HOME，409 也视为失败，避免复用未知密码或脏角色。登录函数同时断言 HTTP 200 和非空 cookie。最后将 `gettok` 函数及变量写入 `/tmp/pi-admin-e2e.env`（`umask 077`）：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e-server.env
# 先创建最小最终 env；即使账号准备中途失败，独立清理块仍能取得 DEV_PID。
install -m 600 /tmp/pi-admin-e2e-server.env /tmp/pi-admin-e2e.env
reg() { local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    -d "{\"keyword\":\"tsingmao\",\"username\":\"$1\",\"password\":\"$2\"}" "$BASE/api/auth/register")
  echo "reg-$1=$code"; test "$code" = 200
}
reg hsops Hsops1234    # 注册即 bootstrap 为 super_admin
reg alice Alice1234    # 普通 user
reg bob   Bob12345     # 后续由 hsops 提为 admin，做 admin↔admin / admin 越权用例
reg carol Carol1234    # 另一普通 user，供 bob(admin) 合法管理 + 被 bob 提权尝试

gettok() { local headers body code token
  headers=$(mktemp); body=$(mktemp)
  code=$(curl -sS -D "$headers" -o "$body" -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" "$BASE/api/auth/login")
  test "$code" = 200
  token=$(grep -i '^set-cookie:' "$headers" | sed -E 's/.*pi_auth=([^;]+).*/\1/' | tr -d '\r')
  rm -f "$headers" "$body"
  test -n "$token"; printf '%s' "$token"
}
HSOPS_TOK=$(gettok hsops Hsops1234); test -n "$HSOPS_TOK"
ALICE_TOK=$(gettok alice Alice1234); test -n "$ALICE_TOK"
CAROL_TOK=$(gettok carol Carol1234); test -n "$CAROL_TOK"
# hsops 把 bob 提为 admin（PATCH 仅 super_admin 可），再取 bob（admin）cookie
Hc="pi_auth=$HSOPS_TOK"
promote_code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H "Cookie: $Hc" -H "Content-Type: application/json" \
  -d '{"role":"admin"}' "$BASE/api/admin/users/bob")
test "$promote_code" = 200
BOB_TOK=$(gettok bob Bob12345); test -n "$BOB_TOK"
umask 077
{
  printf 'DEV_HOME=%q\nBASE=%q\nDEV_PID=%q\n' "$DEV_HOME" "$BASE" "$DEV_PID"
  printf 'HSOPS_TOK=%q\nBOB_TOK=%q\nALICE_TOK=%q\nCAROL_TOK=%q\n' \
    "$HSOPS_TOK" "$BOB_TOK" "$ALICE_TOK" "$CAROL_TOK"
  declare -f gettok
} > /tmp/pi-admin-e2e.env
test "$(stat -c '%a' /tmp/pi-admin-e2e.env)" = 600
echo "账号与 cookie 就绪：hsops(super) / bob(admin) / alice,carol(user)"
```
下文 Step 1-4d 的每个验证 Bash 块第一条有效命令必须是 `set -euo pipefail`，随后 `source /tmp/pi-admin-e2e.env`；凭据文件提供 `DEV_HOME`、`BASE`、`DEV_PID`、四个 token 与 `gettok`。这些验证块均可在新 shell/subagent 独立执行；Step 5 清理块额外兼容账号准备尚未完成、仅 server env 存在的失败场景。

- [ ] **Step 1: 普通 user 全 403/隐藏（覆盖设计 §5.1 表全部 API 及写方法）**

alice 登录后。设计 §5.1 表列的每个 admin-only API 及其**每种写方法**都须至少验证一次 403（不只 GET）——单测 GET 不足以证明 PUT/POST/DELETE 也被 `requireAdmin` 挡住。此外设计 §5 要求普通 user 访问 `/api/admin/*` **全部** 403，故内容查看通道（sessions/sessions[id]/files）也必须覆盖：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
# 账号准备段就绪的 alice(普通 user) cookie
C="pi_auth=$ALICE_TOK"
# 硬断言版：期望码不符即 exit 1，不再只打印（修：验收需断言而非肉眼看）
chk() { local want=$1 method=$2 url=$3; local got
  got=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Cookie: $C" "http://127.0.0.1:8133$url")
  echo "$method $url => $got (want $want)"
  test "$got" = "$want"
}

# 1) 配置类 GET（含 admin 用户列表 + 配置读 + 全部 provider/api-key 读）→ 全 403
for p in \
  /api/admin/users \
  /api/models-config \
  "/api/skills?cwd=/tmp" \
  /api/auth/providers \
  /api/auth/all-providers \
  "/api/auth/api-key/anthropic" \
  "/api/auth/login/anthropic" ; do
  chk 403 GET "$p"
done

# 2) 配置类写方法（PUT/POST/DELETE/PATCH）→ 全 403，覆盖表中所有写入口
chk 403 PUT    /api/models-config
chk 403 POST   /api/models-config/test
chk 403 PATCH  "/api/skills?cwd=/tmp"
chk 403 POST   "/api/skills/search?cwd=/tmp"
chk 403 POST   "/api/skills/install?cwd=/tmp"
chk 403 POST   "/api/auth/api-key/anthropic"
chk 403 DELETE "/api/auth/api-key/anthropic"
chk 403 POST   "/api/auth/login/anthropic"
chk 403 POST   "/api/auth/logout/anthropic"

# 3) admin 内容查看通道（设计 §5 要求 /api/admin/* 全 403）→ 普通 user 也须 403
chk 403 GET /api/admin/users/alice/sessions
chk 403 GET /api/admin/users/alice/sessions/anyid
chk 403 GET /api/admin/files/alice

# 4) 只读放行对照：/api/models GET 仍 200（切换模型所需，非管理入口）
chk 200 GET /api/models
echo "Step 1 全部断言通过"
```
Expected: 脚本执行到底且末行打印“全部断言通过”（任一断言不符会因 `set -e` + `test` 立即退出）。除 `/api/models` 为 **200** 外，其余全 **403**。前端右下角无 Models/Skills、无「管理后台」入口。逐条记录 http 码 + 截图。

- [ ] **Step 2: 禁用即时生效**

hsops 禁用 alice → alice 已持 cookie 的下一次请求（如刷新首页）立即跳登录；alice 重新登录接口返 403「账号已被禁用」：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
Hc="pi_auth=$HSOPS_TOK"
# hsops 禁用 alice（可在 /admin 页点按钮，或直接调 API）
dis=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Cookie: $Hc" -H "Content-Type: application/json" \
  -d '{"disabled":1}' "$BASE/api/admin/users/alice/disable"); test "$dis" = 200
# alice 用旧 cookie 访问受保护接口 → 禁用后 getSessionUser 拒，401
old=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: pi_auth=$ALICE_TOK" "$BASE/api/auth/me")
echo "alice-old-cookie=$old"; test "$old" = 401
# alice 重新登录 → 403「账号已被禁用」
lg=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"Alice1234"}' "$BASE/api/auth/login")
echo "alice-login=$lg"; test "$lg" = 403
# hsops 再启用 alice，并刷新 alice cookie 供后续 Step 复用
en=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Cookie: $Hc" -H "Content-Type: application/json" \
  -d '{"disabled":0}' "$BASE/api/admin/users/alice/disable"); test "$en" = 200
ALICE_TOK=$(gettok alice Alice1234); test -n "$ALICE_TOK"
tmp_env=$(mktemp)
{ grep -v '^ALICE_TOK=' /tmp/pi-admin-e2e.env; printf 'ALICE_TOK=%q\n' "$ALICE_TOK"; } > "$tmp_env"
chmod 600 "$tmp_env"; mv "$tmp_env" /tmp/pi-admin-e2e.env
echo "Step 2 禁用即时生效 + 重新启用 通过"
```
Expected: `alice-old-cookie=401`、`alice-login=403`；启用后 `ALICE_TOK` 刷新，alice 可正常登录。截图。

- [ ] **Step 3: 权限矩阵关键用例**

用账号准备段就绪的变量（`$HSOPS_TOK`/`$BOB_TOK`/`$ALICE_TOK`/`$CAROL_TOK`）。bob 为普通 admin，hsops 为 super_admin：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
Bc="pi_auth=$BOB_TOK"; Hc="pi_auth=$HSOPS_TOK"
ck() { local want=$1 method=$2 url=$3 data=${4:-}; local got
  if [ -n "$data" ]; then
    got=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Cookie: $CK" -H "Content-Type: application/json" -d "$data" "$BASE$url")
  else
    got=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Cookie: $CK" "$BASE$url")
  fi
  echo "$method $url => $got (want $want)"; test "$got" = "$want"
}

# a) 普通 admin(bob) 改任何人角色 → 403（PATCH 仅 super_admin）
CK="$Bc"; ck 403 PATCH /api/admin/users/carol '{"role":"admin"}'
# b) 普通 admin(bob) 禁用/删除另一 admin → 403（bob 不能管 admin；hsops 已是 super，另造 admin 用 hsops 先提 carol）
CK="$Hc"; ck 200 PATCH /api/admin/users/carol '{"role":"admin"}'   # hsops 先把 carol 提为 admin
CK="$Bc"; ck 403 POST   /api/admin/users/carol/disable '{"disabled":1}'
CK="$Bc"; ck 403 DELETE /api/admin/users/carol
CK="$Hc"; ck 200 PATCH  /api/admin/users/carol '{"role":"user"}'   # 复原 carol 为 user
# c) 普通 admin(bob) 合法管理普通 user(carol) → 200（禁用后复原）
CK="$Bc"; ck 200 POST /api/admin/users/carol/disable '{"disabled":1}'
CK="$Bc"; ck 200 POST /api/admin/users/carol/disable '{"disabled":0}'
# d) 普通 admin(bob) 访问 super_admin(hsops) 内容 → 403
CK="$Bc"; ck 403 GET /api/admin/users/hsops/sessions
CK="$Bc"; ck 403 GET /api/admin/files/hsops
# e) super_admin(hsops) 提权 alice→admin、降级回 user → 均 200
CK="$Hc"; ck 200 PATCH /api/admin/users/alice '{"role":"admin"}'
CK="$Hc"; ck 200 PATCH /api/admin/users/alice '{"role":"user"}'
# f) super_admin(hsops) 对自己做破坏性操作 / 改自己角色 → 全 403
CK="$Hc"; ck 403 DELETE /api/admin/users/hsops
CK="$Hc"; ck 403 POST   /api/admin/users/hsops/disable '{"disabled":1}'
CK="$Hc"; ck 403 PATCH  /api/admin/users/hsops '{"role":"admin"}'
# g) disable 请求体严格校验（修计划#6）：非法值 400，合法 0/1 与布尔 true/false 均 200
CK="$Hc"
ck 400 POST /api/admin/users/carol/disable '{}'
ck 400 POST /api/admin/users/carol/disable '{"disabled":"yes"}'
ck 400 POST /api/admin/users/carol/disable '{"disabled":2}'
ck 200 POST /api/admin/users/carol/disable '{"disabled":1}'
ck 200 POST /api/admin/users/carol/disable '{"disabled":0}'
ck 200 POST /api/admin/users/carol/disable '{"disabled":true}'   # 设计 §5 允许 true/false
ck 200 POST /api/admin/users/carol/disable '{"disabled":false}'
echo "Step 3 权限矩阵全部断言通过"
```
Expected: 脚本跑到底并打印“全部断言通过”，逐格与 §4.1 矩阵一致（任一不符 `set -e`+`test` 立即退出）。

- [ ] **Step 3b: admin 文件通道 symlink 逃逸防护（修计划#2/#5）**

在 alice 目录内放一个指向他人目录的 symlink，确认 admin 文件通道拒绝解析到目标用户根之外（路径全用隔离 `$DEV_HOME`，与另一终端的生产 `$HOME` 区分）：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
H="pi_auth=$HSOPS_TOK"                     # 账号准备段就绪的 hsops(super_admin) cookie
# 造逃逸软链：隔离 HOME 下 alice 目录内 escape -> hsops 目录（或 /etc）
ln -sfn "$DEV_HOME/pi-users/hsops" "$DEV_HOME/pi-users/alice/escape" 2>/dev/null || \
  ln -sfn /etc "$DEV_HOME/pi-users/alice/escape"
# hsops cookie 经 alice 通道访问该软链 → 须 403（resolveExistingAndCheck realpath 拦截）
esc=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $H" \
  "$BASE/api/admin/files/alice/$(echo "$DEV_HOME/pi-users/alice/escape" | sed 's#^/##')?type=list")
echo "escape-list=$esc"; test "$esc" = 403
rm -f "$DEV_HOME/pi-users/alice/escape"   # 清理软链
```
Expected: `escape-list=403`（解析后落在 alice 根外，被 realpath 校验拒绝）。接着**先造一张确定的 PNG**（不依赖任意已有图片），验证正常路径 200 且图片 `?type=read` 返 `Content-Type: image/*` 二进制（非 JSON，修计划#5）：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
H="pi_auth=$HSOPS_TOK"
# 造确定的 1x1 PNG（固定 base64，可重复执行；避免 <some-image> 占位）
IMG="$DEV_HOME/pi-users/alice/test.png"
base64 -d > "$IMG" <<'PNG_B64'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC
PNG_B64
test -s "$IMG"
# 正常目录列表 200
lst=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $H" \
  "$BASE/api/admin/files/alice/$(echo "$DEV_HOME/pi-users/alice" | sed 's#^/##')?type=list")
echo "alice-list=$lst"; test "$lst" = 200
# 图片 read 返二进制 image/png（走 streamFile，非 application/json）
ct=$(curl -s -D - -o /dev/null -H "Cookie: $H" \
  "$BASE/api/admin/files/alice/$(echo "$IMG" | sed 's#^/##')?type=read" \
  | grep -i '^content-type:' | tr -d '\r')
echo "$ct"; echo "$ct" | grep -qi 'image/png'
rm -f "$IMG"
echo "Step 3b symlink 逃逸拦截 + 图片二进制验收通过"
```
Expected: `alice-list=200`；图片响应 `Content-Type: image/png`（非 `application/json`），脚本打印“验收通过”。

- [ ] **Step 4: 删除用户连带清理（含 R3#1 cwd 已删会话、R3#2/#1 启动竞态；顺序可执行）**

本步按"先造数据 → 验证归属可见 → 触发竞态 → 删除 → 验证清净"的**可执行顺序**跑，一次覆盖普通删除、cwd 已删历史会话、in-flight 启动竞态。全程 alice 尚未删除时先造会话，删除放在最后。

**4-1 造数据（alice 未删，经 agent 接口真实产生会话 jsonl）**：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
A="pi_auth=$ALICE_TOK"   # alice 登录 cookie
# 命令类型必须是 "prompt"（AgentSessionWrapper.send 只认 prompt/prompt_command，主界面也发 prompt）；
# 用 "user" 会返回 "Unsupported command: user"，curl -o /dev/null 会吞状态码把失败误当成功造数（修 R5#6）。
# a) 普通会话：alice 在自身根发一条消息 → 断言 HTTP 200 且返回 sessionId，确认会话真建
r1=$(curl -s -w "\n%{http_code}" -X POST -H "Cookie: $A" -H "Content-Type: application/json" \
  -d '{"cwd":"~/pi-users/alice","type":"prompt","message":"hello a"}' \
  http://127.0.0.1:8133/api/agent/new)
code1=$(printf '%s\n' "$r1" | tail -1); body1=$(printf '%s\n' "$r1" | sed '$d')
echo "new-a=$code1"
test "$code1" = 200
session1=$(printf '%s\n' "$body1" | jq -er '.sessionId | select(type == "string" and length > 0)')
echo "sessionId-a=$session1"
# b) cwd 将被删的会话：alice 在子目录 proj-x 下发消息 → 同样断言 200 + sessionId
r2=$(curl -s -w "\n%{http_code}" -X POST -H "Cookie: $A" -H "Content-Type: application/json" \
  -d '{"cwd":"~/pi-users/alice/proj-x","type":"prompt","message":"hello x"}' \
  http://127.0.0.1:8133/api/agent/new)
code2=$(printf '%s\n' "$r2" | tail -1); body2=$(printf '%s\n' "$r2" | sed '$d')
echo "new-x=$code2"
test "$code2" = 200
session2=$(printf '%s\n' "$body2" | jq -er '.sessionId | select(type == "string" and length > 0)')
echo "sessionId-x=$session2"
rm -rf "$DEV_HOME/pi-users/alice/proj-x"   # 删子目录，保留其 jsonl（jsonl 落在 ~/.pi/agent/sessions）
```
Expected: `new-a=200`、`new-x=200`，两者返回体含 `sessionId`（会话真建，jsonl 已落盘）。若非 200 或无 sessionId 则造数失败，后续断言无意义——不得继续。

**4-2 验证 R3#1 + 抓 jsonl 绝对路径（删除前，供 4-4 逐个断言真消失）**：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
H="pi_auth=$HSOPS_TOK"
# 删除前拉 alice 全部会话，提取 jsonl 绝对路径（SessionInfo.path），存盘供删除后逐个断言 !-e
sessions_response=$(curl -s -w "\n%{http_code}" -H "Cookie: $H" \
  "http://127.0.0.1:8133/api/admin/users/alice/sessions")
sessions_code=$(printf '%s\n' "$sessions_response" | tail -1)
sessions_body=$(printf '%s\n' "$sessions_response" | sed '$d')
test "$sessions_code" = 200
printf '%s\n' "$sessions_body" | jq -er '.sessions[].path' | tee /tmp/alice-jsonl-before.txt
test -s /tmp/alice-jsonl-before.txt
wc -l < /tmp/alice-jsonl-before.txt > /tmp/alice-session-count-before.txt
# 断言至少含 proj-x 会话（cwd 已删仍可见，证明 resolveSessionOwnership 归属，修 R3#1）
printf '%s\n' "$sessions_body" | jq -e 'any(.sessions[]; .cwd | contains("proj-x"))' > /dev/null
echo "cwd已删会话可见 OK(R3#1)"
# 记录逐条 jsonl 删除前确实存在（基线）
while IFS= read -r f; do
  test -n "$f"
  test -e "$f"
  echo "before exists: $f"
done < /tmp/alice-jsonl-before.txt
```
Expected: `/tmp/alice-jsonl-before.txt` 含多条 jsonl 绝对路径（含 proj-x 会话）；每条删除前 `-e` 存在。这些路径是 4-4 的**直接断言对象**（不再依赖删用户后必然 404 的 admin API）。

**4-3 验证 R3#2/#1 的端到端旁证：前置禁用后拒绝新启动且不新增会话**。先由 hsops 禁用 alice（模拟删除前置 A 已发生），再用 alice **旧 cookie** 打 `/api/agent/new`，应被拒且不产生新 session/jsonl：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
H="pi_auth=$HSOPS_TOK"
A="pi_auth=$ALICE_TOK"
test -s /tmp/alice-session-count-before.txt
before_count=$(cat /tmp/alice-session-count-before.txt)
disable_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Cookie: $H" -H "Content-Type: application/json" \
  -d '{"disabled":1}' "http://127.0.0.1:8133/api/admin/users/alice/disable"
)
test "$disable_code" = 200
# alice 旧 cookie 尝试新建会话（type:prompt 与主界面一致）→ 禁用后 getSessionUser 拒 401；即便构造已鉴权也会被 withStartGuard/删除锁拦
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Cookie: $A" -H "Content-Type: application/json" \
  -d '{"cwd":"~/pi-users/alice","type":"prompt","message":"race"}' http://127.0.0.1:8133/api/agent/new)
echo "new-during-delete=$code"
test "$code" != 200
# 会话总数必须与 4-2 基线一致，证明被拒请求没有新建 jsonl。
after_response=$(curl -s -w "\n%{http_code}" -H "Cookie: $H" \
  "http://127.0.0.1:8133/api/admin/users/alice/sessions")
after_code=$(printf '%s\n' "$after_response" | tail -1)
after_body=$(printf '%s\n' "$after_response" | sed '$d')
test "$after_code" = 200
after_count=$(printf '%s\n' "$after_body" | jq -er '.sessions | length')
test "$after_count" = "$before_count"
# hsops 重新启用 alice，便于 4-4 走完整删除
enable_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Cookie: $H" -H "Content-Type: application/json" \
  -d '{"disabled":0}' "http://127.0.0.1:8133/api/admin/users/alice/disable"
)
test "$enable_code" = 200
```
Expected: `new-during-delete` 非 200，且请求前后 alice 会话数量相同（被拒请求没有产生 session/jsonl）。
> 说明：curl 手测无法制造"已鉴权、暂停在 `req.json()`"的真实暂停时刻，也不能在 alice 根原本存在时证明"目录未重建"，故本步只是**可观测代理断言**（禁用后新建被拒 + 未新增会话）。删除锁 / 引用计数 / 等待逻辑及目录创建临界区的**正式正确性验证**由 Task 6.7 的可控 Promise 并发单测承担（自动化、可重复），此处手测仅作端到端旁证。

**4-4 执行删除并逐个断言 jsonl 真消失（不依赖删后必 404 的 admin API）**：
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
H="pi_auth=$HSOPS_TOK"
test -s /tmp/alice-jsonl-before.txt
delete_code=$(curl -s -o /tmp/alice-delete-response.json -w "%{http_code}" -X DELETE \
  -H "Cookie: $H" "http://127.0.0.1:8133/api/admin/users/alice")
test "$delete_code" = 200
sleep 1
test ! -d "$DEV_HOME/pi-users/alice"                  # 目录已删，且未被 in-flight 重建
# 关键（修 R3#5 断言无效）：对删除前抓到的每条 jsonl 绝对路径逐个断言已不存在。
# 不再用 admin sessions API 查 proj-x——用户行已删，guard 必先 404，"没有 proj-x"不能证明文件真消失。
while IFS= read -r f; do
  test -n "$f"
  test ! -e "$f"
  echo "已删 OK: $f"
done < /tmp/alice-jsonl-before.txt
alice_count=$(sqlite3 "$DEV_HOME/.pi-web-auth/auth.db" \
  "SELECT count(*) FROM users WHERE username='alice';")
test "$alice_count" = 0
echo "全部 jsonl 已删净，users 行已删除"
rm -f /tmp/alice-jsonl-before.txt /tmp/alice-session-count-before.txt /tmp/alice-delete-response.json
```
Expected: 目录消失且未被重建；`/tmp/alice-jsonl-before.txt` 中**每条 jsonl 绝对路径删除后 `! -e`**（含 proj-x 的 cwd 已删会话，证明扫描覆盖 R3#1 且真删了文件）；`users` 无 alice 行；运行中会话被 abort/destroy（dev 日志无该 cwd 后续写入）。截图 + 命令输出留证。

- [ ] **Step 4b: 删除失败 fail-closed（设计 §5.2，修计划#1）**

验证"目录删除失败时用户保留且已禁用"——设计 §5.2 明确要求的用例，原计划缺失。删除序列（Task 9）**先删 jsonl 后删目录**，故要触发失败须让**目录 `rmSync` 失败**（第 4 步末）。断言：
1. 接口返回失败（非 2xx，body 含 error）。
2. `users` 表中该用户**行仍在**且 `disabled=1`（fail-closed，未误删用户行）。
3. 目录仍在（删除中止）。

关键前置（修 R2#7）：删除 API 先取目标 role，**用户不存在直接 404**，绝不进入删除序列。因此必须**先经注册接口创建 deltest 用户行**（不能只 mkdir 目录），否则测的是 404 而非删除失败。
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
H="pi_auth=$HSOPS_TOK"
# 0) 先经公开注册接口创建 deltest（写入 users 表；隔离 HOME 下，非生产库）。
#    注册需 keyword（默认 tsingmao，或 REGISTER_KEYWORD 环境变量）+ 合法密码（≥8 位含大小写+数字）。
TESTU=deltest
register_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d "{\"keyword\":\"tsingmao\",\"username\":\"$TESTU\",\"password\":\"DelPw1234\"}" \
  http://127.0.0.1:8133/api/auth/register)
test "$register_code" = 200
# 注册流程会建其工作目录 $DEV_HOME/pi-users/$TESTU；在其中造一个令目录 rmSync 失败的受保护子项
mkdir -p "$DEV_HOME/pi-users/$TESTU/locked"; : > "$DEV_HOME/pi-users/$TESTU/locked/f"
chmod 500 "$DEV_HOME/pi-users/$TESTU/locked"   # 令递归删除受阻（视 fs 而定；必要时用 chattr +i）
# 1) 经 admin 删除接口删 deltest（hsops cookie）——因用户行已存在，会真正进入删除序列；预期失败但 curl 本身应成功完成。
delete_response=$(curl -s -w "\n%{http_code}" -X DELETE -H "Cookie: $H" \
  "http://127.0.0.1:8133/api/admin/users/$TESTU")
delete_code=$(printf '%s\n' "$delete_response" | tail -1)
delete_body=$(printf '%s\n' "$delete_response" | sed '$d')
test "$delete_code" -ge 400
test "$delete_code" -lt 600
printf '%s\n' "$delete_body" | jq -e '.error' > /dev/null
# 2) 断言：用户行仍在且 disabled=1（读隔离 HOME 下的 auth.db）
row=$(sqlite3 "$DEV_HOME/.pi-web-auth/auth.db" \
  "SELECT username, disabled FROM users WHERE username='$TESTU';")
test "$row" = "deltest|1"
# 3) 断言目录仍在
test -d "$DEV_HOME/pi-users/$TESTU"
# 清理（恢复权限后手动删目录与用户行）
chmod 700 "$DEV_HOME/pi-users/$TESTU/locked"; rm -rf "$DEV_HOME/pi-users/$TESTU"
sqlite3 "$DEV_HOME/.pi-web-auth/auth.db" "DELETE FROM users WHERE username='$TESTU';"
```
Expected: `register=200`（用户行已建）；`delete` 非 2xx（目录 rmSync 失败）；SELECT 返 `deltest|1`（行在、已禁用）；目录仍在。证明第 2/4 步失败不会走到第 5 步删用户行。

- [ ] **Step 4d: 用户根是软链时目标目录不受影响 + 用户仍被禁用（修 R5#3/R4#1）**

验证"恶意用户把自己的根换成软链"场景:目标目录零损、用户行保留且 disabled=1、软链本身不删目标。
```bash
set -euo pipefail
source /tmp/pi-admin-e2e.env
H="pi_auth=$HSOPS_TOK"
# 0) 注册 linkuser 建其真实根，然后把根替换为指向 sensitive 的软链
TESTU=linkuser
register_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d "{\"keyword\":\"tsingmao\",\"username\":\"$TESTU\",\"password\":\"LinkPw1234\"}" \
  http://127.0.0.1:8133/api/auth/register)
test "$register_code" = 200
# 造一个"根外敏感目录"并放一个标记文件，确认删除后它仍在
mkdir -p "$DEV_HOME/sensitive"; : > "$DEV_HOME/sensitive/keep.txt"
# 把 linkuser 的真实根删掉、换成指向 sensitive 的软链
rm -rf "$DEV_HOME/pi-users/$TESTU"
ln -sfn "$DEV_HOME/sensitive" "$DEV_HOME/pi-users/$TESTU"
# 1) 删除 linkuser → 应 fail-closed 拒删（用户根是软链）
delete_response=$(curl -s -w "\n%{http_code}" -X DELETE -H "Cookie: $H" \
  "http://127.0.0.1:8133/api/admin/users/$TESTU")
delete_code=$(printf '%s\n' "$delete_response" | tail -1)
delete_body=$(printf '%s\n' "$delete_response" | sed '$d')
test "$delete_code" -ge 400
test "$delete_code" -lt 600
printf '%s\n' "$delete_body" | jq -e '.error' > /dev/null
# 2) 断言:sensitive 目标目录与标记文件完好（软链目标未被删）
test -e "$DEV_HOME/sensitive/keep.txt"
test -L "$DEV_HOME/pi-users/$TESTU"
# 3) 断言:用户行仍在且 disabled=1（前置 A 先禁用，即便根校验失败也禁用了）
row=$(sqlite3 "$DEV_HOME/.pi-web-auth/auth.db" \
  "SELECT username, disabled FROM users WHERE username='$TESTU';")
test "$row" = "linkuser|1"
# 4) 断言:linkuser 已无法登录（disabled）
relogin_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d "{\"username\":\"$TESTU\",\"password\":\"LinkPw1234\"}" http://127.0.0.1:8133/api/auth/login)
test "$relogin_code" = 403
# 清理
rm -f "$DEV_HOME/pi-users/$TESTU"   # 删软链本身（非目标）
rm -rf "$DEV_HOME/sensitive"
sqlite3 "$DEV_HOME/.pi-web-auth/auth.db" "DELETE FROM users WHERE username='$TESTU';"
```
Expected: `delete` 非 2xx（拒删软链根）；`$DEV_HOME/sensitive/keep.txt` **仍存在**（目标目录零损，证明没删 canonical 目标）；SELECT 返 `linkuser|1`（行在、已禁用）；`relogin=403`（账号已禁用，不能登录——证明"根校验失败前先禁用"，恶意软链不能让账号存活）。

- [ ] **Step 5: 记录验证结论**

把 Step 1-4 的 http 码表、截图路径、`ls` 输出整理成一段验证小结（供 requesting-code-review / verification-before-completion 使用）。随后无论成功还是中途失败，都执行下面的独立清理块停止隔离 dev 并删除凭据；若前序块失败，应立即跳到此块：
```bash
set -euo pipefail
if test -f /tmp/pi-admin-e2e.env; then
  source /tmp/pi-admin-e2e.env
else
  source /tmp/pi-admin-e2e-server.env
fi
kill -- "-$DEV_PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  kill -0 -- "-$DEV_PID" 2>/dev/null || break
  sleep 1
done
if kill -0 -- "-$DEV_PID" 2>/dev/null; then kill -9 -- "-$DEV_PID"; fi
rm -f /tmp/pi-admin-e2e.env /tmp/pi-admin-e2e-server.env \
  /tmp/alice-jsonl-before.txt /tmp/alice-session-count-before.txt \
  /tmp/alice-delete-response.json
```
Expected: `kill -0 -- "-$DEV_PID"` 最终失败（整个 dev 进程组已停），两个 env 凭据文件不存在。本步无 commit；若发现 bug 回对应 Task 修复并从“重建隔离 HOME”重新跑完整 Task 15。

---

## Task 16: 生产构建 + 重启服务 + 文档更新

**Files:**
- Modify（**在功能 worktree，Step 2 合并前**）: `docs/superpowers/specs/2026-07-09-admin-console-design.md`（补"实现完成"说明）、`AGENTS.md` 或项目 README（若有；记录 /admin 与角色）。
- 生产工作树 `/home/hsops/pi-web-auth`：**仅 build + restart，无任何文件编辑/提交**。

**Interfaces:**
- 无代码接口；部署与文档。

> ⚠️ 仅本 Task 允许 `next build`。前面所有验证都用隔离端口 8133 的 `npm run dev`。构建前确认工作区 clean、`npm test` + `tsc --noEmit` 全绿。
> ⚠️ **部署影响运行中服务**：Step 4/5 的 build + restart 会中断 8000 上正在服务的生产实例。按用户"开发不影响运行项目"的要求，**这两步须先合并分支、并经用户明确批准后再执行**；开发/审查阶段不要跑。文档更新（Step 2）在功能 worktree 完成，不碰生产工作树（修 R4#7）。

- [ ] **Step 1: 全量测试 + 类型检查 + lint**

Run（`npm test` 会在 homedir/pi-users 建目录，须隔离 HOME；tsc/lint 无副作用可不隔离，但一并加无害）：
```bash
HOME=/home/hsops/.pi-admin-dev-home npm test && node_modules/.bin/tsc --noEmit && npm run lint
```
Expected: 测试全绿（roles、delete-user-helpers、session-ownership、delete-lock、及既有 auth 测试）；`tsc --noEmit` 无类型错误（设计要求的最终类型门禁，覆盖新增路由/组件 props）；lint 无 error。

- [ ] **Step 2: 在功能 worktree 更新文档并提交（合并前，修 R4#7）**

> **约束（R4#7）**：全局约束要求**不在 main / 生产工作树直接修改**（§Global Constraints）。故文档更新（实现记录、README/AGENTS）必须在**功能 worktree `/home/hsops/pi-web-auth-admin` 内、合并之前**完成并提交；生产工作树只负责构建与重启，不在其上编辑/提交任何文件。

Run（在功能 worktree 内）：
```bash
cd /home/hsops/pi-web-auth-admin   # 功能 worktree（非生产）
```
在 `docs/superpowers/specs/2026-07-09-admin-console-design.md` 末尾追加一节「实现记录（2026-07-xx 完成）」，写明：已实现角色三级（user/admin/super_admin）、hsops 自动 super_admin、`/admin` 后台、配置类 API 收紧为 admin-only、禁用即时生效、删除用户连带清理目录与对话（含 canonical cwd 归属、删除锁、软链防护）；他人内容"编辑/删除单文件"为预留未实现。若项目有 README/AGENTS.md 记录路由或角色，同步补一行 `/admin`（admin 专属）与角色说明。然后提交：
```bash
git add docs/superpowers/specs/2026-07-09-admin-console-design.md AGENTS.md 2>/dev/null
git commit -m "docs: 管理后台与角色权限实现完成记录+部署说明"
```

- [ ] **Step 3: 合并分支（部署前，需用户确认）**

功能分支（如 `feat/admin-console`，此时已含 Step 2 的文档提交）测试与类型检查全绿后，按 `finishing-a-development-branch` 收尾：合并回 main 或建 PR。**合并策略与是否部署由用户决定**。合并后 main 即含全部代码与文档，生产工作树无需再编辑。

- [ ] **Step 4: 在生产工作树构建（需用户批准，会影响运行服务）**

> **关键**：systemd 从 **`/home/hsops/pi-web-auth`** 启动读其 `.next`。前面所有开发都在 `/home/hsops/pi-web-auth-admin`。若在开发 worktree `npm run build`，产物写进开发 worktree 的 `.next`，重启后生产目录仍是旧 `.next`——改动不生效。**必须切回生产工作树、切到含功能提交的 main 再构建；生产工作树只构建，不编辑/提交**。

Run（确认后，务必先切回生产工作树）：
```bash
cd /home/hsops/pi-web-auth          # 回生产工作树（非 -admin）
git switch main
git log --oneline -1                # 确认 main HEAD 已含本功能合并提交（Step 3 已合并，含代码+文档）
git status --porcelain              # 应为空（生产工作树干净，绝不在此编辑/提交）
npm ci 2>/dev/null || npm install   # 依赖对齐（如分支引入新依赖）
npm run build                       # 写生产工作树的 .next
```
Expected: 当前目录 `/home/hsops/pi-web-auth`、分支 `main` 且含功能提交（代码+文档）；构建成功、无类型错误，`.next` 更新在生产工作树内。（若 Step 3 是建 PR 而非直接合并，须等 PR 合并进 main 后再执行本步。）

- [ ] **Step 5: 重启服务并冒烟（需用户批准，中断现有 8000 实例）**

Run（确认后，仍在 `/home/hsops/pi-web-auth`）：
```bash
cd /home/hsops/pi-web-auth
systemctl --user restart pi-web-auth
sleep 3
curl -s -o /dev/null -w "home=%{http_code}\n" http://localhost:8000/login
systemctl --user status pi-web-auth --no-pager | head -5
```
Expected: 服务 active (running)，`/login` 返 200。以 hsops 登录进 `/admin` 冒烟一次，确认为**新**构建（管理后台可用）。**本 Task 在生产工作树无任何 git 提交**（文档已在 Step 2 于功能 worktree 提交）。

---

## Self-Review 结论

**Spec 覆盖核对**（对照 design 各节）：
- §3 数据模型（role/disabled + bootstrap）→ Task 2、Task 4。
- §4 后端鉴权（getSessionUserWithRole/requireAdmin/requireSuperAdmin）→ Task 3；§4.1 权限矩阵（canManage/canChangeRole）→ Task 1 + 各管理 API（Task 10/11）。
- §4.2 禁用登录与 getSessionUser 强化 → Task 3、Task 4、Task 10（禁用删 session）。
- §5 管理 API → Task 10（users/role/disable/delete）、Task 11（sessions/files 只读通道）；§5.1 配置 API 收紧 → Task 5；§5.2 删除序列 → Task 6.5 是 Task 6 的硬前置，有效执行顺序为 Task 5→6.5→6→6.6→6.7；Task 6（delete-lock 纯模块 + 错误分类/命令判定真实 helper + rpc-manager canonical/引用计数/fast path 前检查/wrapper 二次防线）+ Task 6.6（agent/new 目录创建及 agent/[id] 已有会话命令均纳入 operation guard）+ Task 6.7（11 组并发/分类/命令规则单测）+ Task 7/9（jsonl 过滤与 fail-closed 编排）。
- §6 前端（/admin 页、AppShell 角色区分、FileExplorer/FileViewer 只读化、buildFileUrl、loading/error/forbidden 状态 R3#6）→ Task 12/13/14；"只读查看、编辑删单文件为预留"已在 Task 11/14 明确。
- §7 中间件：放行清单不变，admin 校验落在各 API（requireAdmin）→ 无需改 middleware，Task 3/5/10/11 已覆盖；plan 未改 `middleware.ts`（符合 §7「放行清单不变」）。
- §8 测试 → Task 1/6.5/6.7/7 单测（roles / session-ownership / delete-lock 共 11 组，含已有 wrapper command guard 与 alive/abort 豁免 / delete-user-helpers）+ Task 15 端到端手测（统一重建隔离 HOME；每块 source 600 权限凭据文件；HTTP/JSON/文件/数据库硬断言；结束显式停 dev）。
- §9 安全要点（realpath/lstat、防软链逃逸、canonical 归属、删除锁引用计数、`withStartGuard` 目录创建临界区、`withCwdOperationGuard` 已有会话命令临界区、wrapper alive/删除二次防线、两 root 分离、先禁用、super_admin 保护、fail-closed）→ Task 6/6.5/6.6/8/9/11。
- §10 变更文件清单 → 全部落到对应 Task；roles.ts 拆分出 admin-guard.ts、delete-user.ts、delete-user-helpers.ts、delete-lock.ts；paths.ts 加 canonicalizeExistingPrefix/resolveSessionOwnership；rpc-manager.ts 薄包装删除锁 + abortSessionsUnderCwd；pi-types.ts 补 dispose?()，属合理分解。

**占位符扫描**：无 TBD/TODO；每个改动步骤含具体代码或具体命令 + 预期输出。关键落实：
- `startRpcSession`（Task 6 Step 2）给出**完整替换后函数**，首次 canonical/删除检查位于 existing/inflight fast path 前；二次检查置于注册表写入前并完整清理。`AgentSessionWrapper.send` 使用真实 `assertSessionCommandAllowed` 拒绝 destroyed/deleting 非 abort 命令；`/api/agent/[id]` POST 给出完整 operation guard 替换代码。
- `file-serve.ts`（Task 11 Step 0）给出**完整文件内容**（含 `getExt`/`createFileBodyStream`/`contentDispositionAttachment` 等私有依赖与常量整组迁移）+ 普通路由删改与 import 具体清单，带 checkbox。
- Task 15 启动前重建固定隔离 HOME，等待 dev ready；注册/登录 HTTP 状态均硬断言；凭据与 `gettok` 写入 mode 600 的 `/tmp/pi-admin-e2e.env`，后续每个独立块显式 source，刷新 alice token 后原子更新 env，最后停止 dev 并删除凭据。图片验收用固定 base64 造确定 PNG。
- Task 5 Step 3 标明 `logout/[provider]` 现有参数名为 `_req`，加 `requireAdmin(req)` 时须先改为 `req`。

（仅存 UI props 增量描述 `// ...原有类型...`（Task 12 TreeNode），语义为“原有字段不变、仅追加 readOnly?/urlBase?”，非关键路径占位。）

**类型一致性**：`Role`/权限函数、session guard、文件 URL、归属 helper、`createDeleteLock`/`createDeleteWindowAbortError`/`assertSessionCommandAllowed`、`abortSessionsUnderCwd`、删除锁 mark/wait、`withStartGuard`/`withCwdOperationGuard`、`deleteUserCompletely`、`guardAdminViewTarget` 跨 Task 引用一致。

**已知取舍**：admin 文件通道复用普通路由抽出的 `file-serve.ts`，图片/音频经 `streamFile` 返二进制并**支持 Range**（与普通通道同一套 MIME/streaming 逻辑，Task 11），仅关闭 watch（只读不监听）；admin 对话详情**复用主界面 `MessageView` 富渲染**（Task 14，不传 `onFork`/`onNavigate`/`onEditContent` 等回调即天然只读，非 JSON dump）。均属 §6「只读查看」范围内的完整实现；他人内容「编辑/删单文件」为 §6 预留功能，本次不做。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-admin-console.md`. 两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 Task 派新 subagent，Task 间双阶段 review，快速迭代。

**2. Inline Execution** — 本会话内按 executing-plans 批量执行，设检查点 review。

选哪种？
