# 管理员产品可观测性高级版设计

日期：2026-07-16
阶段：P2 管理员产品可观测性高级版
临时集成分支：`feat/session-workspace-experience`
P2 子分支建议：`feat/session-workspace-admin-observability`
生产源码：`/home/hsops/pi-web-auth`，`main`，端口 8000
开发策略：从 `feat/session-workspace-experience` fork 独立 P2 feature branch/worktree，使用隔离 HOME、非 8000 端口和 user systemd service 验收

## 1. 必读流程

P2 开发、P2 子分支合回 `feat/session-workspace-experience`、以及最终 P1/P2/P3 合回 `main` 前，必须先阅读并遵守：

```text
docs/superpowers/session-workspace-integration-flow.md
```

本设计只定义 P2 范围。P2 完成后先合回临时集成分支 `feat/session-workspace-experience`，不直接合回 `main`。

## 2. 背景

P1 已经把普通用户的会话与工作区体验升级为 SQLite-backed 的产品能力：会话索引、工作区聚合、全文搜索、收藏、标签、归档、批量操作、索引刷新和缺失文件处理都已经有了基础。

现有 `/admin` 仍主要是用户管理页：左侧用户列表，右侧只读文件和对话查看。它能完成禁用、删除、改角色、查看用户文件/会话，但无法回答管理员日常需要的产品观测问题：

- 系统整体是否有人在使用？最近谁最活跃？
- 哪些用户、会话、工作区处于异常状态？
- 某个用户有多少会话、多少工作区、最近活动在哪里？
- 管理员能否跨用户查找某个会话或工作区？
- P1 的 `session-index.db` 是否健康，是否存在 missing/orphaned/index_error？
- 高风险管理行为是否有审计记录？

P2 的目标是把 `/admin` 从“用户管理页”升级为“管理员产品观测中心”。它不是运维发布控制台，不处理 release、backup、systemd、rollback，也不处理 P3 的模型/provider/tool preset 体验。

## 3. 目标与非目标

### 目标

- 使用路由拆分型 admin 信息架构，而不是继续膨胀单个 `/admin/page.tsx`。
- 提供 Admin Dashboard 总览页，展示用户、会话、工作区、活跃度和异常概况。
- 提供用户详情观测页，展示某个用户的基础信息、活跃统计、会话、工作区、异常和只读入口。
- 提供跨用户会话浏览页，支持按用户、工作区、时间、状态和搜索条件过滤。
- 提供跨用户工作区浏览页，支持按用户、活跃时间、会话数和路径搜索。
- 提供索引健康/异常视图，展示 `session-index.db` 的可用性、统计、异常和最近索引状态。
- 提供基础审计记录，记录关键管理员行为。
- 新增 admin 查询层读取 P1 的 `session-index.db`；不能把 P1 单用户 store 方法误用为跨用户查询能力。
- 后端 API 必须执行管理员权限和目标用户权限校验，不依赖前端隐藏。
- 保持普通用户主工作台行为不变。

### 非目标

- 不实现 P3 模型、provider、工具 preset、会话模板、上下文状态体验。
- 不实现发布、备份、systemd 状态、release rollback UI。
- 不实现实时在线回复监控。
- 不实现 token/cost 报表，除非未来 `.jsonl` 或 agent API 稳定提供该数据。
- 不允许管理员编辑其他用户文件或修改他人会话内容；P2 仍是只读观测加既有用户管理操作。
- 不把审计事件写入 `session-index.db`，因为审计不是可重建索引数据。

## 4. 已确认决策

- P2 采用“管理员产品可观测性高级版”。
- P2 使用路由拆分型方案，不采用单页 tab 扩展型方案。
- `/admin` 作为 admin shell 入口，默认导向 `/admin/overview`。
- 审计事件写入 `auth.db`，因为它属于安全/权限事实数据，必须随 auth 数据备份保留。
- 会话、工作区、异常、搜索统计主要读取 P1 的 `session-index.db`，但 P2 必须新增 admin 专用查询方法；P1 `listSessions`、`searchSessions`、`listWorkspaces` 都是单用户视角，不能覆盖 P2。
- 普通 `admin` 不能观察 `super_admin` 的私有文件、会话和用户详情；`super_admin` 可以观察全部。
- `POST /api/admin/index/rescan` 仅 `super_admin` 可执行；普通 `admin` 只能读取索引健康。
- 普通 `admin` 的跨用户 SQL 过滤使用 auth 层预先计算的可见 owner 集合，不使用跨库 JOIN；`owner_username IS NULL` 的无主会话只允许 `super_admin` 在索引健康页查看。

## 5. 信息架构与 URL

P2 管理后台使用独立路由，URL 可刷新、收藏和分享给有权限的管理员。

```text
/admin
/admin/overview
/admin/users
/admin/users/[username]
/admin/sessions
/admin/workspaces
/admin/index
/admin/audit
```

预期访问示例：

```text
http://10.16.49.16:8145/admin/overview
http://10.16.49.16:8145/admin/users
http://10.16.49.16:8145/admin/users/hsops
http://10.16.49.16:8145/admin/sessions
http://10.16.49.16:8145/admin/workspaces
http://10.16.49.16:8145/admin/index
http://10.16.49.16:8145/admin/audit
```

页面结构：

- `AdminLayout`：管理后台壳层，负责导航、当前用户角色显示、返回工作台入口、移动端适配。
- `Overview`：系统整体产品观测概况。
- `Users`：用户列表和用户管理入口。
- `User Detail`：单用户观测详情。
- `Sessions`：跨用户会话浏览。
- `Workspaces`：跨用户工作区浏览。
- `Index Health`：索引健康与异常。
- `Audit`：管理员审计记录。

`/admin` 本身不承载复杂页面状态，应重定向或客户端导向 `/admin/overview`。

## 6. 权限模型

继续沿用现有角色：

```text
user
admin
super_admin
```

权限规则：

- `user`：不能访问 `/admin` 和 `/api/admin/*`。
- `admin`：可以访问 admin shell、overview、普通用户详情、跨用户会话/工作区浏览、索引健康只读、审计列表中自己有权限看到的事件。
- `admin`：不能观察 `super_admin` 的文件、会话和用户详情。
- `admin`：不能管理 admin 或 super_admin，不能触发索引 rescan。
- `super_admin`：可以访问全部 admin 观测页面，可以触发索引 rescan，可以管理 `user` 与 `admin`，但不能破坏性操作自己或 super_admin 角色。

后端 API 必须集中使用 `requireAdmin`、`requireSuperAdmin`、`guardAdminViewTarget`、`canManage`、`canChangeRole` 等现有能力，前端隐藏按钮只作为体验优化。

### 跨库权限过滤机制

`auth.db` 和 `session-index.db` 是两个独立 SQLite 文件。P2 不采用 `ATTACH` 做跨库 JOIN，避免把 auth/schema 生命周期耦合到 session index 连接上。所有 admin 查询按以下顺序执行：

1. 从 `auth.db` 读取当前 actor、目标用户角色，以及 actor 可观察的 owner 用户名集合。
2. 将该集合作为参数传入 admin session-index 查询层。
3. session-index SQL 使用 `owner_username IN (...)` 或 `owner_username=@targetUsername` 下推过滤和分页。
4. 若 actor 是普通 `admin`，可见 owner 集合只包含 `role='user'` 的用户；不包含 `admin`、`super_admin` 和 `NULL` owner。
5. 若 actor 是 `super_admin`，默认可见所有非 NULL owner；索引健康页额外可以查看 `owner_username IS NULL` 的无主异常项。

`owner_username IS NULL` 表示索引期无法把 cwd 归属到任何用户根。此类会话不能出现在普通 admin 的 overview、sessions、workspaces 和用户详情中；只能在 super_admin 的 `/admin/index` 异常列表中显示为 `unowned`，用于排查索引或历史数据问题。

## 7. 数据来源与存储边界

### `auth.db`

负责：

- 用户、角色、禁用状态、创建时间。
- 登录 session。
- 新增管理员审计事件表。

### `session-index.db`

负责：

- 会话列表、会话 owner、cwd、标题、首条消息、message_count、modified_at。
- 工作区聚合、session_count、last_active_at。
- missing、orphaned、index_error、indexed_at、source_mtime_ms。
- FTS 搜索结果。

### Pi `.jsonl`

仍是会话内容事实来源。P2 不能为了跨用户浏览退回常态全量扫描；只有索引 rescan 或只读会话详情读取才访问 `.jsonl`。

## 8. 审计数据模型

审计事件写入 `auth.db`。新增表：

```sql
CREATE TABLE admin_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_username TEXT,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_audit_created_at ON admin_audit_events(created_at DESC);
CREATE INDEX idx_admin_audit_actor ON admin_audit_events(actor_username, created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit_events(target_username, created_at DESC);
CREATE INDEX idx_admin_audit_action ON admin_audit_events(action, created_at DESC);
```

字段语义：

- `actor_username`：执行动作的管理员。
- `actor_role`：动作发生时的角色。
- `action`：稳定动作名，例如 `user.disable`、`user.enable`、`user.role_update`、`user.delete`、`user.view_observability`、`index.rescan`。
- `target_username`：目标用户，若动作无目标用户则为 `NULL`。
- `target_type`：`user`、`session`、`workspace`、`index` 等。
- `target_id`：目标实体 id，例如 session id、cwd、用户名或 `session-index`。
- `status`：`success` 或 `failure`。
- `summary`：面向管理员的短摘要。
- `metadata_json`：结构化细节 JSON，必须只写必要信息，不写密钥、cookie、prompt 全文或文件内容。
- `created_at`：ISO 时间。

P2 必须记录这些事件：

- 禁用用户成功/失败：`user.disable`
- 启用用户成功/失败：`user.enable`
- 修改角色成功/失败：`user.role_update`
- 删除用户成功/失败：`user.delete`
- 查看用户观测详情成功：`user.view_observability`
- 触发索引 rescan 成功/失败：`index.rescan`

P2 不记录每一次文件读取、会话详情读取或普通列表刷新，否则 audit 会被噪音淹没。

`user.view_observability` 不是每次 GET 都记录。为避免刷新页面产生审计噪音，只在以下情况记录：

- actor 首次在一个 30 分钟窗口内查看某个 target 用户观测详情时记录一次 success。
- actor 对 target 的查看请求被 403/404 拒绝时记录一次 failure，便于排查越权或误点。
- 30 分钟窗口键为 `(actor_username, target_username, action)`，可通过查询最近一条 audit event 去重，不需要新增状态表。

普通列表刷新、文件读取、会话详情读取仍不记录 audit。

## 9. Admin 查询层

P2 必须新增 admin 专用查询层，例如 `lib/session-index/admin-store.ts` 或在 `store.ts` 中显式导出 admin 方法。该层读取 P1 的 `session-index.db`，但不能复用 P1 单用户方法假装完成跨用户查询。

P1 当前方法边界：

- `listSessions(query)` 强制 `WHERE s.owner_username=@username`。
- `searchSessions(query)` 强制 `WHERE s.owner_username=@username`。
- `listWorkspaces(username)` 只返回单个 owner 的工作区。

P2 新增方法必须覆盖以下能力：

- `getAdminOverview(visibility)`：返回用户、会话、工作区、异常、最近活跃用户、最近活跃工作区、最近异常会话聚合。
- `listAdminUsers(visibility, filters)`：把 auth 用户列表和 session-index owner 聚合合并，返回用户观测摘要。
- `getAdminUserObservability(visibility, targetUsername)`：返回目标用户详情观测；必须先由 auth guard 确认 target 可见。
- `listAdminSessions(visibility, filters)`：跨可见 owner 的会话分页列表，支持 owner、cwd、q、status、时间范围、sort。
- `searchAdminSessions(visibility, filters)`：跨可见 owner 的 FTS 搜索，支持分页 total。
- `listAdminWorkspaces(visibility, filters)`：跨可见 owner 的工作区分页列表，支持 owner、q、activeFrom、sort。
- `getAdminIndexHealth(visibility, options)`：返回索引健康、异常列表和 stale 候选统计。
- `rescanSessionIndexWithStats()`：强制扫描并返回统计；见 §10 索引健康。

所有 admin 查询方法都接收显式 `visibility` 参数，而不是在 session-index 层重新读取 auth：

```ts
interface AdminVisibility {
  actorUsername: string;
  actorRole: "admin" | "super_admin";
  visibleOwnerUsernames: string[];
  includeUnownedIndexIssues: boolean;
}
```

普通 admin 的 `visibleOwnerUsernames` 只包含普通 user。super_admin 包含所有已知用户。所有列表页默认排除 `owner_username IS NULL`；只有 `includeUnownedIndexIssues=true` 的 index health 异常列表可额外返回无主项。

Admin 查询层需要专门测试 SQL total、分页、可见 owner 过滤、super_admin 排除、NULL owner 排除/展示规则，不能只测 route handler。

## 10. 后端 API

### 总览

```text
GET /api/admin/overview
```

返回：

- 用户统计：total、enabled、disabled、user/admin/super_admin 数量。
- 会话统计：total、last24h、last7d、missing、orphaned、indexError。
- 工作区统计：total、activeLast7d。
- 最近活跃用户：username、role、lastActiveAt、sessionCount、workspaceCount。
- 最近活跃工作区：cwd、ownerUsername、sessionCount、lastActiveAt。
- 最近异常会话：id、ownerUsername、cwd、status、indexError、modifiedAt。

这些统计通过 admin 查询层聚合。普通 admin 的会话、工作区、异常统计只覆盖 `visibleOwnerUsernames` 中的普通用户；super_admin 覆盖所有已知 owner。无主会话不计入普通 overview；super_admin overview 可以在 Index Issues 中单独显示 `unownedIssueCount`。

### 用户列表

```text
GET /api/admin/users?q=&role=&disabled=&sort=&page=&pageSize=
```

增强现有用户列表，返回每个用户的观测摘要：

- username、role、disabled、created_at。
- lastActiveAt。
- sessionCount、workspaceCount。
- missingCount、orphanedCount、indexErrorCount。

普通 admin 的列表不得暴露 super_admin 的可观测详情入口。

### 用户详情观测

```text
GET /api/admin/users/[username]/observability
```

返回：

- 用户基础信息。
- 活跃统计：lastActiveAt、sessionsLast24h、sessionsLast7d。
- 会话摘要：recent sessions、favorite/archived/tag 统计按目标用户个人元数据统计。
- 工作区摘要：recent workspaces、pinned workspaces。
- 异常会话：missing、orphaned、index_error。
- 只读入口所需信息：文件根是否可读、会话详情可读状态。

权限：必须调用 `guardAdminViewTarget`。普通 admin 请求 super_admin 返回 403。

### 跨用户会话浏览

```text
GET /api/admin/sessions?username=&cwd=&q=&status=&from=&to=&page=&pageSize=&sort=
```

支持：

- username 精确过滤。
- cwd 精确或前缀过滤。
- q 搜索 title、first_message、cwd；全文搜索可通过 `mode=fts` 使用 FTS。
- status：`normal`、`missing`、`orphaned`、`index_error`。
- 时间范围：modified_at from/to。
- 分页和 total。

普通 admin 不返回 super_admin owner 的会话。

status 语义必须明确：

- `normal`：`missing=0 AND orphaned=0 AND index_error IS NULL`。
- `missing`：`missing=1`。
- `orphaned`：`orphaned=1`，不要求 `index_error` 非空。
- `index_error`：`index_error IS NOT NULL`，它不是独立 schema flag，而是错误字段过滤；可能与 `orphaned=1` 重叠。

### 跨用户工作区浏览

```text
GET /api/admin/workspaces?username=&q=&activeFrom=&page=&pageSize=&sort=
```

支持：

- username 过滤。
- cwd/display_name 搜索。
- activeFrom 过滤。
- sort：last_active_desc、session_count_desc、cwd_asc。
- 返回 cwd、ownerUsername、displayName、sessionCount、lastActiveAt、index state summary。

### 索引健康

```text
GET /api/admin/index
POST /api/admin/index/rescan
```

`GET` 返回：

- databaseAvailable。
- totalSessions、totalWorkspaces、missing、orphaned、indexError。
- oldestIndexedAt、newestIndexedAt。
- staleCandidateCount：source 文件 mtime 比索引 mtime 新的候选数量，检测阶段只能 stat，不解析 jsonl。
- 异常列表：missing/orphaned/index_error session 的 id、path、cwd、ownerUsername、modifiedAt、indexedAt、indexError。

Index Health 的 `GET` 不得调用 `getSessionIndexStore()`，因为它会触发带 10 秒节流的 `syncSessionIndex()`，从而把 stale 候选消费掉或让指标抖动。它必须直接打开 session-index db，执行只读统计；`staleCandidateCount` 通过 `scanSessionFiles(getSessionsDir())` 做 readdir+stat，然后与 `sessions.path/source_mtime_ms` 比较得到，不解析 jsonl、不写库、不受 `SYNC_THROTTLE_MS` 影响。

普通 admin 的 Index Health 只显示其可见 owner 的统计和异常；super_admin 可以看到所有 owner，并额外看到 `owner_username IS NULL` 的无主异常项。

`POST /rescan`：

- 仅 `super_admin` 可调用。
- 调用新增的带统计扫描能力，不直接调用当前返回 `void` 的 `syncSessionIndex(..., true)`。
- 返回扫描统计：scanned、indexed、unchanged、markedMissing、errors。
- 写入 `admin_audit_events`。

P2 必须改造 P1 同步能力或新增并复用一个底层 scanner 函数，使强制 rescan 返回统计：

```ts
interface SessionIndexSyncStats {
  scanned: number;
  indexed: number;
  unchanged: number;
  markedMissing: number;
  errors: Array<{ path: string; error: string }>;
}
```

推荐方案是把当前 `syncSessionIndex()` 的核心循环提取为 `syncSessionIndexWithStats(db, { force, throttle })`，让原 `syncSessionIndex()` 继续保持现有调用语义并忽略返回值。这样 P1 runtime hook 行为保持兼容，P2 rescan 可以拿到统计。

### 审计列表

```text
GET /api/admin/audit?actor=&target=&action=&status=&from=&to=&page=&pageSize=
```

返回审计事件分页列表。普通 admin 只能看到：

- 自己发起的事件。
- 目标为普通 user 的事件。

super_admin 可看到全部。普通 admin 看到目标为 `admin` 或 `super_admin` 的事件时必须被过滤掉，即使事件由自己发起也不能泄露高权限目标的私有标识。

## 11. 前端体验

P2 管理界面应是安静、密集、可扫描的操作型后台，不做营销式布局。

### Admin Shell

- 左侧或顶部导航：Overview、Users、Sessions、Workspaces、Index Health、Audit。
- 当前页面高亮。
- 右上角显示当前管理员 username/role 与返回工作台入口。
- 移动端使用紧凑导航，不能遮挡主要内容。

### Overview

- 顶部统计条：Users、Sessions、Workspaces、Index Issues。
- 中部双列或响应式列表：Recent Active Users、Recent Active Workspaces。
- 底部异常列表：recent missing/orphaned/index_error。
- 所有卡片点击进入对应详情页或过滤后的列表页。

### Users

- 表格或高密度列表。
- 搜索用户名。
- role/status 筛选。
- 每行显示会话数、工作区数、最近活跃、异常数。
- 每行保留既有管理操作：禁用/启用、删除、改角色；按钮可用性必须和权限一致。

### User Detail

- 顶部用户摘要和管理操作。
- 标签页或分区：Summary、Sessions、Workspaces、Files、Chats、Issues。
- Files/Chats 可复用现有只读文件和会话查看能力。
- 403 状态必须明确显示“无权限查看该用户内容”，不能显示为空数据。

### Sessions

- 全局会话表。
- 筛选：username、cwd、status、time range、search。
- 每行显示 owner、title、cwd、messageCount、modifiedAt、status。
- 点击 session 打开只读详情或跳到用户详情中的会话区域。

### Workspaces

- 全局工作区表。
- 筛选：username、path search、activeFrom。
- 每行显示 owner、cwd/displayName、sessionCount、lastActiveAt、issue count。
- 点击 workspace 打开过滤后的 Sessions 页。

### Index Health

- 顶部健康摘要。
- 异常列表支持 status 过滤。
- `super_admin` 显示 Rescan 按钮；普通 admin 显示只读说明。
- Rescan 必须有 loading、success、failure 状态，失败错误要可见。

### Audit

- 高密度审计表。
- 筛选 actor、target、action、status、time range。
- metadata 默认折叠，只显示 summary。

## 12. 错误处理与状态

- 所有 admin API 返回 401 时，前端应跳回登录或工作台入口。
- 403 必须显示权限不足状态，不能当作空数据。
- 500 必须显示加载失败和可重试按钮。
- 列表 API 必须返回分页信息，避免前端猜测总数。
- 索引数据库不可用时，Overview 和 Index Health 仍应展示用户统计，并明确标记 index unavailable。
- Rescan 失败必须写 failure audit event，并在 UI 中显示错误摘要。

## 13. 测试与验收

### 后端测试

- 审计 store 单测：写入、分页、actor/target/action/status/time 过滤、metadata JSON。
- 管理权限单测：普通 user 不能访问 admin API；admin 不能查看 super_admin；super_admin 可查看全部。
- Admin session-index 查询层单测：跨 owner 聚合、visibleOwnerUsernames 过滤、NULL owner 默认排除、super_admin index health 可见无主异常。
- Overview 查询测试：用户统计、会话统计、工作区统计、异常统计准确。
- 用户观测测试：按目标用户返回 session/workspace/issue 统计；不存在用户 404；越权 403。
- 跨用户 sessions/workspaces 查询测试：分页 total 准确，普通 admin 不返回 super_admin 数据。
- Index Health 测试：missing/orphaned/index_error 统计和异常列表准确；GET 不触发 sync；staleCandidateCount 只 stat 不解析；rescan 仅 super_admin 可触发并返回统计。
- 管理行为审计集成测试：disable/enable/role_update/delete/rescan 成功和失败都记录；user.view_observability 在 30 分钟窗口内去重。

### 前端测试

- Admin shell smoke：导航存在，当前页面高亮，普通 user 无法进入。
- Overview smoke：统计和异常列表可渲染。
- Users smoke：搜索/筛选/管理按钮状态正确。
- User detail smoke：403、loading、error、ok 状态可区分。
- Sessions/Workspaces smoke：筛选控件存在，分页信息渲染。
- Index Health smoke：普通 admin 不显示 rescan 操作；super_admin 可触发并看到状态。
- Audit smoke：事件列表和筛选控件渲染。

### 手动验收

- 使用 P2 独立 user systemd dev service，在非 8000 端口进行管理员 UI 点击测试。
- 用 `super_admin` 登录：验证 overview、users、user detail、sessions、workspaces、index、audit。
- 用普通 `admin` 登录：确认不能查看 super_admin 用户详情，不能触发 rescan。
- 触发一次禁用/启用用户，确认 audit 记录出现。
- 触发一次 index rescan，确认 audit 记录出现且日志无异常。
- 查看服务日志：

```bash
journalctl --user -u <p2-dev-service>.service --since '10 minutes ago' --no-pager
```

### 最低验证命令

```bash
npm run lint
npm run typecheck
npm run test:auth
npm run test:ui
npm run test:release
```

最终合回 `feat/session-workspace-experience` 前，必须按 P2 plan 指定的 gate 完整验证。

## 14. 与 P1/P3 的关系

P1 已完成普通用户会话与工作区体验。P2 读取 P1 的索引和元数据作为管理员观测基础，但新增 admin 跨用户查询层和 rescan 统计能力，不改变 P1 普通用户主流程。

P3 将处理模型和工具使用体验，包括 provider/model 默认值、工具 preset、会话模板和上下文状态等。P2 不应提前实现这些能力，但 P2 的审计和 admin shell 应允许未来 P3 增加独立入口。

## 15. 开发分支与服务要求

P2 implementation 必须从 `feat/session-workspace-experience` fork 子分支，例如：

```bash
feat/session-workspace-admin-observability
```

P2 开发必须使用独立 linked worktree、独立 HOME、独立 user systemd service 和非 8000 端口。建议端口使用 8145，避免和 P1 当前 8144 dev service 冲突。

示例命名：

```text
pi-web-auth-8145-admin-observability-dev.service
HOME=/home/hsops/.pi-admin-observability-dev-home
```

如果实际端口或 HOME 不同，必须在 P2 plan 和最终验收记录中写清楚。
