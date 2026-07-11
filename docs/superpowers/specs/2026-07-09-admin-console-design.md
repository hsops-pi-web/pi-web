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
| 删除用户范围 | 彻底删：先禁用+撤登录 → 终止运行中 AgentSession → 扫描确定 jsonl 集合 → 先删该用户对话 jsonl → 再删工作目录 `~/pi-users/<用户名>` → 最后删 users 行；见 §5.2 删除序列 |
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
- `getSessionUserWithRole(request): { username, role } | null` — 查 sessions + users，
  一次拿到角色。**内部**校验时若 `disabled=1` 立即视为无效返 null（配合禁用踢下线），
  故返回的对象必然是未禁用用户，不再单独暴露 `disabled` 字段（调用方无需据此判断）。
- `requireAdmin(request)` — 返回 `{username, role}` 或返回 401/403 的 `NextResponse`（调用方
  `if (guard instanceof NextResponse) return guard` 判定，**不抛异常**）；role 为 admin/super_admin 放行。
- `requireSuperAdmin(request)` — 同样返回 `{username, role} | NextResponse`，仅 super_admin 放行（用于提权/降级）。
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
| 查看目标(T=super_admin)文件/对话 | ❌ | ❌（例外，见下方"原需求例外说明"）| ✅（仅本人；经 admin 通道或普通通道皆可）|
| 禁用/启用/删除 T=user | ❌ | ✅ | ✅ |
| 禁用/启用/删除 T=admin | ❌ | ❌ | ✅ |
| 禁用/启用/删除 T=super_admin | ❌ | ❌ | ❌（含 super 本人，硬拒）|
| 提权 user→admin / 降级 admin→user | ❌ | ❌ | ✅ |

统一判定封装在 `lib/auth/roles.ts`：`canManage(actorRole, targetRole): boolean`、
`canChangeRole(actorRole): boolean`（仅 super_admin true）。每个管理 API 先取目标用户当前 role，
再调 `canManage`/`canChangeRole`，不满足返 403。禁止仅凭 requireAdmin 就放行破坏性操作。

**原需求例外说明（已确认的需求变更）**：最初需求为"管理员可查看每个用户"（§1）。该表述提出时
尚无 admin/super_admin 分层。引入分层后，若低权限 admin 能读最高权限 super_admin(hsops) 的私有
文件与对话即构成越权，故正式修订为例外——普通 admin 不得查看 super_admin 的文件与对话。
验收口径据此确定为："管理员可查看所有权限不高于自己的用户（super_admin 可看全部；普通 admin
可看所有 user 与 admin，但看不到 super_admin）"。此为经确认的需求收敛，非实现妥协。

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
- `POST /api/admin/users/[username]/disable` `{disabled:0|1}`（亦接受 `true/false`，其他值返 400）— 禁用/启用。requireAdmin
  + 取目标当前 role 过 `canManage(actor,target)`；禁用时删该用户全部 session；
  目标为 admin 时普通 admin 被拒（仅 super_admin 可），目标为 super_admin 一律拒。
- `DELETE /api/admin/users/[username]` — 彻底删。requireAdmin + `canManage(actor,target)`；
  目标为 admin 时仅 super_admin 可删，目标为 super_admin 一律拒。
  删除按 §5.2 序列执行（先禁用+撤登录 → 终止运行中 AgentSession → 扫描确定 jsonl 集合 → 先删 jsonl → 再删工作目录 → 最后删 users 行）。
- **查看目标用户内容**：管理员查看走以目标用户名为**路径参数**的受控通道（统一用路径参数，不用 query）：
  - `GET /api/admin/users/[username]/sessions` — 该用户的会话列表（cwd 属于其目录）。
  - `GET /api/admin/users/[username]/sessions/[id]` — 会话详情（只读）。
  - `GET /api/admin/files/[username]/[[...path]]` — 该用户目录内文件树/内容（只读，realpath 校验仍限该用户目录，防逃逸）。用**可选** catch-all（`[[...path]]`），空段（前端未知根路径时的首个请求）回退到 `getUserRoot(username)` 列用户根，非空段与普通路由同法从 `/` 重建绝对路径。
  这些通道内部把"允许根"设为 `~/pi-users/<目标用户>`，与普通用户通道隔离，仅 requireAdmin 可达。
- **super_admin 内容保护**：所有 `/api/admin/users/[username]/*` 与 `/api/admin/files/[username]/*`
  在解析目标用户后，若目标为 super_admin 且请求者不是该 super_admin 本人，一律返 403。
  即普通 admin 看不到 super_admin(hsops) 的文件与对话；hsops 本人不受此限——`guardAdminViewTarget`
  在"请求者即目标本人"时放行，故 hsops 既可在 `/admin` 后台经 admin 通道查看自己，也可经普通用户通道查看，
  两条通道对本人都开放（仅"他人 admin 看 super_admin"被拒）。
  该保护与"删除/禁用/降级 super_admin 被拒"同源，集中在一处判断（`isSuperAdmin(目标)` → 拒绝）。

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

## 5.2 删除用户序列（顺序敏感，fail-closed）

AgentSession 存在全局注册表（`lib/rpc-manager.ts` 的 `AgentSessionWrapper`，含 `cwd`、
`send({type:"abort"})`、`destroy()`），正在运行的会话在用户删除后可能继续向其目录写文件。
另外：会话 jsonl 的归属判断用 `resolveSessionOwnership(cwd, user)`（`lib/auth/paths.ts`）——
**cwd 存在时对其 `realpathSync` 防 symlink 逃逸；cwd 已删（用户先前删了项目目录、jsonl 仍在）时
降级用规范化路径做严格目录边界判断**，使这类历史对话仍归属该用户、不被漏删。为避免"目录删除后
无法再枚举/归属"，待删 jsonl 集合仍必须在删目录**之前**先扫描确定并固定为绝对路径。
删除按序（fail-closed；**先删 jsonl，后删目录**，避免"目录已删致重试无法枚举而永久残留"）：

- **前置 A（先禁用，R5#3）**：在任何可能失败的根校验**之前**先 `UPDATE users SET disabled=1` + `DELETE FROM sessions WHERE username=?`。保证即便后续根校验/规范化失败提前返回，账号也已被禁、无法登录——防"恶意用户把自己的根换成软链让 DELETE 失败、账号却仍可登录"。失败后账号处于"已禁用、可重试删除"状态，符合 fail-closed。
- **前置 B（根安全校验，R4#1）**：`userRootPath = getUserRoot(user)`（原始）与 `canonicalRoot = canonicalizeExistingPrefix(userRootPath)`（canonical）**分离**——`rmSync` 只删 `userRootPath`，canonical 只用于锁/归属/会话比较。先 `lstatSync(userRootPath)`：若它本身是 symlink 则 **fail-closed 拒绝删除**（不删软链、更不删其目标）；ENOENT 视为无目录可删、继续；其他错误 fail-closed。再 `canonicalizeExistingPrefix(userRootPath)` 求 canonicalRoot（**仅 ENOENT 降级、EACCES/ELOOP 抛出→fail-closed**）。此二者失败时账号已在前置 A 禁用。
0. **标记删除锁（启动/命令竞态，正式步骤非可选）**：`markRootDeleting(canonicalRoot)`（按 **canonical root** 引用计数，
   支持同一 root 并发删除不提前解锁）。此后 `startRpcSession` 与 `/api/agent/new` 对 cwd 落在该 root 内的
   新启动/建目录**一律拒绝**（抛错、不建目录/session/jsonl），堵住"已通过鉴权、正在 `/api/agent/new`
   `mkdirSync` 或 `startRpcSession` 但尚未进注册表"的会话在删除后重建目录/jsonl。同时，
   `/api/agent/[id]` 的 POST 命令派发必须整段进入同一个 canonical cwd operation guard；
   `AgentSessionWrapper.send()` 对已销毁 wrapper 及删除窗口内的非 `abort` 命令再次 fail-closed 拒绝，
   但内部删除流程使用的 `abort` 命令必须豁免。这样，已通过鉴权并暂停在 `req.json()` 的旧请求也不能
   在删除窗口内向已有 wrapper 追加 prompt/compact/fork 等写操作。
   放在最外层、`finally` 中 `unmarkRootDeleting` 解除（计数归 0 才移除），避免删除失败后永久锁死该目录。
1. **幂等再次撤销登录 session**：再次执行 `DELETE FROM sessions WHERE username=?`，覆盖前置 A 到删除锁标记之间可能新建的 session；
   `disabled=1` 已在前置 A 完成，账号在根校验失败时也保持禁用，不在本步重复设置。
2. **等 in-flight 操作清空 + 终止运行中 AgentSession**：先 `await waitForStartsUnderRoot(root)`
   等待"标记前已进入临界区"的 in-flight 操作 settle——既含 `startRpcSession` 的 start，也含
   `/api/agent/new` 经 `withStartGuard` 登记的"mkdir + 启动"整段（落地或失败），以及
   `/api/agent/[id]` 经 `withCwdOperationGuard` 登记的已有会话命令派发；再遍历 rpc-manager
   注册表，对 **canonical cwd** 落在 `~/pi-users/<user>` 内的每个 wrapper 调 `await send({type:"abort"})` 后
   `destroy()` 并移除（wrapper 无公开 `abort()`，用 `send`；用 canonical 比较使外部软链别名不漏 abort）。
   第 0 步标记、本步等待、`startRpcSession`/`withStartGuard`/`withCwdOperationGuard` 注册前二次检查，
   再加 wrapper 的删除状态与 alive 检查，夹住启动、建目录和已有会话命令全时序，使"扫描后才落地的
   新会话/新命令写入/被重建的目录"不可能出现——这是彻底删除的正式保证，非可选增强。
3. **趁目录还在，扫描确定待删 jsonl 集合**：遍历 `~/.pi/agent/sessions` 下 jsonl，
   对每个 session 先 `resolveSessionOwnership(cwd, user)`（cwd 存在走 realpath 防逃逸，cwd 已删走字符串边界，
   使删了项目目录但 jsonl 仍在的历史会话仍纳入），通过者再做字符串归属，
   算出 cwd 落在 `~/pi-users/<user>` 内的 `{id, path}` 列表，存下（此时目录还在，之后不再依赖归属重算）。
   放在禁用+终止会话**之后**扫描，确保运行中会话已停、不再产生新 jsonl。
4. **先删 jsonl，再删工作目录**：逐个删第 3 步的 jsonl（删后对每个 id 调 `invalidateSessionPathCache(id)` 清路径缓存），
   全部 jsonl 删净后再 `fs.rmSync(userRootPath, {recursive:true, force:true})`——删的是**原始** `~/pi-users/<user>` 目录项，
   **绝不用 canonical 路径**（用户根是软链的场景已在前置步 fail-closed 拒绝，此处只会删真实目录）。
   **顺序关键**：先删 jsonl 后删目录，保证"jsonl 未删净时目录仍在"——这是重试的真正保证：
   任一 jsonl 删除失败即中止（目录尚未删），下次重试可重新枚举并按第 3 步归属逻辑再算集合；
   反之若先删目录，重试时该用户的 jsonl 仍能被 `resolveSessionOwnership` 按字符串边界归属，故不永久残留。
5. **删用户行**：`DELETE FROM users WHERE username=?`。

**fail-closed**：任一步（尤其 2/4）失败则中止，保留已置 `disabled=1` 的 users 行并返回错误，
使管理员可重试删除；不允许留下"用户行已删但目录/进程/jsonl 还在"的半删状态。第 5 步放最后，
保证清理未完成时用户记录仍在、可重入。**重试安全**：第 3 步的固定 `{id,path}` 列表只在当前请求内有效；
跨请求重试是**重新扫描重算**归属集合。真正的重试保证来自"先删 jsonl 后删目录"的顺序——
jsonl 未删净时目录必然还在，故重试能按原路径重新枚举；即便某次已删到目录，
`resolveSessionOwnership` 对 cwd 已删的 jsonl 仍按字符串边界归属该用户，重试仍删得净，不永久残留。

## 6. 前端

### 后台页 `app/admin/page.tsx`（新增，独立路由）
- 进入前置校验：middleware 放行到页面后，页面首个请求 `/api/admin/users`；非 admin 返 403 → 跳 `/`。
- 布局：左侧用户列表（用户名 + 角色徽章 + 禁用状态 + 创建时间）；右侧选中用户后
  分两个 tab —「文件」(只读文件树，复用 FileExplorer 只读模式) 与「对话」(会话列表 + 只读详情)。
- **加载/错误/无权限状态（不得永久"加载中"或把 403 当空）**：文件根与对话列表请求都显式区分
  loading / ok / forbidden(403) / error。普通 admin 选中 super_admin 时这两个请求返 403，页面须显示
  「无权限查看该用户内容」而非停在「加载中…」；对话列表 403 亦不得静默呈现为「无对话」；网络等其他
  错误显示「加载失败，请重试」。
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

- **统一寻址** `buildFileUrl(path, type)`：现有 read/watch 硬编码 `/api/files/...`，且下载走
  `lib/file-paths` 的 `getFileDownloadUrl`（同样固定 `/api/files`）。复用前把四类地址收敛到一个
  可注入基址的构造器，覆盖 `list` / `read` / `download` / `watch`。admin 只读模式传入 admin 基址
  `/api/admin/files/<目标用户>`，其中 `watch` 不启用（只读不监听）。
- **FileExplorer**：新增 `readOnly?: boolean`，用注入的 `buildFileUrl` 取代硬编码。
  `readOnly` 时不渲染删除按钮、不启用 mention、不触发写操作；读取 `urlBase` 的根加载 effect 与递归
  `loadChildren` callback 必须把 `urlBase` 纳入依赖，切换目标用户/通道时不得复用旧 closure。
- **FileViewer**：read/download 用注入的 `buildFileUrl`；admin 只读模式关闭 watch EventSource
  等副作用，仅只读渲染（或新增专用只读 viewer）。图片/音频 watch effect 依赖包含
  `filePath/readOnly/urlBase`；文本 viewer 必须始终执行首次 read，只能跳过 EventSource 创建，不能因
  `readOnly` 提前 return 而不加载内容；`fetchContent` callback 依赖包含 `urlBase`。
- admin 模式统一关闭：删除、mention、文件监听（watch）及任何写操作入口。
- 普通用户路径行为完全不变（默认基址 `/api/files`，`readOnly=false`）。

## 7. 中间件

`middleware.ts` 放行清单不变；`/admin` 与 `/api/admin/*` 仍走 cookie 存在性初筛，
真正 admin 校验由各 API 的 requireAdmin 做（Edge runtime 读不了 SQLite）。
`/api/admin/*` 无 cookie → 401；页面 `/admin` 无 cookie → 跳登录；有 cookie 非 admin → API 403 前端跳首页。

## 8. 测试

- `lib/auth/roles.ts` 纯函数单测：`isAdmin`/`isSuperAdmin`、`canManage(actor,target)`
  全 3×3 组合（admin 不能管 admin/super、super 不能删自己等）、`canChangeRole`。
- 删除用户的 jsonl 归属过滤纯逻辑单测（给定 cwd 列表 + 目标目录，返回待删集合）。
- `resolveSessionOwnership`/`canonicalizeExistingPrefix` 单测（`session-ownership.test.ts`）：cwd 存在、cwd 已删（保留归属）、
  越界、坏软链（realpath ENOENT→fail-closed）、外部软链子路径（前缀 realpath 落根外→false）、软链环（ELOOP→fail-closed）、
  无权限祖先（EACCES→fail-closed）。
- 删除锁并发单测（`delete-lock.test.ts`，import 真实 `createDeleteLock` 与 `createDeleteWindowAbortError`）：引用计数（并发删除不提前解锁）、
  in-flight 等待、普通启动失败吞掉、**清理成功不设置 `deleteWindowCleanup`、仅清理失败才设置为 true 并传播**、**完整 `withStartGuard` 等待时序**
  （guard 进入→body 暂停→删除 mark→wait 保持等待→body settle→wait 完成），以及**已有 wrapper 命令 guard**的同一可控时序：
  命令进入并暂停后删除必须等待，删除标记后到达的命令必须被拒；另验证 wrapper 已销毁或删除中的非 `abort` 命令拒绝、`abort` 仍可执行。
- 端到端手测：
  - 普通 user 访问 `/admin`、`/api/admin/*`、配置类 API（models-config/skills/provider）全 403。
  - 禁用用户后：该用户重新登录返 403、已持 cookie 的请求经强化后的 `getSessionUser` 立即 401 跳登录。
  - 普通 admin 尝试禁用/删除另一 admin → 403；尝试改角色 → 403；尝试看 super_admin 文件/对话 → 403。
  - super_admin 可提权/降级、可删 admin，但删/禁用自己 → 403。
  - 删用户：运行中的会话被 abort/destroy，删除前抓 jsonl 绝对路径、删除后逐个断言 `! -e`，users 行删除；
    cwd 已删的历史会话（proj-x）也被清；模拟目录删除失败时用户行保留且 disabled=1（可重试）。
    Task 15 开始前重建专用隔离 HOME；账号注册和登录都硬断言 HTTP 200；凭据写入 mode 600 临时 env，
    每个后续命令块显式 source，确保新 shell/subagent 可独立执行；结束停止隔离 dev 并删除凭据。
    关键删除链路脚本使用 `set -euo pipefail`，并对两个造数响应的 `sessionId`、删除前路径存在、
    删除后目录/jsonl 不存在及 users 计数为 0 做硬断言，任一失败立即停止，禁止只打印 FAIL 后继续。
  - **软链根安全**：用户根被换成软链时，删除 fail-closed 拒删、软链目标目录零损、用户行保留且 disabled=1、
    账号不能再登录（前置先禁用）。

## 9. 安全要点

- 所有 `/api/admin/*` 必过 requireAdmin/requireSuperAdmin，越权返 403。
- 查看/删除他人目录仍用 realpathSync 校验限定在目标用户目录内，防 symlink 逃逸。
- **文件列表用 `lstatSync`（不跟随 symlink）**：目录列举阶段不解析软链目标，逃逸软链只显示链接名、
  不泄露其指向的外部文件类型/大小/mtime；read/download 阶段的 `resolveExistingAndCheck` realpath 再挡逃逸读取。
- **session/jsonl 归属用 `resolveSessionOwnership`**：cwd 存在走 realpath 防逃逸，cwd 已删走规范化字符串
  严格边界（使删了项目目录但 jsonl 仍在的历史对话仍归属该用户，可查看、删用户时可清）；
  文件读取仍要求 realpath 成功，不放宽。
- **删除竞态用删除锁（正式步骤，非可选）**：纯模块同时导出 `createDeleteLock` 与
  `createDeleteWindowAbortError(cleanupErr)`，rpc-manager 与单测复用同一真实错误分类 helper，确保只有清理失败才标记
  `deleteWindowCleanup=true`；`markRootDeleting`/`unmarkRootDeleting`（**canonical root 引用计数**，
  支持并发删除不提前解锁）+ `waitForStartsUnderRoot`（等 in-flight，删除窗口清理失败传播 fail-closed）+
  `startRpcSession` 注册前二次检查（清理已建 inner）+ `withStartGuard`（把 `/api/agent/new` 的 `mkdirSync` +
  启动整段纳入临界区）+ `withCwdOperationGuard`（把 `/api/agent/[id]` 的已有 wrapper 命令派发纳入临界区）+
  `AgentSessionWrapper.send` 的 alive/删除状态二次防线（`abort` 豁免）。这些约束夹住"目录创建 + 启动 + 注册 +
  已有会话命令"全时序，堵住已鉴权请求在删除期间重建目录/jsonl 或继续向旧会话写入。
- **canonical cwd 一致**：`startRpcSession` 入口把 cwd canonical 化并透传 `SessionManager.create`/`wrapper.cwd`，
  jsonl header 也存 canonical；删除时 `abortSessionsUnderCwd`/归属/`filterJsonlUnderRoot` 均用 canonical，
  使外部软链别名（`/tmp/x->~/pi-users/alice/p`）不漏 abort/漏删（R3#5）。
- **删除只删原始目录项**：`rmSync` 用原始 `~/pi-users/<user>`（`userRootPath`），**绝不用 canonical 路径**；
  用户根本身是 symlink 时 fail-closed 拒删——防误删软链目标目录（R4#1）。
- super_admin 硬保护贯穿所有写操作（改角色/禁用/删除前先判目标是否 super_admin）；
  查看类操作同样保护——普通 admin 不能读取 super_admin 的文件与对话（返 403），
  super_admin 本人可经 admin 通道或普通用户通道查看自己内容（`guardAdminViewTarget` 对"本人=目标"放行）。
- 删除为不可逆操作，前端二次确认，后端 fail-closed（解析失败即拒绝）。

## 10. 变更文件清单

新建：`lib/auth/roles.ts`、`app/admin/page.tsx`、`app/api/admin/users/route.ts`、
`app/api/admin/users/[username]/route.ts`（PATCH/DELETE）、
`app/api/admin/users/[username]/disable/route.ts`、
`app/api/admin/users/[username]/sessions/route.ts`、`.../sessions/[id]/route.ts`、
`app/api/admin/files/[username]/[[...path]]/route.ts`、
`app/api/files/[...path]/file-serve.ts`（从普通 files 路由抽出的共享纯 helper：路径重建/MIME/streaming/download，admin 通道复用）、
`lib/auth/admin-guard.ts`（`getUserRole` + `guardAdminViewTarget`，含 super_admin 内容保护，集中一处）、
`lib/auth/delete-user.ts`（删除用户序列编排，fail-closed；**先禁用+撤登录再做根校验**防"软链根让 DELETE 失败、账号仍可登录"；userRootPath/canonicalRoot 分离，`rmSync` 只删原始目录项、软链根 fail-closed 拒删）、
`lib/auth/delete-user-helpers.ts`（jsonl 归属过滤纯逻辑，自包含可测）、
`lib/auth/delete-lock.ts`（删除锁纯状态机 `createDeleteLock` + 删除窗口错误分类 helper
`createDeleteWindowAbortError(cleanupErr)` + wrapper 命令判定 helper
`assertSessionCommandAllowed(alive,deleting,commandType)`，无 pi/fs 依赖，rpc-manager 与单测共享真实实现）、
`__tests__/lib/auth/roles.test.ts`、`__tests__/lib/auth/delete-user-helpers.test.ts`、
`__tests__/lib/auth/session-ownership.test.ts`（cwd 已删 / 坏软链 / 外部软链子路径 / 软链环 / 无权限祖先）、
`__tests__/lib/auth/delete-lock.test.ts`（import 真实 `createDeleteLock` / `createDeleteWindowAbortError` /
`assertSessionCommandAllowed`：引用计数 / 等待 / 清理成败分类 / 新建与已有会话 guard 时序 / destroyed 与 abort 豁免）。

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
- `components/FileExplorer.tsx`（`readOnly` + 注入 `buildFileUrl`，只读时隐藏删除/mention/watch）。
- `components/FileViewer.tsx`（read/download/watch 用注入 `buildFileUrl`，admin 只读关 watch）。
- `lib/file-paths.ts`（`getFileDownloadUrl` 等改为可注入基址，或并入 `buildFileUrl`）。
- `lib/auth/paths.ts`（新增 `canonicalizeExistingPrefix`（部分 realpath，仅 ENOENT 降级，其他错误 fail-closed）+ `resolveSessionOwnership`（session/jsonl 归属，cwd 已删仍判归属）；文件读取仍用 `resolveExistingAndCheck`）。
- `app/api/files/[...path]/route.ts`（把 `filePathFromSegments`/MIME/streaming/download 等纯 helper 抽到同目录 `file-serve.ts` 并 import，行为不变，供 admin 通道复用）。
- `app/api/agent/new/route.ts`（把 `mkdirSync(cwd)` + `startRpcSession` 整段用 `withStartGuard` 包住，纳入删除锁临界区，防目录重建竞态）。
- `app/api/agent/[id]/route.ts`（POST 的已有/新建 wrapper 选择与 `send` 整段用 `withCwdOperationGuard` 包住，阻止已鉴权旧请求在删除窗口内继续写）。
- `lib/rpc-manager.ts`（import 新建 `delete-lock.ts` 的锁工厂、`createDeleteWindowAbortError` 与 `assertSessionCommandAllowed`，并薄包装导出删除锁 `markRootDeleting`/`unmarkRootDeleting`/`waitForStartsUnderRoot`/`withStartGuard`/`withCwdOperationGuard`——先 `canon` 再委托纯模块；`canon` 仅 ENOENT 降级、其他错误传播；保留依赖注册表的 `abortSessionsUnderCwd`（canonical 比较）；`startRpcSession` 在 existing/inflight fast path **之前** canonical 化并检查删除状态、透传 canonical cwd（jsonl header 存 canonical）、注册前二次检查清理已建 inner（`destroy`+`abort`+`dispose?`+删 jsonl，**按清理成败分流并调用共享 helper**：仅失败才 `deleteWindowCleanup` fail-closed）；`AgentSessionWrapper.send` 通过共享命令判定拒绝已销毁 wrapper 与删除窗口内非 `abort` 命令，内部删除用 `send({type:"abort"})` 仍放行）。
- `lib/pi-types.ts`（`AgentSessionLike` 补 `dispose?(): void;`，供二次检查 `inner.dispose?.()` 更彻底清理内部监听/扩展资源）。
