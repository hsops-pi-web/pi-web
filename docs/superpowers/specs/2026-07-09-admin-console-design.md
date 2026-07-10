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
| 提权/降级权限 | 仅 super_admin 能提权/降级 admin；普通 admin 不能改任何人角色 |
| 普通 admin 可管理对象 | 仅普通 user（禁用/启用/删除）；不能对任何 admin（含自己、其他 admin、super_admin）做禁用/删除 |
| super_admin 可管理对象 | user 与 admin 均可（禁用/启用/删除/提权/降级），但不能对自己做破坏性操作 |
| 权限校验方式 | 按目标用户当前 role 后端校验，不靠前端隐藏按钮；见 §4.1 权限矩阵 |
| 后台形态 | 独立页 `/admin`，左用户列表 + 右选中用户的文件树与对话（只读查看）|
| 删除用户范围 | 彻底删：先终止运行中 AgentSession → 删 session 行 → 删工作目录 `~/pi-users/<用户名>` → 删该用户对话 jsonl → 删 users 行；见 §5.2 删除序列 |
| 禁用生效 | 登录接口拒绝禁用用户（403）；已登录者删其所有 session；`getSessionUser` 内部拒绝禁用用户，下个请求即跳登录 |
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

## 4.1 权限矩阵（后端按目标角色校验，前端仅辅助隐藏）

设请求者角色 R、目标用户角色 T。所有写操作在后端按下表判定，前端隐藏按钮只是体验，不作为安全边界。

| 操作 | user 可做 | admin 可做 | super_admin 可做 |
|---|---|---|---|
| 查看用户列表 | ❌ | ✅ | ✅ |
| 查看目标(T=user)文件/对话 | ❌ | ✅ | ✅ |
| 查看目标(T=admin)文件/对话 | ❌ | ✅ | ✅ |
| 查看目标(T=super_admin)文件/对话 | ❌ | ❌（§3 例外，见下）| ✅（仅本人经普通通道）|
| 禁用/启用/删除 T=user | ❌ | ✅ | ✅ |
| 禁用/启用/删除 T=admin | ❌ | ❌ | ✅ |
| 禁用/启用/删除 T=super_admin | ❌ | ❌ | ❌（含 super 本人，硬拒）|
| 提权 user→admin / 降级 admin→user | ❌ | ❌ | ✅ |

统一判定封装在 `lib/auth/roles.ts`：`canManage(actorRole, targetRole): boolean`、
`canChangeRole(actorRole): boolean`（仅 super_admin true）。每个管理 API 先取目标用户当前 role，
再调 `canManage`/`canChangeRole`，不满足返 403。禁止仅凭 requireAdmin 就放行破坏性操作。

**原需求例外说明**：最初需求为"管理员可查看每个用户"。本设计增加一条例外——普通 admin 不得查看
super_admin(hsops) 的文件与对话。验收口径据此调整为："管理员可查看所有权限不高于自己的用户
（super_admin 可看全部；普通 admin 可看所有 user 与 admin，但看不到 super_admin）"。

## 4.2 禁用用户的登录与校验强化（对齐"禁用即不可登录"）

现有 `app/api/auth/login/route.ts` 仅校验密码即建 session；现有 `getSessionUser()` 只查 session 未过期，
均不看 `disabled`。若不改，禁用用户仍能登录，且 17 处使用 `getSessionUser` 的 API 仍放行。必须：

- **登录接口**：查出用户后增查 `disabled`，为 1 则返 403（`账号已被禁用`），不建 cookie。
- **`getSessionUser()` 强化**：内部改为查 sessions JOIN users，若 `users.disabled=1` 返 null
  （等价未登录）。这样全部 17 个现有调用点自动拒绝禁用用户，无需逐个改。
  `getSessionUserWithRole` 同源实现，多返回 role。
- 禁用操作除置 `disabled=1` 外，`DELETE FROM sessions WHERE username=?` 清其活动 session。

## 5. 管理 API（均 Node runtime，入口 requireAdmin/requireSuperAdmin）

- `GET /api/admin/users` — 列所有用户 `{username, role, disabled, created_at}`。requireAdmin。
- `PATCH /api/admin/users/[username]` — 改角色（body `{role}`）。**requireSuperAdmin**
  且 `canChangeRole`；拒绝操作 super_admin 本身；只能在 user<->admin 间调整。
- `POST /api/admin/users/[username]/disable` `{disabled:0|1}` — 禁用/启用。requireAdmin
  + 取目标当前 role 过 `canManage(actor,target)`；禁用时删该用户全部 session；
  目标为 admin 时普通 admin 被拒（仅 super_admin 可），目标为 super_admin 一律拒。
- `DELETE /api/admin/users/[username]` — 彻底删。requireAdmin + `canManage(actor,target)`；
  目标为 admin 时仅 super_admin 可删，目标为 super_admin 一律拒。
  删除按 §5.2 序列执行（先终止运行中 AgentSession，再删目录/jsonl/用户行）。
- **查看目标用户内容**：管理员查看走带 `?asUser=<username>` 的受控通道：
  - `GET /api/admin/users/[username]/sessions` — 该用户的会话列表（cwd 属于其目录）。
  - `GET /api/admin/users/[username]/sessions/[id]` — 会话详情（只读）。
  - `GET /api/admin/files/[username]/[...path]` — 该用户目录内文件树/内容（只读，realpath 校验仍限该用户目录，防逃逸）。
  这些通道内部把"允许根"设为 `~/pi-users/<目标用户>`，与普通用户通道隔离，仅 requireAdmin 可达。
- **super_admin 内容保护**：所有 `/api/admin/users/[username]/*` 与 `/api/admin/files/[username]/*`
  在解析目标用户后，若目标为 super_admin 且请求者不是该 super_admin 本人，一律返 403。
  即普通 admin 看不到 super_admin(hsops) 的文件与对话；hsops 仍可通过普通用户通道看自己的内容。
  该保护与"删除/禁用/降级 super_admin 被拒"同源，集中在一处判断（`isSuperAdmin(目标)` → 拒绝）。

## 5.2 删除用户序列（顺序敏感，fail-closed）

AgentSession 存在全局注册表（`lib/rpc-manager.ts` 的 `AgentSessionWrapper`，含 `cwd`、
`abort()`、`destroy()`），正在运行的会话在用户删除后可能继续向其目录写文件。删除必须按序：

1. **置禁用 + 撤登录**：`disabled=1` 且 `DELETE FROM sessions WHERE username=?`（用户立即无法登录/操作）。
2. **终止运行中 AgentSession**：遍历 rpc-manager 注册表，对 `cwd` 落在 `~/pi-users/<user>` 内的
   每个 wrapper 调 `abort()` 后 `destroy()`，并从注册表移除，确保无进程再写该目录。
3. **删工作目录**：`fs.rmSync(~/pi-users/<user>, {recursive:true, force:true})`。
4. **删对话 jsonl**：删 `~/.pi/agent/sessions` 下 cwd 落在该目录的 jsonl（复用会话 cwd 归属判断）。
5. **删用户行**：`DELETE FROM users WHERE username=?`。

**fail-closed**：任一步（尤其 2/3）失败则中止，保留已置 `disabled=1` 的 users 行并返回错误，
使管理员可重试删除；不允许留下"用户行已删但目录/进程还在"的半删状态。第 5 步放最后，
保证清理未完成时用户记录仍在、可重入。

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
| `/api/auth/providers` | GET | ❌ 403 | ✅ |
| `/api/auth/all-providers` | GET | ❌ 403 | ✅ |
| `/api/auth/api-key/[provider]` | GET / POST / DELETE | ❌ 403 | ✅ |
| `/api/auth/login/[provider]` | GET / POST | ❌ 403 | ✅ |
| `/api/auth/logout/[provider]` | POST | ❌ 403 | ✅ |

- 实现：上述 admin-only 路由入口从 `getSessionUser` 换成 `requireAdmin`。
- 普通用户切换模型不受影响——切换走 agent 命令通道（`/api/agent/new` 带 provider/modelId
  → `set_model`），不经 `/api/models-config`；`/api/models` GET 保留供读取可选模型列表。
  注意：允许 `/api/models` 只读读取模型列表，不等于显示右下角的 Models 管理入口——
  前者是切换模型所需的数据，后者是配置管理面板；普通用户有前者、无后者。
- **provider/OAuth/api-key 接口纳入 admin-only（修正上一版遗漏）**：ModelsConfig 面板会调用
  `/api/auth/providers`、`/api/auth/all-providers`、`/api/auth/api-key/[provider]`、
  `/api/auth/login|logout/[provider]`。这些接口写的是**全局**模型凭据（如 `api-key` POST 走
  `AuthStorage.set(provider,{type:"api_key",key})`，非按用户隔离），任一登录用户改动都会影响
  全站模型可用性，因此必须限 admin。其中 `login/[provider]`、`logout/[provider]` 现状**无鉴权**
  （连 `getSessionUser` 都没有），本次一并加 `requireAdmin`。

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

### 组件复用契约（FileExplorer / FileViewer 只读化）

现状：`components/FileExplorer.tsx` 把请求硬编码到 `/api/files/...`（如 `?type=list`），且始终渲染
「删除」按钮；`components/FileViewer.tsx` 也把 read/watch 硬编码到 `/api/files/...`。管理员用现有组件
无法读取目标用户目录，也会误显示写操作按钮。因此复用需先参数化：

- **FileExplorer**：新增 `readOnly?: boolean` 与可配置的基址（如 `apiBase`/`buildUrl`）。
  admin 模式传 `readOnly=true` + 基址 `/api/admin/files/<目标用户>`；`readOnly` 时不渲染删除按钮、
  不启用 mention、不触发写操作。
- **FileViewer**：同样支持可配置读取 URL（read 与 watch 都走 admin 基址），或新增专用只读 viewer；
  admin 模式关闭文件监听（watch EventSource）等副作用，仅做只读渲染。
- admin 模式统一关闭：删除、mention、文件监听（watch）及任何写操作入口。
- 普通用户路径行为完全不变（默认 `readOnly=false` + `/api/files` 基址）。

## 7. 中间件

`middleware.ts` 放行清单不变；`/admin` 与 `/api/admin/*` 仍走 cookie 存在性初筛，
真正 admin 校验由各 API 的 requireAdmin 做（Edge runtime 读不了 SQLite）。
`/api/admin/*` 无 cookie → 401；页面 `/admin` 无 cookie → 跳登录；有 cookie 非 admin → API 403 前端跳首页。

## 8. 测试

- `lib/auth/roles.ts` 纯函数单测：`isAdmin`/`isSuperAdmin`、`canManage(actor,target)`
  全 3×3 组合（admin 不能管 admin/super、super 不能删自己等）、`canChangeRole`。
- 删除用户的 jsonl 归属过滤纯逻辑单测（给定 cwd 列表 + 目标目录，返回待删集合）。
- 端到端手测：
  - 普通 user 访问 `/admin`、`/api/admin/*`、配置类 API（models-config/skills/provider）全 403。
  - 禁用用户后：该用户重新登录返 403、已持 cookie 的请求经强化后的 `getSessionUser` 立即 401 跳登录。
  - 普通 admin 尝试禁用/删除另一 admin → 403；尝试改角色 → 403；尝试看 super_admin 文件/对话 → 403。
  - super_admin 可提权/降级、可删 admin，但删/禁用自己 → 403。
  - 删用户：运行中的会话被 abort/destroy，目录与对话 jsonl 消失，users 行删除；
    模拟目录删除失败时用户行保留且 disabled=1（可重试）。

## 9. 安全要点

- 所有 `/api/admin/*` 必过 requireAdmin/requireSuperAdmin，越权返 403。
- 查看/删除他人目录仍用 realpathSync 校验限定在目标用户目录内，防 symlink 逃逸。
- super_admin 硬保护贯穿所有写操作（改角色/禁用/删除前先判目标是否 super_admin）；
  查看类操作同样保护——普通 admin 不能读取 super_admin 的文件与对话（返 403），
  仅 super_admin 本人可经普通用户通道查看自己内容。
- 删除为不可逆操作，前端二次确认，后端 fail-closed（解析失败即拒绝）。

## 10. 变更文件清单

新建：`lib/auth/roles.ts`、`app/admin/page.tsx`、`app/api/admin/users/route.ts`、
`app/api/admin/users/[username]/route.ts`（PATCH/DELETE）、
`app/api/admin/users/[username]/disable/route.ts`、
`app/api/admin/users/[username]/sessions/route.ts`、`.../sessions/[id]/route.ts`、
`app/api/admin/files/[username]/[...path]/route.ts`、
`__tests__/lib/auth/roles.test.ts`。

修改：
- `lib/auth/db.ts`（加 role/disabled 列 + bootstrap hsops）。
- `lib/auth/session.ts`（`getSessionUser` 强化查 disabled、新增 `getSessionUserWithRole`/`requireAdmin`/`requireSuperAdmin`）。
- `app/api/auth/login/route.ts`（禁用用户拒绝登录 403）。
- `app/api/auth/me/route.ts`（返回 role）。
- `app/api/auth/register/route.ts`（hsops 提 super_admin）。
- `app/api/models-config/route.ts`、`app/api/models-config/test/route.ts`、
  `app/api/skills/route.ts`、`app/api/skills/search/route.ts`、`app/api/skills/install/route.ts`
  （入口改 `requireAdmin`）。
- `app/api/auth/providers/route.ts`、`app/api/auth/all-providers/route.ts`、
  `app/api/auth/api-key/[provider]/route.ts`、`app/api/auth/login/[provider]/route.ts`、
  `app/api/auth/logout/[provider]/route.ts`（入口改 `requireAdmin`；后两者当前无鉴权）。
- `components/AppShell.tsx`（按 role 隐藏 Models/Skills + 后台入口）。
- `components/FileExplorer.tsx`（`readOnly` + 可配置基址，只读时隐藏删除/mention/watch）。
- `components/FileViewer.tsx`（可配置读取/watch URL，admin 只读模式关闭 watch 等写副作用）。
- `lib/rpc-manager.ts`（暴露"按 cwd 前缀终止并移除 AgentSession"的辅助，供删除用户 §5.2 调用）。
