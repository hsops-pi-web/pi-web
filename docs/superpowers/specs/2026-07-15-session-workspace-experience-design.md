# 会话与工作区高级体验设计

日期：2026-07-15
阶段：P1 会话与工作区体验完整高级版
生产源码：`/home/hsops/pi-web-auth`，`main`，端口 8000
开发策略：新建独立 feature branch/worktree，使用隔离 HOME 和非 8000 端口验收

## 1. 背景

当前会话体验主要围绕 `.jsonl` 文件即时读取实现：`/api/sessions` 通过
`lib/session-reader.ts` 调用 `SessionManager.listAll()` 获取会话，再由前端
`SessionSidebar.tsx` 组织工作区、父子会话树和最近 cwd。这个模型简单可靠，但随着会话、
工作区和用户数量增长，会暴露几个产品问题：

- 历史会话主要靠时间和工作区路径查找，缺少搜索、收藏、标签和归档能力。
- 最近工作区是浏览器 localStorage 状态，跨浏览器和跨设备不可恢复。
- 会话列表每次依赖文件扫描和前端组装，难以支持分页、复杂过滤和全文搜索。
- 收藏、标签、归档等用户个人组织信息没有正式存储模型。
- 后续 P2 管理员可观测性需要会话、工作区、活动和搜索索引作为基础，不能只做临时 UI 增强。

本设计聚焦 P1：把会话与工作区体验做成完整产品能力。P2 管理员可观测性、P3 模型和工具
使用体验不在本轮实现，但本轮的数据边界要为它们铺平道路。

后续 P2/P3 开发和最终合回 `main` 期间，必须先阅读 `docs/superpowers/session-workspace-integration-flow.md`，并按其中的临时集成分支流程执行。

## 2. 目标与非目标

### 目标

- 引入 pi-web-auth 本地自管 SQLite 会话索引库，不引入外部数据库服务。
- 会话列表、搜索、过滤、分页和工作区聚合主要从 SQLite 查询。
- `.jsonl` 仍是会话内容、分支、模型变化和工具调用的原始事实来源。
- SQLite 保存查询索引和用户个人会话元数据：收藏、标签、归档、工作区 pin、最近访问。
- 收藏、标签、归档、工作区 pin 等元数据全部按用户个人保存，不同用户互不影响。
- 支持会话标题、首条消息、cwd、标签、时间和全文内容搜索。
- 支持收藏、标签管理、归档、工作区分组、工作区 pin、最近工作区服务端化和批量操作。
- 所有 API 查询和写入继续执行现有用户权限边界，普通用户不能读取或操作不可访问 cwd 的会话。
- 索引层支持初次构建、局部刷新、mtime 检测、orphaned 会话标记和缺失文件处理。
- 前端拆分 `SessionSidebar` 的职责，避免继续把搜索、工作区、标签和批量操作堆进单个组件。

### 非目标

- 不实现 P2 管理员可观测性页面，但保留可被后续 P2 读取的索引和活动字段。
- 不实现 P3 模型、工具 preset、会话模板或上下文状态体验。
- 不改变 Pi `.jsonl` 文件格式，不把收藏、标签或归档写回 session 文件。
- 不引入 Postgres、MySQL、Elasticsearch 或外部搜索服务。
- 不在开发阶段触碰生产 8000，不在开发 worktree 运行 `next build`。
- 不做跨用户共享标签体系；本轮标签是用户个人标签。

## 3. 已确认决策

- 本轮开发目标是 P1 完整高级版，不是只做 MVP。
- 采用完整 SQLite 索引数据库方案，为后续 P2 管理员可观测性打基础。
- 数据库是 pi-web-auth 本地自管 SQLite，不依赖外部数据库服务。
- 新增独立 session/workspace SQLite 数据库文件，避免把高频索引和全文搜索表耦合到 auth 核心库。
- 用户个人元数据按用户保存：收藏、标签、归档、工作区 pin、最近工作区互不污染。
- `.jsonl` 是原始会话事实来源；SQLite 是查询索引和用户个人会话元数据事实来源。
- SQLite 中索引表可重建；用户个人元数据表必须纳入备份策略，不能被当作可丢弃缓存。
- 权限分页采用索引期归属收敛：索引器用文件系统 realpath/canonicalize 规则计算
  `owner_username`，查询期信任该字段并用 `WHERE owner_username=?` 下推过滤、分页和 total。
- 不采用“SQL 分页后再逐条 realpath 过滤”的方案；该方案会导致每页数量不足且 total 不准确。

## 4. 数据存储边界

新增独立 SQLite 文件，位于 pi-web-auth 已管理的数据目录下：

```text
/home/hsops/.pi-web-auth/session-index.db
```

实现应先从 `lib/auth/db.ts` 提取共享数据目录常量或 helper，让 auth 数据库和 session index
共用同一个数据根，避免硬编码多个数据目录。该文件必须满足：

- 随生产数据备份一起纳入备份清单。
- 权限与 auth 数据同级保护，不对其他用户开放读写。
- 允许索引表重建，但不得丢失用户个人元数据。

数据职责分层：

```text
Pi session jsonl
  原始会话内容、entryId、parentId、model_change、toolCall、compaction、fork 元数据

session-index SQLite: index tables
  会话列表查询、消息全文索引、工作区聚合、mtime、orphaned/missing 状态

session-index SQLite: user metadata tables
  用户个人收藏、标签、归档、工作区 pin、最近打开记录、自定义显示名

auth SQLite
  用户、角色、登录会话、模型偏好等认证和权限核心数据
```

如果索引字段与 `.jsonl` 冲突，会话内容字段以 `.jsonl` 为准并触发重索引。用户个人元数据以
SQLite 为准，不从 `.jsonl` 恢复。

## 5. 数据模型

### `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  cwd TEXT NOT NULL,
  owner_username TEXT,
  title TEXT,
  first_message TEXT,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  parent_session_id TEXT,
  parent_session_path TEXT,
  orphaned INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  source_mtime_ms INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT,
  index_error TEXT
);
```

`owner_username` 是查询期权限过滤、分页和 total 的依据。它必须在索引期通过文件系统规则计算，
不能由客户端或 session header 声称。计算规则：对每个已知用户根执行 `resolveSessionOwnership(cwd,
username)` 或等价 canonicalize 判断，命中的唯一用户写入 `owner_username`；cwd 为空、无法归属、
归属不唯一或不在任何 `pi-users/<username>` 下时写入 `NULL`，普通用户查询默认不可见。

这个决策把 symlink 和路径逃逸风险收敛到索引期：索引期做真实路径归属判断，查询期用 SQL
`WHERE owner_username=?` 下推过滤、排序、分页和 total。若 cwd 的真实归属后来变化，mtime/周期扫描
必须重新计算 owner 并更新索引。

### `session_messages`

```sql
CREATE TABLE session_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  entry_id TEXT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

消息文本只保存用于搜索和 snippet 的纯文本摘要。工具结果、文件内容或超长消息需要截断到
受控长度，避免索引库无限膨胀。原文仍从 `.jsonl` 读取。

### `workspaces`

```sql
CREATE TABLE workspaces (
  cwd TEXT PRIMARY KEY,
  owner_username TEXT,
  display_name TEXT,
  session_count INTEGER NOT NULL DEFAULT 0,
  last_active_at TEXT,
  indexed_at TEXT
);
```

工作区由 session cwd 聚合生成。`cwd` 是稳定主键，不能使用自增 id 作为用户元数据外键；索引
重建可能重插 workspaces 行，自增 id 会导致 workspace pin 错位。`display_name` 是系统级建议名，
用户个人重命名放在 `user_workspace_metadata`。

### `user_session_metadata`

```sql
CREATE TABLE user_session_metadata (
  username TEXT NOT NULL,
  session_id TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  custom_title TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (username, session_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

收藏、归档和自定义标题是个人视角。同一个会话在不同用户下可以有不同状态。

### `tags` 和 `session_tags`

```sql
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (username, name)
);

CREATE TABLE session_tags (
  username TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (username, session_id, tag_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

标签是用户个人标签。管理员后续可做汇总统计，但不共享或覆盖普通用户标签。

### `user_workspace_metadata`

```sql
CREATE TABLE user_workspace_metadata (
  username TEXT NOT NULL,
  cwd TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  display_name TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (username, cwd),
  FOREIGN KEY (cwd) REFERENCES workspaces(cwd) ON DELETE CASCADE
);
```

工作区 pin、最近打开和个人显示名按用户保存，用于替代浏览器 localStorage recent cwd。

### `index_state`

```sql
CREATE TABLE index_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

记录 schema version、最近全量扫描时间、是否正在重建、最近错误和 FTS 可用状态。

### 全文搜索

优先使用 SQLite FTS5：

```sql
CREATE VIRTUAL TABLE session_messages_fts USING fts5(
  text,
  session_id UNINDEXED,
  entry_id UNINDEXED,
  role UNINDEXED,
  content='session_messages',
  content_rowid='id'
);
```

如果运行环境的 SQLite 不支持 FTS5，功能仍应启动，但全文搜索 API 返回降级状态或使用受限的
`LIKE` 查询。正式验收目标是 FTS5 可用。

FTS5 external content 表不会自动随 `session_messages` 同步。实现必须二选一并固定：要么创建
insert/update/delete trigger 维护 `session_messages_fts`，要么在索引器事务中手动维护 FTS 影子行，
删除时使用 FTS5 `delete` 命令语义。重索引测试必须覆盖主表和 FTS 一致性。

## 6. 索引同步

新增会话索引服务模块，建议放在 `lib/session-index/` 下，提供清晰边界：

- `db.ts`：打开 SQLite、迁移 schema、事务封装。
- `scanner.ts`：扫描 session 文件、只 stat 检测 mtime、发现新增/缺失文件。
- `indexer.ts`：解析单个 `.jsonl`，写入 `sessions`、`session_messages` 和 FTS。
- `queries.ts`：会话列表、搜索、工作区、标签查询。
- `metadata.ts`：收藏、标签、归档、工作区 pin、最近访问写入。
- `permissions.ts`：索引期计算 `owner_username`，并在元数据写入前校验目标 session/workspace
  属于当前用户。

同步规则：

1. 应用启动后不阻塞页面启动，但首次 `/api/sessions` 需要确保数据库 schema 已迁移。
2. 若数据库为空或 `index_state` 表示从未扫描，触发后台初次索引。
3. mtime 检测阶段只能 `readdir` 和 `stat`，不得调用 `SessionManager.listAll()` 或解析所有 `.jsonl`。
   只有新增、mtime 变化或先前索引失败的文件进入解析和重索引。
4. 索引器不能复用 `SessionManager.listAll()` 作为文件发现来源，因为 listAll 会跳过 malformed
   session，导致 orphaned 文件永远不可见。scanner 必须自己枚举 session 目录并逐文件解析。
5. 索引每个 session 时计算 `owner_username`：从 cwd 反推落在哪个 `pi-users/<username>` 下，复用
   `resolveSessionOwnership()` 或等价 canonicalize 逻辑；无法归属时写入 `NULL`。
6. 索引有效 session 后必须 upsert 对应 workspace：按 `cwd` 写入 `workspaces`，并根据同一
   `owner_username` 和 `cwd` 下非 missing、非 orphaned session 重新计算 `session_count` 与
   `last_active_at`。
7. `parent_session_id` 不能硬编码为 `NULL`。header 中 `parentSession` 是父 session 文件 path，
   索引器必须保存 `parent_session_path`，再通过 `sessions.path -> sessions.id` 映射回填
   `parent_session_id`。单文件索引可先写当前行，再尝试查父 path；批量扫描结束后必须执行一次
   parent 回填，保证已存在父文件的 fork 树可恢复。
8. 新会话创建、rename、fork、delete、context navigation 后，触发目标 session 或相关 session 的局部重索引。
9. 单个 `.jsonl` 解析失败时，把 `orphaned=1` 和 `index_error` 写入 `sessions`，不阻塞其他会话。
10. 文件消失时标记 `missing=1`，并从默认列表隐藏，保留用户个人元数据，避免临时文件系统问题造成收藏、标签或归档丢失。
11. 只有用户通过 Web API 明确删除会话，且服务端确认 `.jsonl` 删除成功后，才允许删除该 session 的索引记录和关联用户元数据。
12. 全量重建只重建索引派生字段、workspaces 聚合和 FTS，不清空用户个人元数据表。
13. `lib/auth/delete-user.ts` 必须集成 session index：删除用户时，在物理删除该用户 jsonl 后同步删除
    对应 `sessions` 索引行，并清理该 username 的 `user_session_metadata`、`tags`、`session_tags`、
    `user_workspace_metadata`。该清理与现有 auth 用户删除事务失败处理保持一致。

并发要求：

- 索引写入使用事务。
- 同一进程内使用锁避免同一个 session 并发重索引。
- 多请求同时触发扫描时共享同一个进行中的扫描 promise。
- 读查询不能长时间等待全量索引完成；返回结果中包含 `indexStatus`。

## 7. API 设计

### `GET /api/sessions`

从 SQLite 返回当前用户可访问的会话列表。权限过滤在 SQL 层下推为 `owner_username=<current user>`，
因此 page/pageSize 和 total 必须精确。支持：

```text
q=<keyword>
cwd=<absolute-path>
tag=<tag-name-or-id>
favorite=true|false
archived=include|only|exclude
orphaned=include|only|exclude
sort=modified_desc|modified_asc|created_desc|title_asc
page=<number>
pageSize=<number>
```

响应包含：

- `sessions`：带用户个人 metadata 的会话列表。
- `tree` 或足够前端构建树的 `parentSessionId` 字段。
- `indexStatus`：`ready`、`building`、`stale`、`error`。
- `pagination`：总数、当前页、pageSize。

默认行为：隐藏 archived 和 missing，会展示 orphaned 的不可点击状态。

### `GET /api/sessions/search`

用于全文搜索。参数：

```text
q=<keyword>
cwd=<optional>
tag=<optional>
page=<number>
pageSize=<number>
```

返回 session 命中和 message 命中：

```json
{
  "results": [
    {
      "sessionId": "...",
      "entryId": "...",
      "cwd": "...",
      "title": "...",
      "snippet": "...",
      "role": "user",
      "modified": "..."
    }
  ],
  "indexStatus": "ready"
}
```

所有结果必须先经过当前用户权限过滤。

### `PATCH /api/sessions/[id]`

保留现有 rename 能力，并扩展用户个人元数据：

```json
{
  "name": "optional session title",
  "favorite": true,
  "archived": false,
  "customTitle": "optional personal title"
}
```

`name` 继续按现有 session_info 语义写入 `.jsonl`。`favorite`、`archived` 和 `customTitle`
写入当前用户的 `user_session_metadata`。

双写失败语义必须明确：如果请求同时包含 `name` 和 SQLite 元数据，服务端先写 SQLite 元数据，再写
`.jsonl` session_info。SQLite 写失败时返回 500 且不写 `.jsonl`。`.jsonl` 写失败时返回 500，并在
响应中返回 `partialFailure: "metadata_saved_name_failed"`；此时元数据已经保存，客户端刷新后可看到
收藏/归档变化，但名称不会改变。实现不得谎报全成功。

### `POST /api/sessions/bulk`

批量操作当前用户可访问的会话：

```json
{
  "sessionIds": ["..."],
  "operation": "archive|unarchive|favorite|unfavorite|add_tag|remove_tag",
  "tagId": 1
}
```

服务端必须逐个验证权限。部分失败时返回成功项和失败项，不允许静默跳过。

### `GET /api/workspaces`

返回当前用户可访问工作区：

- cwd
- displayName
- sessionCount
- lastActiveAt
- pinned
- lastOpenedAt

排序规则：pinned 优先，其次最近打开，再其次最近活跃。

### `PATCH /api/workspaces/[cwd]`

更新当前用户的工作区元数据。`cwd` 使用 URL 编码的绝对路径，服务端按当前用户和 workspace cwd
校验归属：

```json
{
  "pinned": true,
  "displayName": "optional personal name"
}
```

### `GET /api/tags`、`POST /api/tags`、`PATCH /api/tags/[id]`、`DELETE /api/tags/[id]`

管理当前用户个人标签。删除标签只删除当前用户的标签关系，不影响其他用户。

## 8. 前端体验

`SessionSidebar.tsx` 需要拆分为多个更小的组件，建议结构：

```text
components/session-sidebar/
  WorkspaceSwitcher.tsx
  SessionSearchBox.tsx
  SessionFilterBar.tsx
  SessionTree.tsx
  SessionRow.tsx
  BulkSessionToolbar.tsx
  TagPicker.tsx
  ArchiveViewToggle.tsx
```

交互规则：

- 默认展示当前工作区的会话树，按 modified desc 排序。
- 顶部搜索框支持标题、首条消息、cwd 和全文搜索入口。
- 搜索中展示结果列表，不强行套入父子树。退出搜索后恢复工作区树。
- 收藏可以在会话行内切换；收藏会话可通过过滤器或分组快速查看。
- 标签通过 popover 或 modal 管理，支持新增、选择、移除。
- 归档后的会话默认隐藏；归档过滤器允许查看和恢复。
- 多选模式显示批量工具条，支持批量归档、收藏/取消收藏、打标签、移除标签。
- 工作区切换器展示 pinned、recent 和全部可访问工作区，不再只依赖 localStorage。
- orphaned 会话展示不完整状态，不允许打开；missing 会话默认不展示。
- active streaming 状态继续从现有 AgentSession 状态获取，并叠加到会话行展示。

UI 必须适配桌面和移动宽度。会话行、标签、工具条和搜索结果不得造成横向溢出。

## 9. 权限与安全

- 所有 API 必须先要求登录。
- 会话查询必须按索引期计算出的 `owner_username` 在 SQL 层过滤，保证分页和 total 准确。
- 索引期 owner 计算必须复用现有 realpath/canonicalize 归属语义，防止 symlink cwd 混入其他用户根。
- 对 `owner_username IS NULL` 的会话，普通用户默认不可见；后续管理员可观测性若需要展示，必须走独立管理员只读规则。
- 收藏、标签、归档和工作区 pin 写入前必须验证目标 session/workspace 对当前用户可访问。
- 普通用户不能通过 session id 猜测读取其他用户会话元数据。
- 标签名需要长度限制和字符规范化，避免极端输入破坏 UI 或查询。
- 搜索 snippet 不返回不可访问会话内容，不返回凭据或系统文件内容。
- 日志不得记录完整消息内容、搜索关键词中的潜在敏感信息或 cookie。

## 10. 备份与恢复

独立 session/workspace SQLite 必须进入生产备份策略。

备份要求：

- `session-index.db` 随 auth 数据一起备份。
- 发布备份清单记录 session index integrity_check 结果。
- 用户元数据表是产品数据，不能在重建索引时删除。
- 搜索索引和派生字段可以通过 `.jsonl` 重建。

恢复要求：

- 恢复生产备份时同时恢复 session index 数据库，保证收藏、标签、归档和工作区 pin 回到同一时间点。
- 如果 session index 缺失或损坏，应用应能启动，并提示索引需要重建。
- 自动重建只能重建索引表和 FTS；不得伪造或清空用户元数据。

## 11. 测试与验收

### 自动测试

- SQLite schema 迁移幂等。
- 单个 `.jsonl` 索引写入 `sessions`、`session_messages` 和 FTS。
- 索引有效 session 后 upsert `workspaces`，并正确计算 `session_count` 与 `last_active_at`。
- parentSession path 能回填为 `parent_session_id`，父子会话树不退化成平铺列表。
- malformed header 标记 orphaned，不阻塞其他会话。
- scanner 不复用 `SessionManager.listAll()`，malformed `.jsonl` 能被发现并写入 orphaned 索引行。
- owner_username 从 cwd 和用户根反推，正常用户根内会话可见，无法归属会话普通用户不可见。
- SQL 层 `WHERE owner_username=?` 下的 page/pageSize 和 total 准确，不出现分页后应用层过滤导致的短页。
- mtime 变化触发局部重索引。
- mtime 检测只 stat 不解析未变化文件。
- FTS5 external content 与 `session_messages` 在新增、重索引和删除后保持一致。
- 缺失文件标记 missing，默认列表隐藏。
- 用户 A 和用户 B 对同一 session 的 favorite、archived、tags 互不影响。
- 标签 CRUD 和 session tag 关系按 username 隔离。
- 工作区 pin、last_opened_at 和个人 display_name 按 username 隔离。
- `/api/sessions` 的 cwd、tag、favorite、archived、sort、pagination 过滤正确。
- `/api/sessions/search` 只返回当前用户可访问结果，snippet 和 entryId 正确。
- 批量操作逐项鉴权，部分失败返回明确结果。
- 删除用户时 `lib/auth/delete-user.ts` 清理该用户个人标签、元数据和已删除 jsonl 对应的 session index，不能影响其他用户。
- 前端 sidebar smoke test 覆盖搜索、收藏、标签、归档、工作区 pin 和批量操作。

### 隔离验收

在新 feature worktree、隔离 HOME、非 8000 端口执行：

1. 创建管理员、用户 A、用户 B。
2. 为 A 和 B 准备多个 cwd、父子会话、orphaned session 和不同消息内容。
3. A 收藏、归档、打标签、pin 工作区；刷新浏览器后状态保持。
4. B 登录后看不到 A 的收藏、标签、归档和工作区 pin。
5. A 搜索标题、首条消息、cwd、标签和消息全文，结果可打开对应会话。
6. 搜索结果中的 message 命中包含 snippet 和 entryId；无法定位时仍能打开会话。
7. 批量归档、批量收藏、批量打标签成功，越权 session 返回失败项。
8. 修改 `.jsonl` 后索引自动刷新，新增消息可被搜索。
9. malformed `.jsonl` 显示 orphaned 状态，不破坏列表加载。
10. 移动或删除 session 文件后，默认列表不展示 missing，会话元数据不误删。
11. 移动端宽度下搜索框、标签、批量工具条和会话行无横向溢出。
12. 生产 `http://127.0.0.1:8000` 在开发和验收期间不受影响。

### 命令门禁

- `npm run typecheck`
- `npm run lint`
- 相关 session-index、API 和前端测试
- UI smoke test

开发期间不得在 feature worktree 运行 `next build`。

## 12. 实施边界

实施必须在独立 branch/worktree 中进行，例如：

```text
/home/hsops/pi-web-auth-session-workspace-experience
HOME=/home/hsops/.pi-session-workspace-dev-home
PORT=8144 或其他非 8000 端口
```

生产 `/home/hsops/pi-web-auth` 保持 clean `main`，当前 `pi-web-auth.service` 继续服务端口 8000。
功能完成、自动测试通过、非 8000 用户验收通过后，才进入合并、standalone build、staging 验证、
生产备份、明确批准和发布流程。

## 13. 后续 P2/P3 衔接

P2 管理员可观测性可以复用本轮数据：

- `sessions`、`workspaces` 提供会话数、工作区数、最近活跃时间。
- `session_messages` 提供消息数量和索引健康状态，不直接暴露消息内容。
- `index_state` 提供索引构建、错误和 stale 状态。
- 后续可新增只读 admin 查询，不需要重建会话索引体系。

P3 模型和工具体验仍应作为独立设计：

- 可在本轮工作区模型基础上保存 workspace-level model/tool preset。
- 可在 session 搜索和组织能力稳定后增加模板、工具摘要和上下文状态。
- 不在本轮混入模型和工具偏好，避免 P1 范围失控。
