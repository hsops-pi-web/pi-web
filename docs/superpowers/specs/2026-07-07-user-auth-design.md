# pi-web-auth 用户认证与目录隔离 设计文档

日期：2026-07-07
项目：pi-web-auth（基于 pi-web 二次开发，独立部署于 8033 端口）

## 1. 背景与目标

现有 pi-web 运行在 8000 端口，宿主机 systemd 用户服务直跑，无任何认证，
任何访问者可读取所有会话工作目录下的文件。本项目在其副本基础上增加：

1. 用户注册 + 登录验证界面（注册需前置关键词，用户名规则见下）。
2. 登录用户只能使用自己的目录（目录名 = 用户名）。
3. 登录用户可删除自己目录下的文件。

新服务独立运行在 8033 端口，与 8000 的 pi-web 并列，8000 服务不改动。

## 2. 已确认决策

| 项 | 决策 |
|---|---|
| 用户来源 | 前端自助注册，但注册前需输入正确关键词 |
| 注册关键词 | `tsingmao`，存服务端环境变量 `REGISTER_KEYWORD`，不进前端源码；输入错误不显示注册表单 |
| 用户名规则 | `^[a-zA-Z][a-zA-Z0-9]*$`（首字符字母，允许字母和数字，禁止中文/特殊字符/下划线/连字符）；**区分大小写**（Alice 与 alice 为不同用户/目录） |
| 密码最小长度 | 8 位（注册页密码框侧边显示"至少 8 位"说明） |
| 存储 | SQLite（`better-sqlite3`），文件 `~/.pi-web-auth/auth.db` |
| 密码哈希 | Node 内置 `crypto.scryptSync` + `timingSafeEqual`，不引 bcrypt |
| 会话保持 | HttpOnly Cookie + 服务端 session 表 |
| 注册后行为 | 不自动登录，跳登录页，需再次输入用户名密码 |
| 目录根 | 宿主机绝对路径 `~/pi-users/<用户名>`（即 `/home/hsops/pi-users/<用户名>`），非项目目录、非现有 cwd 结构 |
| 新用户目录初始化 | 仅建空目录 |
| 隔离级别 | 完全隔离（会话列表、会话详情、agent、文件浏览、删除均限本人目录） |
| Agent 工具层隔离 | 本次先做 Web UI 层隔离；Agent 工具层能否限制文件根，本次并行调研 pi-coding-agent，结果出来再单独决定 |
| 旧历史会话 | 隐藏（cwd 不在用户目录下的不返回，磁盘文件不删） |
| 未登录拦截 | 全局拦截，页面跳登录页，API 返 401 |
| middleware 方案 | A：middleware 只检查 cookie 是否存在做初步拦截；token 有效性由各 API 校验（Node runtime，可读 SQLite） |
| 删除交互 | FileExplorer 文件树内删除按钮（hover 显示）+ 确认弹窗 |
| 删除范围 | 允许递归删子目录、允许删隐藏文件；删"使用中"文件需额外提醒并二次确认 |
| symlink 处理 | 删除/读取前 `fs.realpathSync` 解析真实路径再校验，防逃逸 |
| 端口 | 8033 |
| 部署 | 宿主机直跑（systemd 用户服务），与现有 pi-web 一致；SQLite 为嵌入式，非独立服务，不容器化 |

## 3. 架构总览

在现有 pi-web 之外增加一层认证，分四块：

1. **数据层**：`better-sqlite3`，两张表 `users`、`sessions`，DB 文件 `~/.pi-web-auth/auth.db`。
2. **认证 API**：`/api/auth/register-gate`、`/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`。
3. **中间件**：`middleware.ts` 全局拦截，未登录页面跳 `/login`，API 返 401。
4. **隔离改造**：会话/文件/agent API 从"读所有会话目录"改为"只限 `~/pi-users/<用户名>`"；新增删除 API。

数据流：浏览器 → middleware 验 cookie 存在性 → API 用 session 取用户名 →
用户名算出 `~/pi-users/<用户名>` 作为唯一允许根 → 执行操作并校验路径归属。

## 4. 数据层

DB 文件：`~/.pi-web-auth/auth.db`（目录不存在则创建）。

### users 表
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,   -- 区分大小写存储
  password_hash TEXT NOT NULL,     -- 格式: <salt_hex>:<hash_hex>
  created_at TEXT NOT NULL
);
```

### sessions 表
```sql
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL    -- epoch 毫秒
);
```

DB 初始化封装在 `lib/auth/db.ts`，进程内单例（挂 globalThis 防热重载重复打开）。
用户名 UNIQUE 约束默认区分大小写（SQLite TEXT 二进制比较），符合决策。

## 5. 认证 API

统一位于 `app/api/auth/*`，均为 Node runtime。

### POST /api/auth/register-gate  `{keyword}`
1. 比对 `keyword` 与环境变量 `REGISTER_KEYWORD`（默认 `tsingmao`）。
2. 匹配返回 `{ok:true}`，前端据此显示注册表单；不匹配返 403，不显示表单。
3. 关键词只在服务端比对，不下发到前端源码。

### POST /api/auth/register  `{keyword, username, password}`
1. 再次校验 `keyword`（防绕过 gate 直接打接口），不符返 403。
2. 校验用户名 `^[a-zA-Z][a-zA-Z0-9]*$`，不符返 400。
3. 校验密码长度 ≥ 8，不符返 400。
4. 用户名已存在返 409（区分大小写比对）。
5. `scrypt(password, salt)` 生成哈希，`password_hash = salt:hash` 入库。
6. `mkdir -p ~/pi-users/<username>`（空目录）。
7. 返回成功（不下发 cookie，不自动登录）。

### POST /api/auth/login  `{username, password}`
1. 查用户，不存在或密码不匹配 → 统一返 401「用户名或密码错误」（防枚举）。
2. 生成 token `crypto.randomBytes(32).toString("hex")`。
3. 写 sessions 表：token、username、expires_at（默认 7 天）。
4. `Set-Cookie: pi_auth=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
   （生产 HTTPS 环境加 `Secure`）。

### POST /api/auth/logout
删 sessions 表当前 token 行，清 cookie。

### GET /api/auth/me
读 cookie → 查 session → 返回 `{username}` 或 401。前端用于判断登录态、显示用户名。

### 共用工具 `lib/auth/session.ts`
- `getSessionUser(request): string | null`：读 `pi_auth` cookie → 查 sessions →
  未过期返 username，过期则删行返 null。
- `getUserRoot(username): string`：返回 `~/pi-users/<username>` 绝对路径。
- 密码校验用 `crypto.scryptSync` + `timingSafeEqual`。

## 6. 目录隔离与删除

核心：所有文件/会话/agent API 的"允许根"改为唯一固定值 `~/pi-users/<当前登录用户名>`，
用户名来自 session，前端无法伪造。所有路径校验前先 `fs.realpathSync` 解析 symlink。

### 会话列表 /api/sessions（GET）
先取 session 用户名（无则 401），过滤 `listAllSessions()`，
只保留 cwd 落在 `~/pi-users/<username>` 下的会话。

### 会话详情 /api/sessions/[id]（GET）与 /api/sessions/[id]/context（GET）
1. 取 session 用户名，无则 401。
2. 读该 pi session 的 cwd（header），校验在 `~/pi-users/<username>` 下。
3. 不属于当前用户 → **404**（不用 403，不泄露 id 是否存在）。

### Agent /api/agent/[id]（POST/相关）与 /api/agent/[id]/events（SSE）
1. 取 session 用户名，无则 401。
2. 校验目标 session 的 cwd 属于当前用户，否则 **404**。
3. 防止用户用已知 id 向别人 session 发消息或订阅 SSE。

### 文件 API /api/files/[...path]（GET，read/list/download/watch）
`getAllowedRoots()` 改为返回单一根 `{ ~/pi-users/<username> }`。
路径先 `realpathSync` 解析，再过 `isPathAllowed`。用户名从 `getSessionUser` 取。

### 删除 DELETE /api/files/[...path]（新增）
1. 取 session 用户名，无则 401。
2. 目标路径 `realpathSync` 解析后必须在 `~/pi-users/<username>` 内，否则 403。
3. 拒绝删除用户根目录本身（只能删目录下的内容）。
4. "使用中"检测：若目标文件/目录属于某个运行中 session 的 cwd 或其子路径，
   返回一个需确认标志（如 `{needConfirm:true, reason:"in_use"}`），前端二次确认后带
   `?force=1` 再次请求方执行。
5. 执行：文件 `fs.rmSync(path)`；目录 `fs.rmSync(path, {recursive:true})`（允许递归、
   允许隐藏文件）。
6. 返回成功/失败 JSON，失败带可读 reason。

### 新建会话 / agent 的 cwd 约束
`/api/agent/new`、`/api/sessions/new` 收到的 cwd `realpathSync` 后必须在用户目录内，
否则 400。

### /api/default-cwd（POST）
改为返回/创建 `~/pi-users/<username>` 作为该用户默认工作目录（替换原 `~/pi-cwd-<日期>`）。

## 7. 前端

### 登录/注册页 `app/login/page.tsx`（新增）
- 单页，登录 / 注册切换。
- 登录 tab：用户名、密码 + 提交。
- 注册 tab：**先显示"注册关键词"输入框**，提交到 `/api/auth/register-gate`；
  校验通过才展开用户名 + 密码表单，未通过不显示表单并提示关键词错误。
- 密码框侧边说明"至少 8 位"。
- 前端即时校验用户名格式，实时提示"字母开头，仅允许字母和数字"。
- 注册成功 → 提示"注册成功，请登录" → 切登录 tab。
- 登录成功 → 跳 `/`。
- 错误信息展示（关键词错误、用户名已存在、用户名或密码错误等）。
- 复用现有 Tailwind 样式。

### FileExplorer 删除按钮
- 每个文件/目录项 hover 显示删除按钮。
- 点击弹确认框（"确定删除 X？不可恢复"）。
- 若后端返回 `needConfirm`（使用中），弹二次确认框（"该文件正被会话使用，仍要删除？"），
  确认后带 `force` 重发。
- 成功刷新文件树；失败展示后端 reason。

### 顶部显示当前用户名 + 登出入口
调 `/api/auth/me` 获取用户名，提供登出按钮调 `/api/auth/logout` 后跳 `/login`。

### 全局 401 处理
封装统一 fetch 包装：任意 API 返 401（含 cookie 存在但 session 过期场景）时，
清本地状态并 `location.href = "/login"`，避免空白页或报错。

## 8. 中间件（方案 A）

`middleware.ts`（项目根新增）：
- `matcher` 匹配除静态资源外所有路径，覆盖 `/models-config`、文件 tab、
  历史 session、SSE 等全部应用路由。
- 放行清单：`/login`、`/api/auth/register-gate`、`/api/auth/register`、
  `/api/auth/login`、`_next/*`、favicon。
- 其余路径检查 `pi_auth` cookie 是否**存在**：
  - 页面请求无 cookie → `redirect('/login')`。
  - API 请求无 cookie → `401 JSON`。
- middleware 只做 cookie 存在性初筛（Edge runtime 无法读 SQLite）。
  token 真正有效性由各 API 的 `getSessionUser` 校验（Node runtime）。
- cookie 存在但 session 过期：middleware 放行 → API 返 401 → 前端全局 401 处理跳登录。

## 9. 端口与部署

- `package.json`：`dev` / `start` 的 `-p 8000` → `-p 8033`。
- 部署前查端口占用，确认 8033 空闲。
- 原 8000 的 pi-web 服务不改动、继续运行。
- 新建独立 systemd 用户服务（如 `pi-web-auth.service`），`WorkingDirectory` 指向
  本项目，`ExecStart` 用 `next start`（-p 8033 由 package.json 决定，或在 service 里
  显式指定），并设置 `Environment=REGISTER_KEYWORD=tsingmao`（或从 env 文件读）。
- `~/.pi-web-auth/auth.db` 落宿主机。
- 新增依赖：`better-sqlite3`（唯一新增）。密码哈希用 Node 内置 `crypto`。

## 10. Agent 工具层隔离（调研项）

本次实现只保证 Web UI 层隔离。需并行调研 pi-coding-agent（`@earendil-works/pi-coding-agent`）
是否支持：
- 限制工具文件访问根到指定目录；
- 禁用或限制 shell 工具；
- 沙箱化执行。

调研结论写入本文档补充，再决定是否单独立项做 Agent 层隔离。
在此之前，明确风险：懂技术的用户可通过自己 session 内的 Agent shell/文件工具读取
用户目录外的路径。部署到不完全可信环境前需评估此风险。

## 11. 安全要点

- 密码 scrypt 加盐哈希，绝不明文。
- 注册前置关键词存服务端环境变量，不泄露前端；register 接口二次校验防绕过。
- 登录失败不区分"用户不存在"与"密码错误"，防用户名枚举。
- Cookie HttpOnly + SameSite=Lax，防 XSS 窃取与基础 CSRF。
- 所有文件/会话/agent 操作路径必须 `realpathSync` 解析后经 `isPathAllowed` 校验，
  防目录穿越与 symlink 逃逸。
- session/agent 详情接口按 cwd 归属校验，越权返 404，不泄露 id 存在性。
- 删除操作二次确认，使用中文件额外确认，拒绝删除用户根目录本身。
- 用户名严格正则校验，避免路径注入（用户名即目录名）。
- 已知局限：Agent 工具层未隔离（见第 10 节）。

## 12. 测试计划

认证与规则：
- 用户名正则单测：合法（abc、user1）/ 非法（1abc、中文、a_b、a-b、空）。
- 密码长度校验：< 8 拒绝。
- 注册关键词错误 → 403，不返回注册能力；正确 → 放行。
- register 接口不带/错误关键词直接调用 → 403。
- 注册重复用户名 → 409；大小写不同视为不同用户（Alice 与 alice 均可注册）。
- 登录错误密码 → 401，正确 → 下发 cookie。
- session 过期后 `getSessionUser` 返 null 并清行。

隔离与越权：
- 用户 A 无法列出 / 读取 / 删除用户 B 目录下文件（403）。
- A 直接请求 B 的 session id → 404。
- A 直接请求 B 的 session context → 404。
- A 不能通过 `/api/agent/[id]` 向 B 的 session 发消息 → 404。
- A 不能通过 SSE `/api/agent/[id]/events` 订阅 B 的 session → 404。
- symlink 指向用户目录外时不能读取或删除目标。
- 未登录访问页面跳 `/login`，访问 API 返 401。
- cookie 过期后页面自动跳登录（全局 401 处理）。

删除：
- A 可删自己目录下文件与子目录（递归、含隐藏文件）。
- 删根目录本身被拒。
- 删使用中文件返回 needConfirm，force 后可删。
