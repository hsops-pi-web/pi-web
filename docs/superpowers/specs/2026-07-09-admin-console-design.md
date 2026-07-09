# pi-web-auth 管理后台与角色权限 设计文档

日期：2026-07-09
项目：pi-web-auth（端口 8000）

## 1. 背景与目标

现有 pi-web-auth 已实现用户注册/登录、按用户名隔离目录、目录内删文件。所有登录用户
权限相同，无管理能力，Models/Skills 配置对所有人可见。本次增加两块：

1. **管理后台**：管理员可查看所有用户、查看任一用户工作区的文件与全部对话、
   禁用/删除用户（删用户连带删其工作目录与对话记录）、super_admin 可提权/降级管理员。
2. **角色区分 UI**：普通用户界面右下角不显示 Models 与 Skills 入口，仅管理员可见。

## 2. 已确认决策

| 项 | 决策 |
|---|---|
| 管理员身份 | DB 存 `role` 字段（`user`/`admin`/`super_admin`），后台点按钮即时改，不改配置重启 |
| 超级管理员 | hsops = super_admin，代码自动 bootstrap（已存在则设为 super，不存在则首次以 hsops 注册时提为 super）|
| super_admin 保护 | 不可被降级、禁用、删除（后端硬编码拦截）|
| 提权/降级权限 | 仅 super_admin 能提权/降级 admin；普通 admin 只能禁用/删除普通 user |
| 普通 user 的禁用/删除 | 所有 admin（含 super）都能做 |
| 后台形态 | 独立页 `/admin`，左用户列表 + 右选中用户的文件树与对话（只读查看）|
| 删除用户范围 | 彻底删：users 行 + 工作目录 `~/pi-users/<用户名>` + 该用户对话 jsonl |
| 禁用生效 | 立即踢下线：删该用户所有 session，下个请求跳登录 |
| Models/Skills 可见性 | 仅 admin/super_admin 可见；普通 user 隐藏 |
| 管理员自身 | super_admin(hsops) 保留自己的 `~/pi-users/hsops` 工作目录与正常对话功能 |

## 3. 数据模型

`users` 表加两列（`lib/auth/db.ts` 建表时 `ALTER`/兼容已存在库）：

```sql
role     TEXT    NOT NULL DEFAULT 'user',    -- user | admin | super_admin
disabled INTEGER NOT NULL DEFAULT 0          -- 0 正常, 1 禁用
```

对已存在的 auth.db：启动时检测列是否存在，缺失则 `ALTER TABLE users ADD COLUMN ...`
（SQLite 支持带默认值的 ADD COLUMN）。

**bootstrap super_admin**：建表/迁移后执行一次——
`UPDATE users SET role='super_admin' WHERE username='hsops'`（hsops 已存在时生效）；
hsops 尚未注册时，注册流程检测 `username==='hsops'` 则写入 `role='super_admin'`。
super_admin 用户名常量集中在一处（如 `lib/auth/roles.ts` 的 `SUPER_ADMIN='hsops'`）。

## 4. 后端鉴权

集中在 `lib/auth/session.ts` / 新增 `lib/auth/roles.ts`：

- `getSessionUser(request): string | null` — 现有，返回 username。
- `getSessionUserWithRole(request): { username, role, disabled } | null` — 查 sessions + users，
  一次拿到角色。session 校验时若 `disabled=1` 立即视为无效（配合禁用踢下线）。
- `requireAdmin(request)` — 返回 `{username, role}` 或抛 401/403；role 为 admin/super_admin 放行。
- `requireSuperAdmin(request)` — 仅 super_admin 放行（用于提权/降级）。
- 角色常量与判断：`isAdmin(role)`、`isSuperAdmin(role)`、`SUPER_ADMIN='hsops'`。

**禁用即时生效**：`getSessionUserWithRole` 每次校验时读 `users.disabled`；管理员禁用某用户时
除置 `disabled=1` 外，直接 `DELETE FROM sessions WHERE username=?`，该用户下个请求即 401 跳登录。

## 5. 管理 API（均 Node runtime，入口 requireAdmin/requireSuperAdmin）

- `GET /api/admin/users` — 列所有用户 `{username, role, disabled, created_at}`。requireAdmin。
- `PATCH /api/admin/users/[username]` — 改角色（body `{role}`）。**requireSuperAdmin**；
  拒绝操作 super_admin 本身；只能在 user<->admin 间调整。
- `POST /api/admin/users/[username]/disable` `{disabled:0|1}` — 禁用/启用。requireAdmin；
  禁用时删该用户全部 session；拒绝禁用 super_admin。
- `DELETE /api/admin/users/[username]` — 彻底删。requireAdmin；拒绝删 super_admin；
  依次：删 sessions 行、删 users 行、`fs.rmSync(~/pi-users/<user>, {recursive})`、
  删 `~/.pi/agent/sessions` 下 cwd 落在该目录的 jsonl（复用会话 cwd 归属判断）。
- **查看目标用户内容**：管理员查看走带 `?asUser=<username>` 的受控通道：
  - `GET /api/admin/users/[username]/sessions` — 该用户的会话列表（cwd 属于其目录）。
  - `GET /api/admin/users/[username]/sessions/[id]` — 会话详情（只读）。
  - `GET /api/admin/files/[username]/[...path]` — 该用户目录内文件树/内容（只读，realpath 校验仍限该用户目录，防逃逸）。
  这些通道内部把"允许根"设为 `~/pi-users/<目标用户>`，与普通用户通道隔离，仅 requireAdmin 可达。

## 5.1 普通用户配置 API 边界（收紧）

普通 user 不仅前端隐藏 Models/Skills 入口，配置类 API 也在后端拒绝（返 403），
不依赖前端隐藏。逐个明确：

| API | 方法 | 普通 user | admin/super_admin |
|---|---|---|---|
| `/api/models` | GET | ✅ 允许（切换模型需读模型列表，只读）| ✅ |
| `/api/models-config` | GET / PUT | ❌ 403（读写模型池均属管理）| ✅ |
| `/api/models-config/test` | POST | ❌ 403 | ✅ |
| `/api/skills` | GET / PATCH | ❌ 403 | ✅ |
| `/api/skills/search` `/install` | POST | ❌ 403 | ✅ |

- 实现：上述 admin-only 路由入口从 `getSessionUser` 换成 `requireAdmin`。
- 普通用户切换模型不受影响——切换走 agent 命令通道（`/api/agent/new` 带 provider/modelId
  → `set_model`），不经 `/api/models-config`；`/api/models` GET 保留供读取可选模型列表。
- 既有遗留（本次不改，仅标记待核查）：`/api/auth/login/[provider]`、
  `/api/auth/logout/[provider]` 当前无 `getSessionUser`，属第三方 provider 登录流程，
  与本需求无关，后续单独核查是否需要加固。

## 6. 前端

### 后台页 `app/admin/page.tsx`（新增，独立路由）
- 进入前置校验：middleware 放行到页面后，页面首个请求 `/api/admin/users`；非 admin 返 403 → 跳 `/`。
- 布局：左侧用户列表（用户名 + 角色徽章 + 禁用状态 + 创建时间）；右侧选中用户后
  分两个 tab —「文件」(只读文件树，复用 FileExplorer 只读模式) 与「对话」(会话列表 + 只读详情)。
- **本次范围只读查看**：管理员对目标用户文件/对话仅查看，不提供编辑/删除单个文件或对话的能力。
  在他人目录内编辑文件、删除单条对话/文件等操作**作为未来预留功能**，本次不实现；
  后端 admin 文件/会话通道本次只暴露 GET（读），预留 DELETE/PUT 待将来按需开启。
- 操作区：每个用户行/详情头有「禁用/启用」「删除用户」按钮（删除二次确认，提示连带删目录与对话）；
  super_admin 额外显示「设为管理员/取消管理员」。注意：这里的「删除」是删**整个用户**（连带其目录），
  与上面"预留的删单个文件"是两件事。
- super_admin(hsops) 行的破坏性按钮禁用置灰。

### 主界面角色区分 `components/AppShell.tsx`
- `/api/auth/me` 返回增加 `role`。
- AppShell 读 role：`isAdmin` 才渲染 Models/Skills 入口；普通 user 不渲染。
- 顶栏用户菜单：admin/super_admin 增加「管理后台」入口跳 `/admin`。

## 7. 中间件

`middleware.ts` 放行清单不变；`/admin` 与 `/api/admin/*` 仍走 cookie 存在性初筛，
真正 admin 校验由各 API 的 requireAdmin 做（Edge runtime 读不了 SQLite）。
`/api/admin/*` 无 cookie → 401；页面 `/admin` 无 cookie → 跳登录；有 cookie 非 admin → API 403 前端跳首页。

## 8. 测试

- `lib/auth/roles.ts` 纯函数（isAdmin/isSuperAdmin/角色流转合法性）单测。
- 删除用户的 jsonl 归属过滤纯逻辑单测（给定 cwd 列表 + 目标目录，返回待删集合）。
- 端到端手测：普通 user 访问 `/admin` 与 `/api/admin/*` 应 403；admin 可看不可提权；
  super_admin 可提权且不能删自己；禁用用户后其请求立即 401；删用户后目录与对话消失。

## 9. 安全要点

- 所有 `/api/admin/*` 必过 requireAdmin/requireSuperAdmin，越权返 403。
- 查看/删除他人目录仍用 realpathSync 校验限定在目标用户目录内，防 symlink 逃逸。
- super_admin 硬保护贯穿所有写操作（改角色/禁用/删除前先判目标是否 super_admin）。
- 删除为不可逆操作，前端二次确认，后端 fail-closed（解析失败即拒绝）。

## 10. 变更文件清单

新建：`lib/auth/roles.ts`、`app/admin/page.tsx`、`app/api/admin/users/route.ts`、
`app/api/admin/users/[username]/route.ts`（PATCH/DELETE）、
`app/api/admin/users/[username]/disable/route.ts`、
`app/api/admin/users/[username]/sessions/route.ts`、`.../sessions/[id]/route.ts`、
`app/api/admin/files/[username]/[...path]/route.ts`、
`__tests__/lib/auth/roles.test.ts`。

修改：`lib/auth/db.ts`（加列 + bootstrap）、`lib/auth/session.ts`（角色 helper）、
`app/api/auth/me/route.ts`（返回 role）、`app/api/auth/register/route.ts`（hsops 提 super）、
`components/AppShell.tsx`（按 role 隐藏 Models/Skills + 后台入口）、
`components/FileExplorer.tsx`（只读模式支持）。
