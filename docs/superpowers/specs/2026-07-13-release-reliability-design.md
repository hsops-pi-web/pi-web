# 生产发布可靠性与质量门禁设计

日期：2026-07-13
分支：`feat/release-reliability`
生产源码：`/home/hsops/pi-web-auth`，`main`，端口 8000
设计 worktree：`/home/hsops/pi-web-auth-release-reliability`

## 1. 背景

当前生产服务直接从 `/home/hsops/pi-web-auth` 运行 `next start -p 8000`，源码、
构建产物和生产运行目录耦合。发布必须停止服务后在生产工作树覆盖 `.next`，构建失败时
需要手工恢复旧产物，停机时间也包含完整构建时间。

2026-07-13 发布用户模型偏好功能时还观察到：

- `pi-web-auth.service` 收到 SIGTERM 后未在 `TimeoutStopSec=20` 内退出，最终被 systemd
  发送 SIGKILL。
- `lib/rpc-manager.ts` 的信号处理只调用 wrapper `destroy()`，没有等待活跃回复、触发
  扩展 `session_shutdown` 或释放 AgentSession/MCP transport。
- `tsc --noEmit` 有 27 个测试配置错误，导致生产源码只能通过过滤错误来验收。
- 两组 Jest/Testing Library 测试没有进入当前 `npm test`，质量门禁不完整。
- 每次发布备份旧 `.next` 接近 1GB；程序回滚和用户数据备份没有分离。

本设计只处理第一阶段：发布可靠性与质量门禁。凭据迁移、模型治理、管理员审计日志和
数据库版本迁移分别进入后续独立 spec，不在本阶段顺带实现。现有 npm audit 报告的
14 个依赖项风险也记录到凭据与依赖安全阶段，不执行破坏性的 `npm audit fix --force`。

## 2. 目标与非目标

### 目标

- 生产改为运行不可变 Next.js standalone release，不再直接运行源码工作树的 `.next`。
- 所有构建、测试和 staging 验证在停止生产前完成。
- 发布使用原子软链接切换，启动失败自动回滚上一版本。
- 活跃回复获得最多 30 秒完成时间，之后主动 abort，并完整释放扩展和子进程。
- drain、停止旧服务、最终增量备份和备份校验共享 60 秒硬预算。
- 生产数据先在线预复制，停机后只做增量收尾，避免完整复制占用停机窗口。
- 保留当前版本和最近 3 个历史版本，总计最多 4 个可运行 release。
- 仅保留最近 7 份验证成功的生产数据备份。
- `npm run verify` 无过滤地通过生产代码、测试代码、lint 和全部自动测试。
- 发布和回滚过程有锁、结构化日志、release 清单和可执行运维文档。

### 非目标

- 不引入 Nginx/Caddy，不实现双实例蓝绿流量切换。
- 不修改用户模型偏好、管理员界面或聊天交互。
- 不迁移 API Key，不自动轮换密钥。
- 不自动发布远程 Git push；生产发布仍是管理员显式运行的本机命令。
- 不在代码回滚时自动恢复用户数据。数据恢复必须通过独立命令和人工确认。

## 3. 已确认决策

- 使用 Next.js `output: "standalone"`。
- 发布目录使用不可变 release 和 `current`/`previous` 软链接。
- 活跃回复等待 30 秒，之后主动中止。
- 停机阶段硬上限 60 秒。
- 新版本启动健康检查窗口独立为 30 秒，失败自动回滚。
- `/api/health/ready` 连续 3 次成功才提交发布结果。
- 停机前完成在线快照和大文件预复制；停机内只做最终增量同步与校验。
- 保留 3 个历史 release 和 7 份已验证数据备份。
- 引入 Vitest + jsdom，保留 node:test，两组都进入统一门禁。
- 首次迁移连续成功发布两次前，保留原 systemd unit 和原 `.next` 回滚路径。

## 4. 目录与不可变产物

固定目录结构：

```text
/home/hsops/pi-web-auth/                  # main 源码工作树，不直接运行生产
/home/hsops/pi-web-auth-deploy/
  current -> releases/<release-id>
  previous -> releases/<release-id>
  releases/
    20260713-160000-05816e7/
      server.js
      package.json
      public/
      .next/static/
      .pi/extensions/
      scripts/systemd-stop.sh
      release.json
  staging/
  logs/
  release.lock
/home/hsops/pi-web-auth-backups/
  <backup-id>/
  .incomplete-<backup-id>/
```

`release-id` 使用 `YYYYMMDD-HHMMSS-<short-sha>`，由构建脚本一次生成并贯穿目录、日志、
健康检查和备份清单。release 发布后不可修改；修复必须生成新 release。

`release.json` 至少包含：

```json
{
  "releaseId": "20260713-160000-05816e7",
  "commit": "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86",
  "builtAt": "2026-07-13T08:00:00.000Z",
  "nodeVersion": "v22.20.0",
  "appVersion": "0.6.12",
  "piVersion": "0.75.5"
}
```

系统只清理带有效 `release.json` 且不被 `current`、`previous` 引用的旧 release。当前版本
加 3 个历史版本，总计最多 4 个。staging 和失败目录保留供诊断，不进入自动清理集合。

## 5. 构建与 staging 验证

构建阶段不接触生产服务：

1. 发布入口确认源码工作树位于 `main`、无未提交改动，并获取目标完整 commit SHA。
2. 获取发布锁；已有发布持锁时立即失败。
3. 从目标 commit 创建临时 detached worktree。
4. 在临时 worktree 执行 `npm ci`，不得复用可变的生产 `node_modules`。
5. 执行 `npm run verify`。
6. 执行 standalone build。
7. 将 `.next/standalone`、`.next/static`、`public`、`.pi/extensions` 和 stop helper 组装到
   staging release。
8. 在隔离 HOME 和非 8000 端口启动 staging release。
9. 验证登录页、健康 API、SQLite 初始化、模型注册表、AgentSession 创建和项目动态扩展
   加载。测试会话不得调用真实模型，也不得写生产 HOME。
10. staging 验证成功后用同一文件系统内的 rename 将目录移动到 `releases/<release-id>`。

standalone tracing 必须覆盖 server external packages 和动态加载的 `.pi/extensions`。
验收不能只检查 `server.js` 能启动；必须实际创建隔离 AgentSession，证明
`@earendil-works/pi-coding-agent`、better-sqlite3、TypeBox、MCP SDK 和扩展依赖均存在。

## 6. 进程生命周期

新增进程级生命周期模块，状态为：

```text
running -> draining -> shutting_down
    ^          |
    |----------|  resume，仅在未停止进程且发布取消时允许
```

模块职责：

- `running` 时允许创建会话和发送聊天命令。
- `draining` 时新的 `/api/agent/new` 和 `/api/agent/[id]` POST 返回 503，并设置
  `Retry-After`。
- drain 幂等；重复请求返回同一个进行中结果，不重复 abort 或 dispose。
- 检查所有 wrapper 的 streaming 状态，等待活跃回复自然结束最多 30 秒。
- 超时后对仍活跃的 AgentSession 调用 `abort()`。
- 对每个扩展 runner 发出一次 `session_shutdown`，reason 为 `quit`。
- shutdown handler 完成后调用 AgentSession `dispose()`，再销毁 wrapper 和 registry 项。
- 单个扩展关闭失败必须被记录，但不能阻止其他会话释放；最终 drain 结果标记失败。
- shutdown 完成后健康 ready 返回 503，直到进程退出或显式 resume。

内部接口：

- `POST /api/internal/drain`：开始 drain 并返回会话数、abort 数、错误和耗时。
- `POST /api/internal/resume`：仅在 release 尚未切换且旧进程仍运行时恢复 `running`。
- 两个接口都要求 release token，不接受 cookie 角色替代。

token 存放在 `/home/hsops/.config/pi-web-auth/release.env`，文件权限必须为 0600。
比较使用恒定时间函数。响应和日志不得返回 token、cookie 或 provider credential。

## 7. 60 秒停机预算

停机前阶段不计入 60 秒：

- detached worktree 构建与 `npm run verify`
- staging standalone 验证
- SQLite 在线一致性快照
- `~/.pi/agent`、`~/pi-users` 和认证数据目录的大文件预复制

发布脚本调用 drain 时开始单调时钟计时。以下步骤共享 60 秒：

1. 拒绝新聊天命令。
2. 等待活跃回复，最多 30 秒。
3. abort 未完成回复并释放 AgentSession/MCP transport。
4. 停止旧 systemd 服务。
5. 对预复制目录执行最终增量同步。
6. 重新生成停止状态下的最终 SQLite 备份。
7. 执行数据库完整性、目录存在性和文件计数校验。

任一步预计会超过剩余预算时立即失败，不开始后续步骤。60 秒内失败时不得修改 `current`
或 `previous`；如果旧进程仍在则调用 resume，如果已经停止则重新启动旧服务。恢复旧服务的
时间记录在失败日志中，但不伪装成成功发布。

正常无活跃回复且增量较小时，预期实际中断为 2 至 5 秒；30 秒是活跃回复宽限，不是每次
发布固定等待。失败场景最坏可见中断还会叠加旧版本恢复时间。

## 8. 数据备份

每个发布创建独立 `.incomplete-<backup-id>`：

- SQLite 使用 better-sqlite3 backup API 创建在线一致性快照，不直接复制打开中的主文件。
- 大目录先用 rsync 预复制。
- 服务停止后执行最终 rsync，并重新创建最终 SQLite 快照。
- 校验通过后写 `backup.json`，再原子重命名为 `<backup-id>`。

`backup.json` 包含 release ID、commit、开始/完成时间、数据库 integrity_check、用户数、
登录会话数、模型偏好数、Pi jsonl 文件数和各数据目录路径。它不包含用户名、token、
消息内容或 API Key。

只有具备有效 `backup.json` 且数据库完整性为 ok 的目录算成功备份。自动保留最近 7 份
成功备份；`.incomplete-*` 和失败现场不自动删除。清理在新 release 健康检查通过后运行，
不得在发布前释放空间。如果磁盘空间不足以完成新备份，发布在 drain 前失败。

数据恢复不与代码自动回滚绑定。`restore-production-backup.sh` 要求服务已停止、目标备份
校验通过，并要求操作者输入完整 backup ID 二次确认。默认提供 `--dry-run`。

## 9. 原子切换和自动回滚

备份完成且仍在 60 秒预算内后：

1. 读取并验证当前 `current` 目标。
2. 创建临时软链接指向新 release。
3. 将旧 `current` 原子更新为 `previous`。
4. 将临时软链接原子 rename 为 `current`。
5. 启动 `pi-web-auth.service`。

新版本有独立 30 秒启动窗口。`/api/health/ready` 每秒检查一次，连续 3 次 200 才成功。
任一次失败会重置连续成功计数。

ready 检查包括：

- 生命周期为 `running`
- SQLite `SELECT 1` 成功
- `~/.pi-web-auth`、`~/pi-users`、`~/.pi/agent` 可访问
- 运行时 release ID 和完整 commit 与目标 `release.json` 一致

30 秒内未满足条件时停止新版本，把 `current` 切回 `previous`，启动旧版本并再次执行
健康检查。只有旧版本 ready 后才报告“已自动回滚”；旧版本也失败时报告严重故障，保留
所有 release、备份和日志，不执行清理。

## 10. 健康 API

- `GET /api/health/live`：进程事件循环可以响应即返回 200。
- `GET /api/health/ready`：执行上述 ready 检查；draining、shutting_down 或依赖失败返回
  503。

健康 API 不需要登录，便于 systemd 和本机脚本调用，但只返回状态、release ID、commit
和不含敏感信息的检查名称。不得返回路径中的用户名、数据库行、模型凭据或错误堆栈。

## 11. systemd

仓库维护 `systemd/pi-web-auth.service` 模板，生产安装到用户 unit 目录。最终核心配置为：

```ini
[Service]
Type=simple
WorkingDirectory=/home/hsops/pi-web-auth-deploy/current
EnvironmentFile=/home/hsops/.config/pi-web-auth/release.env
Environment=NODE_ENV=production
Environment=HOME=/home/hsops
Environment=PORT=8000
Environment=HOSTNAME=0.0.0.0
Environment=PATH=/home/hsops/.nvm/versions/node/v22.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/home/hsops/.nvm/versions/node/v22.20.0/bin/node /home/hsops/pi-web-auth-deploy/current/server.js
ExecStop=/home/hsops/pi-web-auth-deploy/current/scripts/systemd-stop.sh
Restart=on-failure
RestartSec=3
TimeoutStopSec=65
```

release 脚本在调用 systemctl stop 前主动完成 drain。ExecStop 是管理员直接停止服务时的
兜底，并复用相同的幂等 drain API。65 秒是 systemd 的最终保护，不扩展应用定义的
60 秒发布预算。

`release.env` 至少保存 `PI_WEB_RELEASE_TOKEN` 和现有 `REGISTER_KEYWORD`，权限为 0600。
后续凭据安全阶段可以迁移更多运行时 secret，但本阶段不得遗漏现有生产环境变量。

## 12. 首次迁移

首次迁移没有 standalone `previous`，必须额外保护：

1. 备份当前用户 unit、源码 commit 和旧 `.next`。
2. 构建并 staging 验证第一个 standalone release。
3. 生成新 unit，但保留可一键恢复的原 unit 文件。
4. 完成 drain、备份和停止后安装新 unit并指向第一个 `current`。
5. 第一次启动失败时恢复原 unit 和旧 `.next`，从源码目录启动旧方式。
6. 连续两次 standalone 发布和回滚演练成功前，不允许删除首次迁移备份。

首次迁移是单独验收步骤，不与普通后续发布路径混为一个不可测试分支。

## 13. 质量门禁

package scripts 统一为：

```json
{
  "test:auth": "node --experimental-strip-types --test \"__tests__/lib/auth/**/*.test.ts\"",
  "test:release": "node --experimental-strip-types --test \"__tests__/release/**/*.test.ts\"",
  "test:ui": "vitest run --config vitest.config.ts",
  "test": "npm run test:auth && npm run test:release && npm run test:ui",
  "typecheck:app": "tsc --noEmit -p tsconfig.json",
  "typecheck:tests": "tsc --noEmit -p tsconfig.tests.json",
  "typecheck": "npm run typecheck:app && npm run typecheck:tests",
  "verify": "npm run typecheck && npm run lint && npm test"
}
```

- `tsconfig.json` 排除测试目录，只检查生产源码。
- `tsconfig.tests.json` 扩展生产配置，启用测试 `.ts` 导入扩展、Node 和 Vitest 类型。
- 现有 Jest/Testing Library 测试迁移到 Vitest + jsdom，不删除覆盖。
- `vitest.config.ts` 只收集 `__tests__/hooks/**/*.test.ts` 和
  `__tests__/lib/recent-cwds-storage.test.ts`，不得重复执行 `__tests__/lib/auth` 下的 node:test。
- auth 和纯 Node 测试继续使用 node:test。
- 发布脚本只接受干净 `main` 上的 commit，且必须通过 `npm run verify`。
- GitHub Actions 在提交和 PR 上执行 `npm ci && npm run verify`。

## 14. 自动测试

生命周期单元和集成测试覆盖：

- draining 后拒绝新聊天命令并返回 503/Retry-After。
- 活跃会话在宽限期内自然结束时不 abort。
- 超过 30 秒后 abort。
- `session_shutdown` 和 dispose 每个会话只执行一次。
- 单个扩展关闭失败不跳过其他会话，最终结果标记失败。
- 重复 drain、SIGTERM 或 ExecStop 不重复清理。
- resume 只在未切换且旧进程仍运行时成功。
- ready 在 running 时为 200，在 draining 或依赖失败时为 503。

发布脚本集成测试在临时目录中使用假的 systemctl、curl、rsync 和时钟，覆盖：

- verify 或 build 失败不停止生产。
- staging 验证失败不创建 release。
- 磁盘不足或预备份失败不进入 drain。
- 60 秒预算耗尽时不切换并恢复旧服务。
- 最终备份失败不切换。
- 新版本健康检查失败自动切回 previous。
- 成功发布后正确更新 current/previous。
- 只清理未被引用的旧 release，并保留当前加 3 个历史版本。
- 只清理超过 7 份的成功备份，不删除 incomplete 目录。
- 并发发布被锁拒绝。
- 首次迁移失败恢复原 unit 和旧 `.next`。

standalone staging 验收覆盖：

- server.js 在隔离 HOME 和非 8000 端口启动。
- 健康 API、注册、登录和权限边界可用。
- ModelRegistry 能读取隔离模型配置。
- 创建不调用真实模型的 AgentSession 时，项目扩展和依赖加载成功。
- 停止 staging 后没有遗留 MCP/Node 子进程。

## 15. 文件边界

新增文件：

```text
lib/process-lifecycle.ts
lib/release-auth.ts
app/api/internal/drain/route.ts
app/api/internal/resume/route.ts
app/api/health/live/route.ts
app/api/health/ready/route.ts
scripts/lib/release-common.sh
scripts/build-release.sh
scripts/release-production.sh
scripts/backup-production.mjs
scripts/restore-production-backup.sh
scripts/systemd-stop.sh
systemd/pi-web-auth.service
vitest.config.ts
tsconfig.tests.json
.github/workflows/verify.yml
__tests__/lib/auth/process-lifecycle.test.ts
__tests__/release/release-scripts.test.ts
docs/operations/production-release.md
docs/operations/production-rollback.md
```

修改文件：

```text
lib/rpc-manager.ts
app/api/agent/new/route.ts
app/api/agent/[id]/route.ts
next.config.ts
package.json
package-lock.json
tsconfig.json
__tests__/hooks/useRecentCwds.test.ts
__tests__/lib/recent-cwds-storage.test.ts
AGENTS.md
```

`process-lifecycle.ts` 只负责进程状态和会话关闭编排；shell 脚本不复制其业务逻辑。
`release-common.sh` 只提供目录、日志、锁、时钟和软链接原语；发布状态机保留在
`release-production.sh`。备份的数据语义和 SQLite API 放在 Node 脚本中，避免 shell
直接操作数据库格式。

## 16. 日志与可观测性

每次发布生成 `logs/<release-id>.log`，每一行带时间、release ID、阶段、耗时和结果。
至少记录：

- precheck、verify、build、staging verify
- pre-backup、drain、stop、finalize backup
- symlink switch、start、health check、rollback、retention
- 活跃会话数、自然结束数、abort 数和 shutdown 错误数

日志对 token、cookie、API Key 和请求正文做禁止输出约束。脚本默认 `umask 077`。失败时日志
明确写出当前软链接目标、服务状态和建议恢复命令，但不自动删除诊断现场。

## 17. 验收标准

实施完成必须满足：

1. `npm ci && npm run verify` 无错误通过，不再过滤 tsc 输出。
2. isolated staging standalone 能加载 Pi AgentSession 和 `.pi/extensions`。
3. 使用模拟活跃会话验证 30 秒宽限和 abort 路径。
4. drain、停止、最终增量备份和校验在测试数据下不超过 60 秒。
5. 新版本健康检查失败能自动恢复 previous。
6. 首次迁移失败能恢复原 unit 和旧 `.next`。
7. 发布前后用户数、登录会话数、模型偏好数和 Pi jsonl 数一致。
8. 生产 `/api/health/ready` 连续 3 次 200，8000 登录、管理员和普通用户权限烟测通过。
9. 直接 `systemctl --user stop pi-web-auth.service` 在 65 秒内正常退出，不出现 SIGKILL。
10. release 和 backup 保留策略在真实目录验证无误。

## 18. 后续阶段

本阶段完成并稳定运行后，按以下独立 spec 继续：

1. 凭据安全：API Key 迁移、0600 权限、systemd credentials 和轮换。
2. 模型治理：用户偏好查看/重置、失效回退提示、模型身份和健康状态。
3. 审计与数据治理：管理员审计日志、schema migrations 和恢复演练。
