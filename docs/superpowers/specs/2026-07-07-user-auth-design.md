# pi-web-auth 用户认证与目录隔离 设计文档

日期：2026-07-07
项目：pi-web-auth（基于 pi-web 二次开发，独立部署于 8033 端口）

## 1. 背景与目标

现有 pi-web 运行在 8000 端口，宿主机 systemd 用户服务直跑，无任何认证，
任何访问者可读取所有会话工作目录下的文件。本项目在其副本基础上增加：

1. 用户注册 + 登录验证界面（用户名仅英文，规则见下）。
2. 登录用户只能使用自己的目录（目录名 = 用户名）。
3. 登录用户可删除自己目录下的文件。

新服务独立运行在 8033 端口，与 8000 的 pi-web 并列。

## 2. 已确认决策

| 项 | 决策 |
|---|---|
| 用户来源 | 前端注册，用户名 + 密码 |
| 用户名规则 | `^[a-zA-Z][a-zA-Z0-9]*$`（首字符字母，允许字母和数字，禁止中文/特殊字符/下划线/连字符） |
| 密码最小长度 | 8 位（注册页密码框侧边显示"至少 8 位"说明） |
| 存储 | SQLite（`better-sqlite3`），文件 `~/.pi-web-auth/auth.db` |
| 密码哈希 | Node 内置 `crypto.scryptSync` + `timingSafeEqual`，不引 bcrypt |
| 会话保持 | HttpOnly Cookie + 服务端 session 表 |
| 注册后行为 | 不自动登录，跳登录页，需再次输入用户名密码 |
| 目录根 | `~/pi-users/<用户名>` |
| 隔离级别 | 完全隔离（会话列表、文件浏览、删除均限本人目录） |
| 旧历史会话 | 隐藏（cwd 不在用户目录下的不返回，磁盘文件不删） |
| 未登录拦截 | 全局拦截，页面跳登录页，API 返 401 |
| middleware 方案 | A：middleware 只检查 cookie 是否存在做初步拦截，token 有效性校验放各 API（Node runtime，可读 SQLite） |
| 删除交互 | FileExplorer 文件树内删除按钮（hover 显示）+ 确认弹窗 |
| 端口 | 8033 |
| 部署 | 宿主机直跑（systemd 用户服务），与现有 pi-web 一致；SQLite 为嵌入式，非独立服务，不容器化 |

## 3. 架构总览

在现有 pi-web 之外增加一层认证，分四块：

1. **数据层**：`better-sqlite3`，两张表 `users`、`sessions`，DB 文件 `~/.pi-web-auth/auth.db`。
2. **认证 API**：`/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`。
3. **中间件**：`middleware.ts` 全局拦截，未登录页面跳 `/login`，API 返 401。
4. **隔离改造**：会话/文件 API 从"读所有会话目录"改为"只读 `~/pi-users/<用户名>`"；新增删除 API。

数据流：浏览器 → middleware 验 cookie 存在性 → API 用 session 取用户名 →
用户名算出 `~/pi-users/<用户名>` 作为唯一允许根 → 执行操作。

## 4. 数据层

DB 文件：`~/.pi-web-auth/auth.db`（目录不存在则创建）。

### users 表
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,   -- 格式: <salt_hex>:<hash_hex>
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

## 5. 认证 API

统一位于 `app/api/auth/*`，均为 Node runtime。

### POST /api/auth/register  `{username, password}`
1. 校验用户名 `^[a-zA-Z][a-zA-Z0-9]*$`，不符返 400。
2. 校验密码长度 ≥ 8，不符返 400。
3. 用户名已存在返 409。
4. `scrypt(password, salt)` 生成哈希，`password_hash = salt:hash` 入库。
5. `mkdir -p ~/pi-users/<username>`。
6. 返回成功（不下发 cookie，不自动登录）。

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
`getSessionUser(request): string | null`：读 `pi_auth` cookie → 查 sessions →
未过期返 username，过期则删行返 null。密码校验用 `crypto.scryptSync` + `timingSafeEqual`。

## 6. 目录隔离与删除

核心：所有文件/会话 API 的"允许根"改为唯一固定值 `~/pi-users/<当前登录用户名>`，
用户名来自 session，前端无法伪造。

### /api/sessions（GET）
过滤 `listAllSessions()`，只保留 cwd 落在 `~/pi-users/<username>` 下的会话。

### /api/files/[...path]（GET，read/list/download/watch）
`getAllowedRoots()` 改为返回单一根 `{ ~/pi-users/<username> }`。
`isPathAllowed` 逻辑复用，只是根变了。用户名从 `getSessionUser` 取。

### DELETE /api/files/[...path]（新增）
1. 取 session 用户名，无则 401。
2. 目标路径必须在 `~/pi-users/<username>` 内（复用 `isPathAllowed`），否则 403。
3. 拒绝删除用户根目录本身（只能删目录下的内容）。
4. 文件 `fs.rmSync(path)`；目录 `fs.rmSync(path, {recursive:true})`。
5. 返回成功/失败 JSON。

### 新建会话 / agent 的 cwd 约束
`/api/agent/new`、`/api/sessions/new` 收到的 cwd 必须在用户目录内，否则 400。

### /api/default-cwd（POST）
改为返回/创建 `~/pi-users/<username>` 作为该用户默认工作目录（替换原 `~/pi-cwd-<日期>`）。

## 7. 前端

### 登录/注册页 `app/login/page.tsx`（新增）
- 单页，登录 / 注册切换。
- 表单：用户名、密码 + 提交。密码框侧边说明"至少 8 位"。
- 前端即时校验用户名格式，实时提示"只能英文字母开头，允许字母和数字"。
- 注册成功 → 提示"注册成功，请登录" → 切登录。
- 登录成功 → 跳 `/`。
- 错误信息展示（用户名已存在、用户名或密码错误等）。
- 复用现有 Tailwind 样式。

### FileExplorer 删除按钮
- 每个文件/目录项 hover 显示删除按钮。
- 点击弹确认框（"确定删除 X？不可恢复"）。
- 确认后调 `DELETE /api/files/...`，成功刷新文件树。

### 顶部显示当前用户名 + 登出入口
调 `/api/auth/me` 获取用户名，提供登出按钮调 `/api/auth/logout` 后跳 `/login`。

## 8. 中间件（方案 A）

`middleware.ts`（项目根新增）：
- `matcher` 匹配除静态资源外所有路径。
- 放行清单：`/login`、`/api/auth/login`、`/api/auth/register`、`_next/*`、favicon。
- 其余路径检查 `pi_auth` cookie 是否**存在**：
  - 页面请求无 cookie → `redirect('/login')`。
  - API 请求无 cookie → `401 JSON`。
- middleware 只做 cookie 存在性初筛（Edge runtime 无法读 SQLite）。
  token 真正有效性由各 API 的 `getSessionUser` 校验（Node runtime）。

## 9. 端口与部署

- `package.json`：`dev` / `start` 的 `-p 8000` → `-p 8033`。
- 部署前查端口占用，确认 8033 空闲。
- systemd 用户服务直跑（参照现有 pi-web），`~/.pi-web-auth/auth.db` 落宿主机。
- 新增依赖：`better-sqlite3`（唯一新增）。密码哈希用 Node 内置 `crypto`。

## 10. 安全要点

- 密码 scrypt 加盐哈希，绝不明文。
- 登录失败不区分"用户不存在"与"密码错误"，防用户名枚举。
- Cookie HttpOnly + SameSite=Lax，防 XSS 窃取与基础 CSRF。
- 所有文件操作路径必须经 `isPathAllowed` 校验，防目录穿越逃逸。
- 删除操作二次确认，拒绝删除用户根目录本身。
- 用户名严格正则校验，避免路径注入（用户名即目录名）。

## 11. 测试计划

- 用户名正则单测：合法（abc、user1）/ 非法（1abc、中文、a_b、a-b、空）。
- 密码长度校验：< 8 拒绝。
- 注册重复用户名 → 409。
- 登录错误密码 → 401，正确 → 下发 cookie。
- session 过期后 `getSessionUser` 返 null 并清行。
- 隔离：用户 A 无法列出 / 读取 / 删除用户 B 目录下文件（403）。
- 删除：A 可删自己目录下文件；删根目录本身被拒。
- 未登录访问页面跳 `/login`，访问 API 返 401。
