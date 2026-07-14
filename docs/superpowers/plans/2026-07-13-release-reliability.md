# Production Release Reliability Implementation Plan

修订：2026-07-14（首次迁移一次性 legacy stop 例外已确认）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 pi-web-auth 生产发布改造成经过完整质量门禁和隔离 staging 验证的不可变 standalone release，并在 60 秒停机预算内完成 drain、最终备份和原子切换，启动失败时自动回滚。

**Architecture:** Next.js 以 `output: "standalone"` 构建到不可变 release，生产 systemd 只运行 `/home/hsops/pi-web-auth-deploy/current/server.js`。应用内进程生命周期协调器负责拒绝新写请求、等待/中止活跃回复并关闭扩展；发布脚本负责锁、在线预备份、60 秒预算、软链接切换、连续健康检查和程序回滚。认证 SQLite 通过 better-sqlite3 backup API 生成一致快照，大目录通过停机前预复制和停机内增量 rsync 缩短中断时间。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Node.js 22、better-sqlite3、node:test、Vitest + jsdom、Bash、rsync、systemd user service、GitHub Actions。

**Status:** Execution-ready after the confirmed one-time legacy stop exception below.

---

## 首次迁移一次性例外（已确认）

当前生产运行 commit `05816e7`。该 commit 不包含 `/api/internal/drain`、进程 lifecycle 或
extension `session_shutdown + dispose` 逻辑；这些能力只有本计划发布后才存在。已经运行的旧
Node 进程不能通过修改源码或安装新 unit 动态获得这些 handler。因此 Task 9 示例中的
`release_token_curl /api/internal/drain` 对当前首次迁移必然失败，这是设计文档第 12 节的
自举缺口，不是 shell 实现问题。

用户已于 2026-07-14 确认采用以下唯一可落地的规格修正：

- 首次从 legacy `.next` 切换到第一个 standalone release 使用一次性维护例外：操作者先确认
  当前没有活跃回复，脚本从 `systemctl stop` 前开始 60 秒计时，停止旧 unit 后完成最终备份、
  校验和 standalone 切换。旧进程可能沿用现有 20 秒 stop guard 并被 SIGKILL，日志必须如实
  标记 `legacy_stop`，不能声称执行了 30 秒 drain 或 extension shutdown。
- 第一个 standalone 启动后，所有普通发布和直接 systemctl stop 必须完整执行本计划定义的
  30 秒 drain、abort、`session_shutdown`、dispose 和 65 秒最终保护，不再允许该例外。
- 首次迁移的 legacy unit、旧 `.next` 自动回滚、60 秒停机预算、最终数据校验和 30 秒新版本
  ready 窗口保持不变。

不存在一个“不先停旧进程、又把新 lifecycle 注入旧进程”的安全方案。额外做一次 bootstrap
restart 只会把同一个无 drain 的首次停机提前一次，不能消除例外。Task 9 因此必须使用显式
`--allow-legacy-stop --confirm-no-active-replies <release-id>`，不得尝试调用旧进程不存在的
drain API；普通发布脚本不接受这些参数。

## 执行边界

- 实施工作树固定为 `/home/hsops/pi-web-auth-release-reliability`，分支固定为 `feat/release-reliability`，隔离 HOME 固定为 `/home/hsops/.pi-release-reliability-dev-home`。
- `/home/hsops/pi-web-auth` 保持在 `main` 并继续由 8000 端口生产服务使用；Task 1 至 Task 10 不停止、不重启、不修改该服务。
- 开发服务器只能使用非 8000 端口。本计划使用 8145；若被占用，先选择另一个空闲端口并在验收记录中写明。
- 不在开发 worktree 直接运行 `next build`。standalone 真构建只由发布脚本在临时 detached worktree 中执行，并且只在合并到干净 `main` 后、停止生产之前执行。
- 所有开发测试命令显式设置 `HOME=/home/hsops/.pi-release-reliability-dev-home`，避免访问生产 `~/.pi-web-auth`、`~/pi-users` 和 `~/.pi/agent`。
- Task 11 是独立生产迁移检查点。只有 Task 1 至 Task 10 完成、用户在非 8000 端口验收通过并再次明确批准生产切换后才能执行。
- 每个任务只提交本任务文件；不得把生产数据、release token、`.next`、staging HOME、备份目录或发布日志加入 Git。

## 文件结构

### 新建

- `lib/process-lifecycle.ts`：进程状态、session start barrier、30 秒 drain、幂等 shutdown、resume 和信号处理。
- `lib/release-auth.ts`：内部发布接口的 Bearer token 提取和恒定时间比较。
- `lib/release-metadata.ts`：读取并校验当前 release 的 `release.json`，供健康 API 使用。
- `app/api/internal/drain/route.ts`：token 保护的 drain 入口。
- `app/api/internal/resume/route.ts`：发布取消且旧进程仍运行时恢复接收请求。
- `app/api/health/live/route.ts`：无认证存活检查。
- `app/api/health/ready/route.ts`：生命周期、SQLite、数据根和 release 身份检查。
- `scripts/lib/release-common.sh`：发布目录、日志、flock、单调时钟、预算、软链接和健康轮询原语。
- `scripts/build-release.sh`：detached worktree 中执行 ci、verify、standalone build、组装和 staging 验证。
- `scripts/verify-standalone.mjs`：在隔离 HOME/端口启动 release，验证 HTTP、SQLite、ModelRegistry、AgentSession 和动态扩展。
- `scripts/backup-production.mjs`：prepare/finalize/validate/retention 四个备份命令。
- `scripts/release-production.sh`：普通 standalone 发布状态机。
- `scripts/restore-production-backup.sh`：显式确认后恢复一份已验证数据备份，默认 dry-run。
- `scripts/systemd-stop.sh`：systemd ExecStop 的幂等 drain 兜底。
- `scripts/migrate-first-release.sh`：首次从源码 `.next` unit 迁移到 standalone unit，并提供 legacy 自动回滚。
- `systemd/pi-web-auth.service`：standalone user unit 模板。
- `vitest.config.ts`：仅收集两组浏览器测试。
- `tsconfig.tests.json`：测试代码独立类型检查。
- `.github/workflows/verify.yml`：push/PR 统一质量门禁。
- `__tests__/lib/auth/process-lifecycle.test.ts`：生命周期、token 和 admission 单元测试。
- `__tests__/release/release-scripts.test.ts`：备份、切换、回滚、保留和首次迁移集成测试。
- `docs/operations/production-release.md`：构建、发布、首次迁移和验收 runbook。
- `docs/operations/production-rollback.md`：程序回滚与数据恢复 runbook。

### 修改

- `lib/pi-types.ts`：声明 extension runner 和完整 dispose 能力。
- `lib/rpc-manager.ts`：wrapper 异步 shutdown、生命周期注册、start barrier 和信号关闭。
- `app/api/agent/new/route.ts`：draining 时两次 fail-closed 检查并返回 503/Retry-After。
- `app/api/agent/[id]/route.ts`：draining 时拒绝 POST，GET 保持可读。
- `app/api/sessions/[id]/route.ts`：删除运行中会话时等待完整 shutdown。
- `middleware.ts`：只放行 health 和内部 token 接口的 cookie 前置检查；接口自身仍执行 token 校验。
- `next.config.ts`：启用 standalone 并保持 Pi external tracing。
- `package.json`、`package-lock.json`：统一 verify scripts 和 Vitest 依赖。
- `tsconfig.json`：生产类型检查排除测试。
- `__tests__/hooks/useRecentCwds.test.ts`、`__tests__/lib/recent-cwds-storage.test.ts`：Jest API 迁移到 Vitest。
- `AGENTS.md`：替换旧的源码目录 build 发布说明，写入不可变 release 流程和 60 秒边界。

`middleware.ts` 和 `lib/release-metadata.ts` 虽未出现在设计文档第 15 节的初始清单中，但分别是“health/internal 不依赖 cookie”和“运行时身份必须匹配 release.json”的必要实现边界；不得用绕过中间件或复制解析逻辑替代。

## 固定协议

后续所有任务使用以下名称和响应，不在实施时另起一套：

```ts
type ProcessState = "running" | "draining" | "shutting_down";

type DrainErrorPhase = "pending_start" | "abort" | "session_shutdown" | "dispose";

interface DrainResult {
  state: "shutting_down";
  sessionCount: number;
  initiallyStreaming: number;
  naturallyCompleted: number;
  aborted: number;
  errors: Array<{ sessionId: string; phase: DrainErrorPhase }>;
  elapsedMs: number;
}
```

- agent 写接口 draining 响应：HTTP 503，JSON `{ "error": "服务正在发布，请稍后重试" }`，header `Retry-After: 5`。
- internal 接口认证：`Authorization: Bearer <PI_WEB_RELEASE_TOKEN>`；不接受 cookie 角色替代。
- drain 成功：HTTP 200 + `DrainResult`；任一 session 关闭错误：HTTP 500 + 同一结构化结果。
- resume 成功：HTTP 200 `{ "state": "running" }`；drain 仍在执行或状态不允许：HTTP 409。
- ready 成功：HTTP 200；任一检查失败：HTTP 503。响应只包含 `status`、`releaseId`、`commit` 和布尔检查名。
- `release.json` 是 release 身份唯一来源；健康 API 不信任请求参数，也不把绝对路径返回给客户端。

### Task 1: 建立无过滤统一质量门禁

**Files:**
- Create: `vitest.config.ts`
- Create: `tsconfig.tests.json`
- Create: `.github/workflows/verify.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `__tests__/hooks/useRecentCwds.test.ts`
- Modify: `__tests__/lib/recent-cwds-storage.test.ts`

- [ ] **Step 1: 记录当前门禁失败（RED）**

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm run verify
```

Expected: FAIL with `Missing script: "verify"`。这证明当前没有统一门禁，而不是先过滤已知错误。

- [ ] **Step 2: 安装浏览器测试依赖并生成 lockfile**

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm install --save-dev vitest jsdom @testing-library/react
```

Expected: `package.json` 和 `package-lock.json` 只新增上述 devDependencies 及其传递依赖；不运行 audit force。

- [ ] **Step 3: 写入生产/测试 TypeScript 边界和 Vitest 收集范围**

将 `tsconfig.json` 的 `exclude` 改为：

```json
"exclude": [
  "node_modules",
  "__tests__"
]
```

创建 `tsconfig.tests.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "incremental": false,
    "allowImportingTsExtensions": true,
    "types": ["node", "vitest/globals"]
  },
  "include": [
    "__tests__/**/*.ts",
    "__tests__/**/*.tsx",
    "hooks/**/*.ts",
    "lib/**/*.ts",
    "next-env.d.ts"
  ],
  "exclude": ["node_modules"]
}
```

创建 `vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: [
      "__tests__/hooks/**/*.test.ts",
      "__tests__/lib/recent-cwds-storage.test.ts",
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
```

- [ ] **Step 4: 把两组遗失的 Jest 测试迁移到 Vitest**

`__tests__/hooks/useRecentCwds.test.ts` 使用以下 import 和 mock 类型；测试断言主体保持原样：

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecentCwds } from "@/hooks/useRecentCwds";
import { getAll, add, remove, clear } from "@/lib/recent-cwds-storage";

vi.mock("@/lib/recent-cwds-storage");

const mockGetAll = vi.mocked(getAll);
const mockAdd = vi.mocked(add);
const mockRemove = vi.mocked(remove);
const mockClear = vi.mocked(clear);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockReturnValue([]);
  mockAdd.mockReturnValue([]);
  mockRemove.mockReturnValue([]);
});
```

`__tests__/lib/recent-cwds-storage.test.ts` 使用：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAll, add, remove, clear, validate } from "@/lib/recent-cwds-storage";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
});
afterEach(() => localStorage.clear());
```

将该文件中的 `jest.clearAllMocks()` 删除，将 `global.fetch = jest.fn()` 删除，并把三处 `(global.fetch as jest.Mock)` 分别改成 `fetchMock`。`setMockData` 的参数从 `any[]` 改成：

```ts
function setMockData(data: Array<{ path: unknown; timestamp: unknown }>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
```

- [ ] **Step 5: 写入 package scripts**

保留现有 `dev`、`build`、`start`、`release`，把测试和检查 scripts 定义为：

```json
"test:auth": "node --experimental-strip-types --test \"__tests__/lib/auth/**/*.test.ts\"",
"test:release": "node --experimental-strip-types --test \"__tests__/release/**/*.test.ts\"",
"test:ui": "vitest run --config vitest.config.ts",
"test": "npm run test:auth && npm run test:release && npm run test:ui",
"typecheck:app": "tsc --noEmit -p tsconfig.json",
"typecheck:tests": "tsc --noEmit -p tsconfig.tests.json",
"typecheck": "npm run typecheck:app && npm run typecheck:tests",
"verify": "npm run typecheck && npm run lint && npm test"
```

因为 release 测试目录尚未创建，先创建空目录不进入 Git没有意义；临时将 `test:release` 写为以下命令，Task 2 创建第一份文件后立即恢复最终命令：

```json
"test:release": "node -e \"console.log('release tests are introduced in Task 2')\""
```

- [ ] **Step 6: 增加 CI**

创建 `.github/workflows/verify.yml`：

```yaml
name: verify

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.20.0
          cache: npm
      - run: sudo apt-get update && sudo apt-get install -y rsync
      - run: npm ci
      - run: npm run verify
```

- [ ] **Step 7: 运行新门禁（GREEN）**

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm run verify
```

Expected: production typecheck、test typecheck、ESLint、54 个现有 auth tests 和两组 Vitest 全部 PASS，输出中没有 `grep -v`、`|| true` 或错误过滤。

- [ ] **Step 8: 提交**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.tests.json vitest.config.ts .github/workflows/verify.yml __tests__/hooks/useRecentCwds.test.ts __tests__/lib/recent-cwds-storage.test.ts
git commit -m "test: 建立统一质量门禁"
```

### Task 2: 用 TDD 实现进程生命周期协调器

**Files:**
- Create: `lib/process-lifecycle.ts`
- Create: `__tests__/lib/auth/process-lifecycle.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写 lifecycle RED tests**

创建 `__tests__/lib/auth/process-lifecycle.test.ts`，先覆盖自然完成、超时 abort、错误隔离、幂等 drain、resume 和 admission：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProcessLifecycle,
  ProcessDrainingError,
  type DrainableSession,
  type LifecycleClock,
} from "../../../lib/process-lifecycle.ts";

function fakeClock() {
  let now = 0;
  const sleepers: Array<() => void> = [];
  const clock: LifecycleClock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      for (const wake of sleepers.splice(0)) wake();
    },
  };
  return { clock, get now() { return now; }, sleepers };
}

function session(id: string, streaming = false): DrainableSession & {
  aborted: number;
  shutdowns: number;
} {
  return {
    sessionId: id,
    streaming,
    aborted: 0,
    shutdowns: 0,
    isStreaming() { return this.streaming; },
    async abortForShutdown() { this.aborted += 1; this.streaming = false; },
    async shutdown() { this.shutdowns += 1; },
  };
}

test("running admits writes and draining returns the fixed 503 contract", async () => {
  const lifecycle = new ProcessLifecycle(fakeClock().clock);
  assert.deepEqual(lifecycle.agentAdmission(), { allowed: true });
  const drain = lifecycle.drain({ graceMs: 0, pollMs: 1 });
  assert.deepEqual(lifecycle.agentAdmission(), {
    allowed: false,
    status: 503,
    retryAfter: "5",
    error: "服务正在发布，请稍后重试",
  });
  assert.throws(() => lifecycle.beginSessionStart(), ProcessDrainingError);
  await drain;
});

test("a reply that finishes in the grace period is not aborted", async () => {
  const time = fakeClock();
  const lifecycle = new ProcessLifecycle(time.clock);
  const active = session("natural", true);
  lifecycle.register(active);
  const originalSleep = time.clock.sleep;
  time.clock.sleep = async (ms) => {
    active.streaming = false;
    await originalSleep(ms);
  };
  const result = await lifecycle.drain({ graceMs: 30_000, pollMs: 100 });
  assert.equal(active.aborted, 0);
  assert.equal(active.shutdowns, 1);
  assert.equal(result.naturallyCompleted, 1);
});

test("a reply exceeding 30 seconds is aborted then shut down", async () => {
  const lifecycle = new ProcessLifecycle(fakeClock().clock);
  const active = session("slow", true);
  lifecycle.register(active);
  const result = await lifecycle.drain({ graceMs: 30_000, pollMs: 100 });
  assert.equal(active.aborted, 1);
  assert.equal(active.shutdowns, 1);
  assert.equal(result.aborted, 1);
  assert.equal(result.elapsedMs, 30_000);
});

test("one shutdown failure does not skip remaining sessions", async () => {
  const lifecycle = new ProcessLifecycle(fakeClock().clock);
  const broken = session("broken");
  broken.shutdown = async () => { broken.shutdowns += 1; throw new Error("secret must not escape"); };
  const healthy = session("healthy");
  lifecycle.register(broken);
  lifecycle.register(healthy);
  const result = await lifecycle.drain({ graceMs: 0, pollMs: 1 });
  assert.equal(healthy.shutdowns, 1);
  assert.deepEqual(result.errors, [{ sessionId: "broken", phase: "session_shutdown" }]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("concurrent and repeated drain share one result and never double shutdown", async () => {
  const lifecycle = new ProcessLifecycle(fakeClock().clock);
  const managed = session("once");
  lifecycle.register(managed);
  const first = lifecycle.drain({ graceMs: 0, pollMs: 1 });
  const second = lifecycle.drain({ graceMs: 0, pollMs: 1 });
  assert.strictEqual(first, second);
  const firstResult = await first;
  const thirdResult = await lifecycle.drain({ graceMs: 0, pollMs: 1 });
  assert.deepEqual(thirdResult, firstResult);
  assert.equal(managed.shutdowns, 1);
});

test("drain waits for starts admitted before the state transition", async () => {
  const time = fakeClock();
  const lifecycle = new ProcessLifecycle(time.clock);
  const finish = lifecycle.beginSessionStart();
  const managed = session("late");
  const originalSleep = time.clock.sleep;
  let released = false;
  time.clock.sleep = async (ms) => {
    if (!released) {
      released = true;
      lifecycle.register(managed);
      finish();
    }
    await originalSleep(ms);
  };
  const result = await lifecycle.drain({ graceMs: 30_000, pollMs: 100 });
  assert.equal(result.sessionCount, 1);
  assert.equal(managed.shutdowns, 1);
});

test("resume is rejected while drain runs and succeeds after drain completes", async () => {
  const lifecycle = new ProcessLifecycle(fakeClock().clock);
  const drain = lifecycle.drain({ graceMs: 0, pollMs: 1 });
  assert.equal(lifecycle.resume(), false);
  await drain;
  assert.equal(lifecycle.resume(), true);
  assert.equal(lifecycle.state, "running");
  assert.deepEqual(lifecycle.agentAdmission(), { allowed: true });
});
```

- [ ] **Step 2: 运行 tests 验证缺少模块（RED）**

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home node --experimental-strip-types --test __tests__/lib/auth/process-lifecycle.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/process-lifecycle.ts`。

- [ ] **Step 3: 实现最小 lifecycle**

创建 `lib/process-lifecycle.ts`，公开类型和方法必须与测试一致：

```ts
export type ProcessState = "running" | "draining" | "shutting_down";
export type DrainErrorPhase = "pending_start" | "abort" | "session_shutdown" | "dispose";

export interface DrainResult {
  state: "shutting_down";
  sessionCount: number;
  initiallyStreaming: number;
  naturallyCompleted: number;
  aborted: number;
  errors: Array<{ sessionId: string; phase: DrainErrorPhase }>;
  elapsedMs: number;
}

export interface DrainableSession {
  sessionId: string;
  isStreaming(): boolean;
  abortForShutdown(): Promise<void>;
  shutdown(reason: "quit"): Promise<void>;
}

export interface LifecycleClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class ProcessDrainingError extends Error {
  constructor() {
    super("服务正在发布，请稍后重试");
    this.name = "ProcessDrainingError";
  }
}

const defaultClock: LifecycleClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class ProcessLifecycle {
  state: ProcessState = "running";
  private sessions = new Map<string, DrainableSession>();
  private pendingStarts = 0;
  private drainPromise: Promise<DrainResult> | null = null;
  private lastResult: DrainResult | null = null;

  constructor(private readonly clock: LifecycleClock = defaultClock) {}

  agentAdmission():
    | { allowed: true }
    | { allowed: false; status: 503; retryAfter: "5"; error: string } {
    return this.state === "running"
      ? { allowed: true }
      : {
          allowed: false,
          status: 503,
          retryAfter: "5",
          error: "服务正在发布，请稍后重试",
        };
  }

  assertAcceptingAgentCommands(): void {
    if (this.state !== "running") throw new ProcessDrainingError();
  }

  beginSessionStart(): () => void {
    this.assertAcceptingAgentCommands();
    this.pendingStarts += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.pendingStarts -= 1;
    };
  }

  register(session: DrainableSession): () => void {
    this.sessions.set(session.sessionId, session);
    return () => {
      if (this.sessions.get(session.sessionId) === session) {
        this.sessions.delete(session.sessionId);
      }
    };
  }

  drain(options: { graceMs?: number; pollMs?: number } = {}): Promise<DrainResult> {
    if (this.drainPromise) return this.drainPromise;
    if (this.lastResult) return Promise.resolve(this.lastResult);

    const graceMs = options.graceMs ?? 30_000;
    const pollMs = options.pollMs ?? 100;
    this.state = "draining";
    this.drainPromise = this.runDrain(graceMs, pollMs);
    return this.drainPromise;
  }

  private async runDrain(graceMs: number, pollMs: number): Promise<DrainResult> {
    const startedAt = this.clock.now();
    const deadline = startedAt + graceMs;
    const errors: DrainResult["errors"] = [];

    while (this.pendingStarts > 0 && this.clock.now() < deadline) {
      await this.clock.sleep(Math.min(pollMs, deadline - this.clock.now()));
    }
    if (this.pendingStarts > 0) {
      errors.push({ sessionId: "pending-starts", phase: "pending_start" });
    }

    const sessions = [...this.sessions.values()];
    const initiallyStreaming = sessions.filter((item) => item.isStreaming()).length;
    while (sessions.some((item) => item.isStreaming()) && this.clock.now() < deadline) {
      await this.clock.sleep(Math.min(pollMs, deadline - this.clock.now()));
    }

    const stillStreaming = sessions.filter((item) => item.isStreaming());
    let aborted = 0;
    for (const item of stillStreaming) {
      try {
        await item.abortForShutdown();
        aborted += 1;
      } catch {
        errors.push({ sessionId: item.sessionId, phase: "abort" });
      }
    }

    for (const item of sessions) {
      try {
        await item.shutdown("quit");
      } catch (error) {
        const phase = error instanceof SessionDisposeError ? "dispose" : "session_shutdown";
        errors.push({ sessionId: item.sessionId, phase });
      }
    }

    this.state = "shutting_down";
    this.lastResult = {
      state: "shutting_down",
      sessionCount: sessions.length,
      initiallyStreaming,
      naturallyCompleted: initiallyStreaming - stillStreaming.length,
      aborted,
      errors,
      elapsedMs: Math.round(this.clock.now() - startedAt),
    };
    return this.lastResult;
  }

  resume(): boolean {
    if (this.state === "running") return true;
    if (this.drainPromise && !this.lastResult) return false;
    this.state = "running";
    this.drainPromise = null;
    this.lastResult = null;
    return true;
  }
}

export class SessionDisposeError extends Error {
  constructor() {
    super("AgentSession dispose failed");
    this.name = "SessionDisposeError";
  }
}

declare global {
  var __piProcessLifecycle: ProcessLifecycle | undefined;
  var __piProcessSignalsInstalled: boolean | undefined;
}

export function getProcessLifecycle(): ProcessLifecycle {
  if (!globalThis.__piProcessLifecycle) {
    globalThis.__piProcessLifecycle = new ProcessLifecycle();
  }
  return globalThis.__piProcessLifecycle;
}

export function installProcessSignalHandlers(
  exit: (code: number) => never = process.exit
): void {
  if (globalThis.__piProcessSignalsInstalled) return;
  globalThis.__piProcessSignalsInstalled = true;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    if (stopping) return;
    stopping = getProcessLifecycle()
      .drain()
      .then(() => exit(0), () => exit(1));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
```

在实现时保持 `DrainResult.errors` 只有 session ID 和阶段，不加入原始 exception message，避免把扩展或 provider 错误中的凭据返回给 internal API。

- [ ] **Step 4: 修复错误阶段分类测试接口**

wrapper 在 Task 3 会用 `SessionDisposeError` 明确标记 dispose 失败；本任务追加一个测试，确保它被映射为 `dispose`：

```ts
test("dispose failures have a distinct non-sensitive phase", async () => {
  const lifecycle = new ProcessLifecycle(fakeClock().clock);
  const broken = session("dispose");
  broken.shutdown = async () => {
    const { SessionDisposeError } = await import("../../../lib/process-lifecycle.ts");
    throw new SessionDisposeError();
  };
  lifecycle.register(broken);
  const result = await lifecycle.drain({ graceMs: 0, pollMs: 1 });
  assert.deepEqual(result.errors, [{ sessionId: "dispose", phase: "dispose" }]);
});
```

- [ ] **Step 5: 启用最终 release test script 并运行 GREEN**

把 `package.json` 的 `test:release` 从 Task 1 临时命令改成：

```json
"test:release": "node --experimental-strip-types --test \"__tests__/release/**/*.test.ts\""
```

Task 8 才创建 release test 文件，因此当前同时把 glob 扩展为 lifecycle 所在目录是错误的；保持上述最终值，并在本任务只运行：

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home node --experimental-strip-types --test __tests__/lib/auth/process-lifecycle.test.ts
HOME=/home/hsops/.pi-release-reliability-dev-home npm run test:auth
HOME=/home/hsops/.pi-release-reliability-dev-home npm run typecheck
```

Expected: lifecycle tests 和现有 auth tests PASS，两个 tsconfig 均无错误。`npm test` 暂不执行，直到 Task 8 创建 release glob 对应文件。

- [ ] **Step 6: 提交**

```bash
git add lib/process-lifecycle.ts __tests__/lib/auth/process-lifecycle.test.ts package.json
git commit -m "feat: 增加进程生命周期协调器"
```

### Task 3: 接入 AgentSession 完整关闭和写请求 drain 门禁

**Files:**
- Modify: `lib/pi-types.ts`
- Modify: `lib/rpc-manager.ts`
- Modify: `app/api/agent/new/route.ts`
- Modify: `app/api/agent/[id]/route.ts`
- Modify: `app/api/sessions/[id]/route.ts`
- Test: `__tests__/lib/auth/process-lifecycle.test.ts`

- [ ] **Step 1: 为 shutdown 顺序增加 RED test**

在 lifecycle test 中增加一个可复用 fake wrapper 测试。为避免构造真实 Pi session，把关闭顺序抽成 `shutdownAgentSession(inner)` 并从 `rpc-manager.ts` 导出：

```ts
test("agent shutdown emits quit once, then disposes once", async () => {
  const calls: string[] = [];
  const { shutdownAgentSession } = await import("../../../lib/rpc-manager.ts");
  await shutdownAgentSession({
    extensionRunner: {
      hasHandlers: () => true,
      emit: async (event: { type: string; reason: string }) => {
        calls.push(`${event.type}:${event.reason}`);
      },
    },
    dispose: () => calls.push("dispose"),
  });
  assert.deepEqual(calls, ["session_shutdown:quit", "dispose"]);
});

test("dispose still runs when an extension shutdown handler fails", async () => {
  let disposed = 0;
  const { shutdownAgentSession } = await import("../../../lib/rpc-manager.ts");
  await assert.rejects(() => shutdownAgentSession({
    extensionRunner: {
      hasHandlers: () => true,
      emit: async () => { throw new Error("extension failed"); },
    },
    dispose: () => { disposed += 1; },
  }));
  assert.equal(disposed, 1);
});
```

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home node --experimental-strip-types --test __tests__/lib/auth/process-lifecycle.test.ts
```

Expected: FAIL because `shutdownAgentSession` is not exported。

- [ ] **Step 2: 扩充 Pi session 类型并实现关闭 helper**

在 `lib/pi-types.ts` 的 `AgentSessionLike` 中加入：

```ts
readonly extensionRunner: {
  hasHandlers(eventType: string): boolean;
  emit(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown>;
};
dispose(): void;
```

在 `lib/rpc-manager.ts` 增加：

```ts
import {
  getProcessLifecycle,
  installProcessSignalHandlers,
  ProcessDrainingError,
  SessionDisposeError,
} from "./process-lifecycle";

type ShutdownInner = Pick<AgentSessionLike, "extensionRunner" | "dispose">;

export async function shutdownAgentSession(inner: ShutdownInner): Promise<void> {
  let shutdownError: unknown = null;
  try {
    if (inner.extensionRunner.hasHandlers("session_shutdown")) {
      await inner.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    }
  } catch (error) {
    shutdownError = error;
  }

  try {
    inner.dispose();
  } catch {
    throw new SessionDisposeError();
  }

  if (shutdownError) throw shutdownError;
}
```

- [ ] **Step 3: 让 wrapper 实现幂等 drain 接口**

在 `AgentSessionWrapper` 增加 `_shutdownPromise`、公开 streaming 状态和关闭方法：

```ts
private _shutdownPromise: Promise<void> | null = null;

isStreaming(): boolean {
  return this.inner.isStreaming;
}

async abortForShutdown(): Promise<void> {
  await this.inner.abort();
}

shutdown(reason: "quit" = "quit"): Promise<void> {
  if (this._shutdownPromise) return this._shutdownPromise;
  this._shutdownPromise = (async () => {
    try {
      await shutdownAgentSession(this.inner);
    } finally {
      this.destroy();
    }
  })();
  return this._shutdownPromise;
}
```

把 idle timer 改成：

```ts
this.idleTimer = setTimeout(() => void this.shutdown("quit"), 10 * 60 * 1000);
```

把 fork 分支的 `this.destroy()` 改成 `await this.shutdown("quit")`。把 `abortSessionsUnderCwd` 的 `send abort + destroy` 改成：

```ts
await wrapper.abortForShutdown();
await wrapper.shutdown("quit");
```

在 `app/api/sessions/[id]/route.ts` 删除会话路径中，把：

```ts
getRpcSession(id)?.destroy();
```

改为：

```ts
await getRpcSession(id)?.shutdown("quit");
```

- [ ] **Step 4: 注册 wrapper、关闭 start race 并安装 signal handler**

`startRpcSession()` 在读取 registry 前调用 barrier，并保证所有返回/异常都会 release：

```ts
const lifecycle = getProcessLifecycle();
const finishLifecycleStart = lifecycle.beginSessionStart();

try {
  // 保留现有 registry、delete lock、createAgentSession 逻辑。
  // createAgentSession 成功后、写入 registry 前再次检查：
  lifecycle.assertAcceptingAgentCommands();
  const unregisterLifecycle = lifecycle.register(wrapper);
  wrapper.onDestroy(() => {
    unregisterLifecycle();
    registry.delete(realSessionId);
  });
  registry.set(realSessionId, wrapper);
  return { session: wrapper, realSessionId };
} catch (error) {
  if (typeof wrapper !== "undefined" && error instanceof ProcessDrainingError) {
    await wrapper.shutdown("quit");
  }
  throw error;
} finally {
  finishLifecycleStart();
}
```

实际编辑时将 barrier 放进既有 `starting` Promise 内部，不能在命中 `existing` 或 `inflight` 之前重复计数：命中活 wrapper 只需 `lifecycle.assertAcceptingAgentCommands()`；命中 inflight 复用原 Promise；只有本调用真正创建 session 时才 `beginSessionStart()`。

删除 `getRegistry()` 中同步 `exit/SIGINT/SIGTERM` cleanup，并在模块底部调用：

```ts
installProcessSignalHandlers();
```

这保证 SIGTERM 等待同一个幂等 drain；`exit` 事件不再伪装成可以等待异步扩展关闭。

- [ ] **Step 5: 在两个 agent POST 路径做前后双门禁**

两个 route 增加相同 helper：

```ts
import {
  getProcessLifecycle,
  ProcessDrainingError,
} from "@/lib/process-lifecycle";

function drainingResponse() {
  const admission = getProcessLifecycle().agentAdmission();
  if (admission.allowed) return null;
  return NextResponse.json(
    { error: admission.error },
    { status: admission.status, headers: { "Retry-After": admission.retryAfter } }
  );
}
```

每个 POST 在读取 body/启动昂贵操作前执行一次：

```ts
const rejected = drainingResponse();
if (rejected) return rejected;
```

并在 `withStartGuard` / `withCwdOperationGuard` callback 的第一行再次执行：

```ts
getProcessLifecycle().assertAcceptingAgentCommands();
```

两个 catch 在现有 500 前加入：

```ts
if (error instanceof ProcessDrainingError) {
  return NextResponse.json(
    { error: error.message },
    { status: 503, headers: { "Retry-After": "5" } }
  );
}
```

`GET /api/agent/[id]` 不加门禁，drain 期间仍允许前端读取现有状态。

- [ ] **Step 6: 运行 focused 和完整 auth 检查（GREEN）**

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home node --experimental-strip-types --test __tests__/lib/auth/process-lifecycle.test.ts
HOME=/home/hsops/.pi-release-reliability-dev-home npm run test:auth
HOME=/home/hsops/.pi-release-reliability-dev-home npm run typecheck
HOME=/home/hsops/.pi-release-reliability-dev-home npm run lint
```

Expected: 全部 PASS；测试顺序明确为 shutdown event 后 dispose，extension 失败仍 dispose，drain 不重复关闭。

- [ ] **Step 7: 提交**

```bash
git add lib/pi-types.ts lib/rpc-manager.ts lib/process-lifecycle.ts app/api/agent/new/route.ts app/api/agent/[id]/route.ts app/api/sessions/[id]/route.ts __tests__/lib/auth/process-lifecycle.test.ts
git commit -m "feat: 发布时排空并关闭代理会话"
```

### Task 4: 实现 release token 和内部 drain/resume API

**Files:**
- Create: `lib/release-auth.ts`
- Create: `app/api/internal/drain/route.ts`
- Create: `app/api/internal/resume/route.ts`
- Modify: `middleware.ts`
- Test: `__tests__/lib/auth/process-lifecycle.test.ts`

- [ ] **Step 1: 写 token RED tests**

追加：

```ts
test("release token requires an exact constant-time Bearer match", async () => {
  const { isAuthorizedReleaseRequest } = await import("../../../lib/release-auth.ts");
  const env = { PI_WEB_RELEASE_TOKEN: "0123456789abcdef" };
  assert.equal(isAuthorizedReleaseRequest(
    new Request("http://local", { headers: { authorization: "Bearer 0123456789abcdef" } }),
    env
  ), true);
  assert.equal(isAuthorizedReleaseRequest(
    new Request("http://local", { headers: { authorization: "Bearer 0123456789abcdeg" } }),
    env
  ), false);
  assert.equal(isAuthorizedReleaseRequest(
    new Request("http://local", { headers: { cookie: "pi_auth=admin" } }),
    env
  ), false);
  assert.equal(isAuthorizedReleaseRequest(
    new Request("http://local", { headers: { authorization: "Bearer short" } }),
    env
  ), false);
});
```

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home node --experimental-strip-types --test __tests__/lib/auth/process-lifecycle.test.ts
```

Expected: FAIL with missing `lib/release-auth.ts`。

- [ ] **Step 2: 实现恒定时间 token 比较**

创建 `lib/release-auth.ts`：

```ts
import { timingSafeEqual } from "node:crypto";

type ReleaseEnv = Pick<NodeJS.ProcessEnv, "PI_WEB_RELEASE_TOKEN">;

export function isAuthorizedReleaseRequest(
  request: Request,
  env: ReleaseEnv = process.env
): boolean {
  const expected = env.PI_WEB_RELEASE_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}
```

- [ ] **Step 3: 创建 internal routes**

`app/api/internal/drain/route.ts`：

```ts
import { NextResponse } from "next/server";
import { getProcessLifecycle } from "@/lib/process-lifecycle";
import { isAuthorizedReleaseRequest } from "@/lib/release-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedReleaseRequest(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const result = await getProcessLifecycle().drain();
  return NextResponse.json(result, { status: result.errors.length === 0 ? 200 : 500 });
}
```

`app/api/internal/resume/route.ts`：

```ts
import { NextResponse } from "next/server";
import { getProcessLifecycle } from "@/lib/process-lifecycle";
import { isAuthorizedReleaseRequest } from "@/lib/release-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedReleaseRequest(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const lifecycle = getProcessLifecycle();
  if (!lifecycle.resume()) {
    return NextResponse.json({ error: "drain 尚未完成" }, { status: 409 });
  }
  return NextResponse.json({ state: "running" });
}
```

- [ ] **Step 4: 放行中间件前置 cookie 检查**

把 `middleware.ts` 的公开集合扩展为：

```ts
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/register-gate",
  "/api/auth/register",
  "/api/auth/login",
  "/api/health/live",
  "/api/health/ready",
  "/api/internal/drain",
  "/api/internal/resume",
]);
```

这只绕过 cookie 前置检查；internal route 仍必须通过 Bearer token。不要把 `/api/internal/*` 做前缀通配放行。

- [ ] **Step 5: 运行 GREEN 和门禁**

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home node --experimental-strip-types --test __tests__/lib/auth/process-lifecycle.test.ts
HOME=/home/hsops/.pi-release-reliability-dev-home npm run typecheck
HOME=/home/hsops/.pi-release-reliability-dev-home npm run lint
```

Expected: PASS；cookie-only token 测试为 false，长度不同不会调用不安全比较。

- [ ] **Step 6: 提交**

```bash
git add lib/release-auth.ts app/api/internal/drain/route.ts app/api/internal/resume/route.ts middleware.ts __tests__/lib/auth/process-lifecycle.test.ts
git commit -m "feat: 增加发布内部控制接口"
```

### Task 5: 实现 release 身份和健康 API

**Files:**
- Create: `lib/release-metadata.ts`
- Create: `app/api/health/live/route.ts`
- Create: `app/api/health/ready/route.ts`
- Test: `__tests__/lib/auth/process-lifecycle.test.ts`

- [ ] **Step 1: 写 release metadata RED test**

追加：

```ts
test("release metadata requires the complete immutable manifest", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "pi-release-meta-"));
  const { readReleaseMetadata } = await import("../../../lib/release-metadata.ts");
  try {
    writeFileSync(join(root, "release.json"), JSON.stringify({
      releaseId: "20260713-160000-05816e7",
      commit: "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86",
      builtAt: "2026-07-13T08:00:00.000Z",
      nodeVersion: "v22.20.0",
      appVersion: "0.6.12",
      piVersion: "0.75.5",
    }));
    assert.deepEqual(readReleaseMetadata(root), {
      releaseId: "20260713-160000-05816e7",
      commit: "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86",
    });
    writeFileSync(join(root, "release.json"), "{}");
    assert.equal(readReleaseMetadata(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Run focused test and expect missing module.

- [ ] **Step 2: 实现 manifest 读取**

创建 `lib/release-metadata.ts`：

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ReleaseMetadata {
  releaseId: string;
  commit: string;
}

export function readReleaseMetadata(root = process.cwd()): ReleaseMetadata | null {
  try {
    const value = JSON.parse(readFileSync(join(root, "release.json"), "utf8")) as Record<string, unknown>;
    if (typeof value.releaseId !== "string" || !/^\d{8}-\d{6}-[0-9a-f]{7,}$/.test(value.releaseId)) return null;
    if (typeof value.commit !== "string" || !/^[0-9a-f]{40}$/.test(value.commit)) return null;
    return { releaseId: value.releaseId, commit: value.commit };
  } catch {
    return null;
  }
}

export function runtimeIdentity() {
  return readReleaseMetadata() ?? {
    releaseId: process.env.NODE_ENV === "production" ? "invalid" : "development",
    commit: "unknown",
  };
}
```

- [ ] **Step 3: 创建 live route**

`app/api/health/live/route.ts`：

```ts
import { NextResponse } from "next/server";
import { runtimeIdentity } from "@/lib/release-metadata";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ status: "live", ...runtimeIdentity() });
}
```

- [ ] **Step 4: 创建 ready route**

`app/api/health/ready/route.ts`：

```ts
import { NextResponse } from "next/server";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "@/lib/auth/db";
import { getProcessLifecycle } from "@/lib/process-lifecycle";
import { readReleaseMetadata, runtimeIdentity } from "@/lib/release-metadata";

export const runtime = "nodejs";

function checkDatabase(): boolean {
  try {
    getDb().prepare("SELECT 1 AS ok").get();
    return true;
  } catch {
    return false;
  }
}

function checkDataRoots(): boolean {
  try {
    for (const path of [
      join(homedir(), ".pi-web-auth"),
      join(homedir(), "pi-users"),
      join(homedir(), ".pi", "agent"),
    ]) {
      accessSync(path, constants.R_OK | constants.W_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export function GET() {
  const identity = runtimeIdentity();
  const checks = {
    lifecycle: getProcessLifecycle().state === "running",
    database: checkDatabase(),
    dataRoots: checkDataRoots(),
    release: process.env.NODE_ENV !== "production" || readReleaseMetadata() !== null,
  };
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", ...identity, checks },
    { status: ready ? 200 : 503 }
  );
}
```

健康响应不得加入数据库异常、路径、用户名、SQL 行或 stack。

- [ ] **Step 5: 在隔离 dev server 做 HTTP 验证**

Run in a persistent shell:

```bash
mkdir -p /home/hsops/.pi-release-reliability-dev-home/.pi-web-auth
mkdir -p /home/hsops/.pi-release-reliability-dev-home/pi-users
mkdir -p /home/hsops/.pi-release-reliability-dev-home/.pi/agent
HOME=/home/hsops/.pi-release-reliability-dev-home npm run dev -- -p 8145
```

Run from another shell:

```bash
curl -fsS http://127.0.0.1:8145/api/health/live
curl -fsS http://127.0.0.1:8145/api/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8145/api/internal/drain
```

Expected: live 200、ready 200 with `development/unknown`、无 token drain 401。停止 8145 dev server 后确认生产 8000 仍为 200。

- [ ] **Step 6: 运行门禁并提交**

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm run typecheck
HOME=/home/hsops/.pi-release-reliability-dev-home npm run lint
git add lib/release-metadata.ts app/api/health/live/route.ts app/api/health/ready/route.ts __tests__/lib/auth/process-lifecycle.test.ts
git commit -m "feat: 增加生产健康检查"
```

### Task 6: 构建和验证不可变 standalone release

**Files:**
- Create: `scripts/lib/release-common.sh`
- Create: `scripts/build-release.sh`
- Create: `scripts/verify-standalone.mjs`
- Create: `scripts/systemd-stop.sh`
- Modify: `next.config.ts`
- Test: `__tests__/release/release-scripts.test.ts`（本任务先创建 build/staging tests，Task 8 扩充）

- [ ] **Step 1: 创建 release test harness 并写 RED tests**

创建 `__tests__/release/release-scripts.test.ts`，先写语法、脏分支和 staging 失败测试。helper 必须使用临时目录和 fake executables，不调用真实 systemctl：

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-release-test-"));
  roots.push(root);
  return root;
}

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(script: string, env: Record<string, string> = {}) {
  return spawnSync("bash", [script], {
    cwd: resolve("."),
    env: { ...process.env, HOME: tempRoot(), ...env },
    encoding: "utf8",
  });
}

test("release shell files pass bash syntax validation", () => {
  for (const script of [
    "scripts/lib/release-common.sh",
    "scripts/build-release.sh",
    "scripts/systemd-stop.sh",
  ]) {
    const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test("build-release refuses a dirty or non-main source before npm runs", () => {
  const root = tempRoot();
  const marker = join(root, "npm-called");
  const fakeNpm = join(root, "npm");
  executable(fakeNpm, `touch ${JSON.stringify(marker)}`);
  const result = run("scripts/build-release.sh", {
    PI_WEB_SOURCE_ROOT: resolve("."),
    PI_WEB_DEPLOY_ROOT: join(root, "deploy"),
    PI_WEB_NPM_BIN: fakeNpm,
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes("clean main"), true);
});

test("failed standalone verification never creates a release directory", () => {
  const root = tempRoot();
  const verify = join(root, "verify.mjs");
  writeFileSync(verify, "process.exit(23);\n");
  const result = run("scripts/build-release.sh", {
    PI_WEB_SOURCE_ROOT: resolve("."),
    PI_WEB_DEPLOY_ROOT: join(root, "deploy"),
    PI_WEB_ALLOW_TEST_SOURCE: "1",
    PI_WEB_SKIP_BUILD_FOR_TEST: "1",
    PI_WEB_STANDALONE_VERIFY_BIN: verify,
    RELEASE_ID: "20260713-160000-05816e7",
  });
  assert.equal(result.status, 23);
  assert.equal(readFileSync(join(root, "deploy", "staging", ".failed-20260713-160000-05816e7", "failure-stage"), "utf8").trim(), "staging-verify");
  assert.throws(() => readFileSync(join(root, "deploy", "releases", "20260713-160000-05816e7", "release.json")));
});
```

`PI_WEB_ALLOW_TEST_SOURCE` 和 `PI_WEB_SKIP_BUILD_FOR_TEST` 必须只在 `NODE_ENV=test` 时生效；test harness 传 `NODE_ENV=test`。生产运行设置这两个变量必须被脚本拒绝。

Run `npm run test:release`; expect FAIL because scripts do not exist.

- [ ] **Step 2: 启用 standalone tracing**

在 `next.config.ts` 的 config 中加入：

```ts
output: "standalone",
outputFileTracingIncludes: {
  "/*": [
    ".pi/extensions/**/*",
    "node_modules/@modelcontextprotocol/sdk/**/*",
    "node_modules/@z_ai/mcp-server/**/*",
    "node_modules/typebox/**/*",
  ],
},
```

保留现有 `outputFileTracingRoot` 和 `serverExternalPackages`；把 external package 列表扩充为：

```ts
serverExternalPackages: [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "better-sqlite3",
],
```

- [ ] **Step 3: 创建通用 shell 原语的第一部分**

创建 `scripts/lib/release-common.sh`：

```bash
#!/usr/bin/env bash

set -Eeuo pipefail

SOURCE_ROOT=${PI_WEB_SOURCE_ROOT:-/home/hsops/pi-web-auth}
DEPLOY_ROOT=${PI_WEB_DEPLOY_ROOT:-/home/hsops/pi-web-auth-deploy}
BACKUP_ROOT=${PI_WEB_BACKUP_ROOT:-/home/hsops/pi-web-auth-backups}
NODE_BIN=${PI_WEB_NODE_BIN:-/home/hsops/.nvm/versions/node/v22.20.0/bin/node}
NPM_BIN=${PI_WEB_NPM_BIN:-/home/hsops/.nvm/versions/node/v22.20.0/bin/npm}
SYSTEMCTL_BIN=${PI_WEB_SYSTEMCTL_BIN:-systemctl}
CURL_BIN=${PI_WEB_CURL_BIN:-curl}
RSYNC_BIN=${PI_WEB_RSYNC_BIN:-rsync}
SLEEP_BIN=${PI_WEB_SLEEP_BIN:-sleep}
SERVICE_NAME=${PI_WEB_SERVICE_NAME:-pi-web-auth.service}

umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require_dir() { [[ -d "$1" ]] || die "required directory missing: $1"; }
now_ms() {
  if [[ -n "${PI_WEB_NOW_BIN:-}" ]]; then "$PI_WEB_NOW_BIN"; else "$NODE_BIN" -e 'console.log(Math.floor(require("node:os").uptime()*1000))'; fi
}
json_log() {
  local phase=$1 result=$2 elapsed_ms=$3 detail=${4:-}
  "$NODE_BIN" -e 'const [releaseId,phase,result,elapsedMs,detail]=process.argv.slice(1); console.log(JSON.stringify({timestamp:new Date().toISOString(),releaseId,phase,result,elapsedMs:Number(elapsedMs),detail}))' \
    "${RELEASE_ID:-unknown}" "$phase" "$result" "$elapsed_ms" "$detail" | tee -a "${RELEASE_LOG:-/dev/null}" >&2
}
acquire_release_lock() {
  mkdir -p "$DEPLOY_ROOT"
  exec 9>"$DEPLOY_ROOT/release.lock"
  flock -n 9 || die "another release is already running"
}
atomic_symlink() {
  local target=$1 link=$2 temp="${link}.tmp.$$"
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$link"
}
```

Task 8 在同一文件追加预算、ready 和 retention 原语。

- [ ] **Step 4: 创建 standalone verifier**

创建 `scripts/verify-standalone.mjs`。该脚本不发送 prompt，也不连接真实模型；HTTP helper 不打印 cookie、响应 header、模型配置或环境变量：

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

const [releaseDir, home, portText, expectedReleaseId, expectedCommit] = process.argv.slice(2);
if (!releaseDir || !home || !portText || !expectedReleaseId || !expectedCommit) {
  throw new Error("usage: verify-standalone.mjs <release-dir> <home> <port> <release-id> <commit>");
}
const port = Number(portText);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid staging port");

const agentDir = join(home, ".pi", "agent");
const cwd = join(home, "pi-users", "releasecheck");
mkdirSync(join(home, ".pi-web-auth"), { recursive: true });
mkdirSync(agentDir, { recursive: true });
mkdirSync(cwd, { recursive: true });

const modelFixture = {
  providers: {
    "release-test": {
      name: "Release Test",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "release-test-key",
      api: "openai-completions",
      models: [{
        id: "release-test-model",
        name: "Release Test Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      }],
    },
  },
};
const modelsPath = join(agentDir, "models.json");
writeFileSync(modelsPath, `${JSON.stringify(modelFixture, null, 2)}\n`, { mode: 0o600 });

const server = spawn(process.execPath, [join(releaseDir, "server.js")], {
  cwd: releaseDir,
  env: {
    ...process.env,
    HOME: home,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    REGISTER_KEYWORD: "release-check",
    PI_WEB_RELEASE_TOKEN: "staging-release-token",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverError = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => { serverError = `${serverError}${chunk}`.slice(-4096); });

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function jsonRequest(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json().catch(() => null);
  return { status: response.status, body, cookie: response.headers.get("set-cookie") };
}

async function waitForReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await jsonRequest("/api/health/ready");
      if (result.status === 200 && result.body?.releaseId === expectedReleaseId && result.body?.commit === expectedCommit) return;
    } catch {
      // Server is still starting.
    }
    await sleep(250);
  }
  throw new Error("staging ready check failed");
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  const exited = once(server, "exit").then(() => true);
  const timedOut = sleep(5_000).then(() => false);
  if (!(await Promise.race([exited, timedOut]))) {
    server.kill("SIGKILL");
    await once(server, "exit");
    throw new Error("staging server required SIGKILL");
  }
}

let session;
try {
  await waitForReady();
  const registration = await jsonRequest("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword: "release-check", username: "releasecheck", password: "ReleasePass1" }),
  });
  if (registration.status !== 200) throw new Error("staging registration failed");
  const login = await jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "releasecheck", password: "ReleasePass1" }),
  });
  if (login.status !== 200 || !login.cookie) throw new Error("staging login failed");

  const piEntry = join(releaseDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");
  const {
    AuthStorage,
    ModelRegistry,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    createAgentSession,
  } = await import(pathToFileURL(piEntry).href);
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const model = modelRegistry.find("release-test", "release-test-model");
  if (!model || modelRegistry.getError()) throw new Error("staging model registry failed");
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const extensionPath = join(releaseDir, ".pi", "extensions", "z-ai-tools", "index.ts");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionPath],
  });
  await resourceLoader.reload();
  ({ session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    model,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "builtin",
  }));
  if (!session.getAllTools().some((tool) => tool.name.startsWith("zai_"))) {
    throw new Error("staging dynamic extension failed");
  }
  if (session.extensionRunner.hasHandlers("session_shutdown")) {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  }
  session.dispose();
  session = undefined;
} catch (error) {
  const check = error instanceof Error ? error.message : "staging verification failed";
  process.stderr.write(`${check}\n`);
  process.exitCode = 1;
} finally {
  if (session) session.dispose();
  try {
    await stopServer();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "staging shutdown failed"}\n`);
    process.exitCode = 1;
  }
  if (server.exitCode && server.exitCode !== 0 && process.exitCode !== 1) {
    process.stderr.write(`staging server exited unexpectedly (${server.exitCode}); ${serverError ? "stderr captured" : "no stderr"}\n`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 5: 创建 build-release.sh**

脚本严格执行以下状态机：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/release-common.sh"

main() {
  local test_mode=false
  if [[ "${NODE_ENV:-}" == test && "${PI_WEB_ALLOW_TEST_SOURCE:-}" == 1 ]]; then test_mode=true; fi
  if [[ "${PI_WEB_ALLOW_TEST_SOURCE:-0}" == 1 && "$test_mode" != true ]]; then
    die "test source override is forbidden outside NODE_ENV=test"
  fi

  git -C "$SOURCE_ROOT" rev-parse --git-dir >/dev/null || die "release source is not a git worktree"
  local branch commit short_sha
  branch=$(git -C "$SOURCE_ROOT" symbolic-ref --short HEAD)
  commit=$(git -C "$SOURCE_ROOT" rev-parse HEAD)
  short_sha=${commit:0:7}
  if [[ "$test_mode" != true ]]; then
    [[ "$branch" == main ]] || die "release source must be clean main"
    [[ -z "$(git -C "$SOURCE_ROOT" status --porcelain)" ]] || die "release source must be clean main"
  fi

  RELEASE_ID=${RELEASE_ID:-$(date -u +%Y%m%d-%H%M%S)-$short_sha}
  export RELEASE_ID
  local worktree="$DEPLOY_ROOT/staging/worktree-$RELEASE_ID"
  local stage="$DEPLOY_ROOT/staging/.incomplete-$RELEASE_ID"
  local failed="$DEPLOY_ROOT/staging/.failed-$RELEASE_ID"
  local final="$DEPLOY_ROOT/releases/$RELEASE_ID"
  mkdir -p "$DEPLOY_ROOT/staging" "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/logs"
  [[ ! -e "$final" ]] || die "release already exists: $RELEASE_ID"

  cleanup_worktree() {
    git -C "$SOURCE_ROOT" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  }
  trap cleanup_worktree EXIT

  if [[ "${PI_WEB_SKIP_BUILD_FOR_TEST:-0}" == 1 && "$test_mode" == true ]]; then
    mkdir -p "$stage/.next/static" "$stage/public" "$stage/.pi/extensions" "$stage/scripts"
    printf 'test server\n' > "$stage/server.js"
  else
    git -C "$SOURCE_ROOT" worktree add --detach "$worktree" "$commit"
    (cd "$worktree" && "$NPM_BIN" ci)
    (cd "$worktree" && "$NPM_BIN" run verify)
    (cd "$worktree" && "$NPM_BIN" run build)
    mkdir -p "$stage/.next" "$stage/.pi" "$stage/scripts"
    cp -a "$worktree/.next/standalone/." "$stage/"
    cp -a "$worktree/.next/static" "$stage/.next/static"
    cp -a "$worktree/public" "$stage/public"
    cp -a "$worktree/.pi/extensions" "$stage/.pi/extensions"
    cp "$worktree/scripts/systemd-stop.sh" "$stage/scripts/systemd-stop.sh"
  fi

  "$NODE_BIN" -e 'const fs=require("node:fs"); const [path,releaseId,commit,appVersion,piVersion]=process.argv.slice(1); fs.writeFileSync(path, JSON.stringify({releaseId,commit,builtAt:new Date().toISOString(),nodeVersion:process.version,appVersion,piVersion},null,2)+"\n", {mode:0o600})' \
    "$stage/release.json" "$RELEASE_ID" "$commit" \
    "$($NODE_BIN -p "require('$SOURCE_ROOT/package.json').version")" \
    "$($NODE_BIN -p "require('$SOURCE_ROOT/node_modules/@earendil-works/pi-coding-agent/package.json').version")"

  local verifier=${PI_WEB_STANDALONE_VERIFY_BIN:-$SOURCE_ROOT/scripts/verify-standalone.mjs}
  local verify_home="$DEPLOY_ROOT/staging/home-$RELEASE_ID"
  local verify_port=${PI_WEB_STAGING_PORT:-18145}
  if ! "$NODE_BIN" "$verifier" "$stage" "$verify_home" "$verify_port" "$RELEASE_ID" "$commit"; then
    mv "$stage" "$failed"
    printf 'staging-verify\n' > "$failed/failure-stage"
    return 23
  fi
  mv "$stage" "$final"
  rm -rf "$verify_home"
  printf '%s\n' "$final"
}

main "$@"
```

测试应断言 linked worktree 可用。所有失败 stage 保留，只有成功后删除 verify HOME。

- [ ] **Step 6: 创建 systemd stop helper（unit 在 Task 9）**

`scripts/systemd-stop.sh`：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE=${PI_WEB_RELEASE_ENV:-/home/hsops/.config/pi-web-auth/release.env}
CURL_BIN=${PI_WEB_CURL_BIN:-curl}
[[ -r "$ENV_FILE" ]] || { echo "release environment is unreadable" >&2; exit 1; }
set -a
source "$ENV_FILE"
set +a
[[ -n "${PI_WEB_RELEASE_TOKEN:-}" ]] || { echo "release token is missing" >&2; exit 1; }

"$CURL_BIN" --config - <<CURL_CONFIG
silent
show-error
fail-with-body
max-time = 60
request = "POST"
url = "http://127.0.0.1:8000/api/internal/drain"
header = "Authorization: Bearer ${PI_WEB_RELEASE_TOKEN}"
CURL_CONFIG
```

token 通过 curl stdin config 传递，不出现在 argv 和日志中。

- [ ] **Step 7: 运行脚本 tests 和门禁（GREEN）**

先在 test harness 的 `run()` env 中加入 `NODE_ENV: "test"`。Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm run test:release
HOME=/home/hsops/.pi-release-reliability-dev-home npm run typecheck
HOME=/home/hsops/.pi-release-reliability-dev-home npm run lint
bash -n scripts/lib/release-common.sh scripts/build-release.sh scripts/systemd-stop.sh
```

Expected: build/staging fake tests PASS；没有执行真实 build、systemctl 或生产数据操作。

- [ ] **Step 8: 提交**

```bash
git add next.config.ts scripts/lib/release-common.sh scripts/build-release.sh scripts/verify-standalone.mjs scripts/systemd-stop.sh __tests__/release/release-scripts.test.ts
git commit -m "feat: 构建并验证 standalone 发布包"
```

### Task 7: 实现一致性备份、校验、恢复和保留策略

**Files:**
- Create: `scripts/backup-production.mjs`
- Create: `scripts/restore-production-backup.sh`
- Modify: `__tests__/release/release-scripts.test.ts`

- [ ] **Step 1: 写备份 RED integration tests**

在 release test 文件增加 helper 创建最小生产 HOME：auth.db 包含 `users`、`sessions`、`user_model_preferences` 三张表和各一行；Pi agent 下创建两个 jsonl；用户目录创建一个文件。使用项目 better-sqlite3 创建 fixture，不调用 sqlite3 CLI：

```ts
async function productionHome(root: string): Promise<string> {
  const home = join(root, "home");
  mkdirSync(join(home, ".pi-web-auth"), { recursive: true });
  mkdirSync(join(home, "pi-users", "alice"), { recursive: true });
  mkdirSync(join(home, ".pi", "agent", "sessions", "fixture"), { recursive: true });
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(join(home, ".pi-web-auth", "auth.db"));
  db.exec(`
    CREATE TABLE users(username TEXT, password_hash TEXT, created_at TEXT, role TEXT, disabled INTEGER);
    CREATE TABLE sessions(token TEXT, username TEXT, expires_at INTEGER);
    CREATE TABLE user_model_preferences(username TEXT, provider TEXT, model_id TEXT, updated_at TEXT);
    INSERT INTO users VALUES('alice','hash','2026-07-13','user',0);
    INSERT INTO sessions VALUES('token','alice',9999999999999);
    INSERT INTO user_model_preferences VALUES('alice','glm','glm-5.2','2026-07-13');
  `);
  db.close();
  writeFileSync(join(home, "pi-users", "alice", "note.txt"), "hello");
  writeFileSync(join(home, ".pi", "agent", "sessions", "fixture", "one.jsonl"), "{}\n");
  writeFileSync(join(home, ".pi", "agent", "sessions", "fixture", "two.jsonl"), "{}\n");
  return home;
}

test("prepare plus finalize creates an atomic verified backup manifest", async () => {
  const root = tempRoot();
  const home = await productionHome(root);
  const backupRoot = join(root, "backups");
  const common = ["scripts/backup-production.mjs", "--home", home, "--backup-root", backupRoot, "--backup-id", "backup-1", "--release-id", "release-1", "--commit", "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86"];
  assert.equal(spawnSync(process.execPath, [common[0], "prepare", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [common[0], "finalize", ...common.slice(1)], { encoding: "utf8" }).status, 0);
  const manifest = JSON.parse(readFileSync(join(backupRoot, "backup-1", "backup.json"), "utf8"));
  assert.equal(manifest.databaseIntegrity, "ok");
  assert.equal(manifest.counts.users, 1);
  assert.equal(manifest.counts.loginSessions, 1);
  assert.equal(manifest.counts.modelPreferences, 1);
  assert.equal(manifest.counts.piJsonl, 2);
  assert.equal(JSON.stringify(manifest).includes("alice"), false);
});

test("failed validation remains incomplete and is never counted for retention", async () => {
  const root = tempRoot();
  const home = await productionHome(root);
  const backupRoot = join(root, "backups");
  const args = ["scripts/backup-production.mjs", "prepare", "--home", home, "--backup-root", backupRoot, "--backup-id", "broken", "--release-id", "release", "--commit", "05816e7fd19a35dc1b7d9f96460acb2f57e5bd86"];
  assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
  writeFileSync(join(backupRoot, ".incomplete-broken", ".pi-web-auth", "auth.db"), "corrupt");
  const result = spawnSync(process.execPath, [args[0], "finalize", ...args.slice(2)], { encoding: "utf8", env: { ...process.env, PI_WEB_SKIP_FINAL_DB_BACKUP_FOR_TEST: "1", NODE_ENV: "test" } });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(backupRoot, ".incomplete-broken", ".backup-state.json"), "utf8").includes("broken"), true);
});

test("retention keeps seven verified backups and every incomplete directory", async () => {
  const root = tempRoot();
  const backupRoot = join(root, "backups");
  mkdirSync(backupRoot, { recursive: true });
  for (let i = 1; i <= 9; i += 1) {
    const dir = join(backupRoot, `backup-${String(i).padStart(2, "0")}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "backup.json"), JSON.stringify({ backupId: `backup-${String(i).padStart(2, "0")}`, completedAt: `2026-07-${String(i).padStart(2, "0")}T00:00:00.000Z`, databaseIntegrity: "ok" }));
  }
  mkdirSync(join(backupRoot, ".incomplete-keep"));
  writeFileSync(join(backupRoot, ".incomplete-keep", ".keep"), "keep");
  const result = spawnSync(process.execPath, ["scripts/backup-production.mjs", "retention", "--backup-root", backupRoot], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(backupRoot, "backup-09", "backup.json"), "utf8").length > 0, true);
  assert.throws(() => readFileSync(join(backupRoot, "backup-01", "backup.json")));
  assert.equal(readFileSync(join(backupRoot, ".incomplete-keep", ".keep"), "utf8"), "keep");
});
```

测试创建 incomplete 时写 `.keep` 文件，避免最后一条断言读取不存在文件。Run test and expect missing script.

- [ ] **Step 2: 实现 backup-production.mjs CLI**

创建 `scripts/backup-production.mjs`。CLI 只接受 `prepare`、`finalize`、`validate`、`retention`，并使用以下完整实现：

```js
import Database from "better-sqlite3";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2];
const known = new Set(["home", "backup-root", "backup-id", "release-id", "commit"]);
function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error("arguments must be --key value pairs");
    const key = flag.slice(2);
    if (!known.has(key)) throw new Error(`unknown argument: ${flag}`);
    values[key] = value;
  }
  return values;
}

function required(value, name) {
  if (!value) throw new Error(`missing --${name}`);
  return value;
}
function assertSafeId(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`invalid ${name}`);
}
function assertCommit(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("invalid commit");
}
function fsyncDirectory(path) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeAtomicJson(path, value) {
  const temp = `${path}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  fsyncDirectory(dirname(path));
}
function runRsync(source, destination, excludes = []) {
  mkdirSync(destination, { recursive: true });
  const bin = process.env.PI_WEB_RSYNC_BIN || "rsync";
  const args = ["-a", "--delete", ...excludes.flatMap((item) => ["--exclude", item]), `${source}/`, `${destination}/`];
  const result = spawnSync(bin, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("rsync failed");
}
async function backupDatabase(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { force: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(destination); } finally { db.close(); }
}
function inspectDatabase(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const databaseIntegrity = db.pragma("integrity_check", { simple: true });
    if (databaseIntegrity !== "ok") throw new Error("database integrity check failed");
    return {
      databaseIntegrity,
      users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      loginSessions: db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,
      modelPreferences: db.prepare("SELECT COUNT(*) AS count FROM user_model_preferences").get().count,
    };
  } finally {
    db.close();
  }
}
function countFiles(root, predicate = () => true) {
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) count += countFiles(path, predicate);
    else if (entry.isFile() && predicate(path)) count += 1;
  }
  return count;
}
function pathsFor(home, backupRoot, backupId) {
  return {
    sourceAuth: join(home, ".pi-web-auth"),
    sourceUsers: join(home, "pi-users"),
    sourceAgent: join(home, ".pi", "agent"),
    incomplete: join(backupRoot, `.incomplete-${backupId}`),
    complete: join(backupRoot, backupId),
  };
}
function copyDirectories(paths) {
  runRsync(paths.sourceAuth, join(paths.incomplete, ".pi-web-auth"), ["auth.db", "auth.db-wal", "auth.db-shm"]);
  runRsync(paths.sourceUsers, join(paths.incomplete, "pi-users"));
  runRsync(paths.sourceAgent, join(paths.incomplete, ".pi", "agent"));
}
function validateDirectory(path) {
  for (const relative of [".pi-web-auth", "pi-users", join(".pi", "agent")]) {
    if (!existsSync(join(path, relative))) throw new Error("backup data directory missing");
  }
  return inspectDatabase(join(path, ".pi-web-auth", "auth.db"));
}
async function prepare(options) {
  const home = required(options.home, "home");
  const backupRoot = required(options["backup-root"], "backup-root");
  const backupId = required(options["backup-id"], "backup-id");
  const releaseId = required(options["release-id"], "release-id");
  const commit = required(options.commit, "commit");
  assertSafeId(backupId, "backup id");
  assertSafeId(releaseId, "release id");
  assertCommit(commit);
  const paths = pathsFor(home, backupRoot, backupId);
  if (existsSync(paths.incomplete) || existsSync(paths.complete)) throw new Error("backup id already exists");
  mkdirSync(paths.incomplete, { recursive: true });
  writeAtomicJson(join(paths.incomplete, ".backup-state.json"), {
    backupId, releaseId, commit, startedAt: new Date().toISOString(),
  });
  copyDirectories(paths);
  await backupDatabase(join(paths.sourceAuth, "auth.db"), join(paths.incomplete, ".pi-web-auth", "auth.db"));
  process.stdout.write(`${paths.incomplete}\n`);
}
async function finalize(options) {
  const home = required(options.home, "home");
  const backupRoot = required(options["backup-root"], "backup-root");
  const backupId = required(options["backup-id"], "backup-id");
  const releaseId = required(options["release-id"], "release-id");
  const commit = required(options.commit, "commit");
  assertSafeId(backupId, "backup id");
  assertSafeId(releaseId, "release id");
  assertCommit(commit);
  const paths = pathsFor(home, backupRoot, backupId);
  const state = JSON.parse(readFileSync(join(paths.incomplete, ".backup-state.json"), "utf8"));
  if (state.backupId !== backupId || state.releaseId !== releaseId || state.commit !== commit) throw new Error("backup state mismatch");
  copyDirectories(paths);
  const skipFinal = process.env.PI_WEB_SKIP_FINAL_DB_BACKUP_FOR_TEST === "1";
  if (skipFinal && process.env.NODE_ENV !== "test") throw new Error("test backup override is forbidden");
  if (!skipFinal) {
    await backupDatabase(join(paths.sourceAuth, "auth.db"), join(paths.incomplete, ".pi-web-auth", "auth.db"));
  }
  const database = validateDirectory(paths.incomplete);
  const manifest = {
    backupId,
    releaseId,
    commit,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    databaseIntegrity: database.databaseIntegrity,
    counts: {
      users: database.users,
      loginSessions: database.loginSessions,
      modelPreferences: database.modelPreferences,
      piJsonl: countFiles(join(paths.incomplete, ".pi", "agent"), (path) => path.endsWith(".jsonl")),
      authFiles: countFiles(join(paths.incomplete, ".pi-web-auth")),
      userFiles: countFiles(join(paths.incomplete, "pi-users")),
      agentFiles: countFiles(join(paths.incomplete, ".pi", "agent")),
    },
    dataDirectories: [".pi-web-auth", "pi-users", ".pi/agent"],
  };
  writeAtomicJson(join(paths.incomplete, "backup.json"), manifest);
  renameSync(paths.incomplete, paths.complete);
  fsyncDirectory(backupRoot);
  process.stdout.write(`${paths.complete}\n`);
}
function validate(options) {
  const backupRoot = required(options["backup-root"], "backup-root");
  const backupId = required(options["backup-id"], "backup-id");
  assertSafeId(backupId, "backup id");
  const path = join(backupRoot, backupId);
  const manifest = JSON.parse(readFileSync(join(path, "backup.json"), "utf8"));
  const database = validateDirectory(path);
  if (manifest.backupId !== backupId || manifest.databaseIntegrity !== "ok" || database.databaseIntegrity !== "ok") {
    throw new Error("backup manifest validation failed");
  }
  process.stdout.write("ok\n");
}
function retention(options) {
  const backupRoot = required(options["backup-root"], "backup-root");
  mkdirSync(backupRoot, { recursive: true });
  const verified = [];
  for (const entry of readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(backupRoot, entry.name, "backup.json"), "utf8"));
      if (manifest.backupId === entry.name && manifest.databaseIntegrity === "ok" && typeof manifest.completedAt === "string") {
        verified.push({ name: entry.name, completedAt: manifest.completedAt });
      }
    } catch {
      // Invalid directories are diagnostic evidence and are not retention candidates.
    }
  }
  verified.sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  for (const item of verified.slice(7)) rmSync(join(backupRoot, item.name), { recursive: true, force: true });
  process.stdout.write(`${Math.max(0, verified.length - 7)}\n`);
}

try {
  if (!new Set(["prepare", "finalize", "validate", "retention"]).has(command)) throw new Error("invalid backup command");
  const options = parseArgs(process.argv.slice(3));
  if (command === "prepare") await prepare(options);
  if (command === "finalize") await finalize(options);
  if (command === "validate") validate(options);
  if (command === "retention") retention(options);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "backup failed"}\n`);
  process.exitCode = 1;
}
```

所有异常只输出阶段性错误，不输出用户名、SQL 行、token 或消息内容。任何失败保留 incomplete 和 `.backup-state.json`。

- [ ] **Step 3: 实现显式数据恢复脚本**

`scripts/restore-production-backup.sh`：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_ROOT=${PI_WEB_BACKUP_ROOT:-/home/hsops/pi-web-auth-backups}
HOME_ROOT=${PI_WEB_PRODUCTION_HOME:-/home/hsops}
SYSTEMCTL_BIN=${PI_WEB_SYSTEMCTL_BIN:-systemctl}
NODE_BIN=${PI_WEB_NODE_BIN:-/home/hsops/.nvm/versions/node/v22.20.0/bin/node}
RSYNC_BIN=${PI_WEB_RSYNC_BIN:-rsync}
DRY_RUN=true
[[ "${1:-}" == "--apply" ]] && { DRY_RUN=false; shift; }
BACKUP_ID=${1:-}
[[ "$BACKUP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "invalid backup id" >&2; exit 2; }
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"

if "$SYSTEMCTL_BIN" --user is-active --quiet pi-web-auth.service; then
  echo "pi-web-auth.service must be stopped" >&2
  exit 1
fi
"$NODE_BIN" "$(dirname "$0")/backup-production.mjs" validate --backup-root "$BACKUP_ROOT" --backup-id "$BACKUP_ID"

RSYNC_ARGS=(-a --delete)
if [[ "$DRY_RUN" == true ]]; then RSYNC_ARGS+=(--dry-run --itemize-changes); fi
if [[ "$DRY_RUN" == false ]]; then
  read -r -p "Type the complete backup ID to restore: " CONFIRM
  [[ "$CONFIRM" == "$BACKUP_ID" ]] || { echo "confirmation mismatch" >&2; exit 1; }
fi
"$RSYNC_BIN" "${RSYNC_ARGS[@]}" "$BACKUP_DIR/.pi-web-auth/" "$HOME_ROOT/.pi-web-auth/"
"$RSYNC_BIN" "${RSYNC_ARGS[@]}" "$BACKUP_DIR/pi-users/" "$HOME_ROOT/pi-users/"
mkdir -p "$HOME_ROOT/.pi/agent"
"$RSYNC_BIN" "${RSYNC_ARGS[@]}" "$BACKUP_DIR/.pi/agent/" "$HOME_ROOT/.pi/agent/"
echo "$([[ "$DRY_RUN" == true ]] && echo dry-run || echo restored): $BACKUP_ID"
```

数据恢复不启动服务，也不修改 `current`/`previous`。

- [ ] **Step 4: GREEN tests**

Run:

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm run test:release
bash -n scripts/restore-production-backup.sh
HOME=/home/hsops/.pi-release-reliability-dev-home npm run typecheck
HOME=/home/hsops/.pi-release-reliability-dev-home npm run lint
```

Expected: backup manifest counts 精确、失败留 incomplete、只保留最近 7 份 verified backup，恢复脚本 syntax PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/backup-production.mjs scripts/restore-production-backup.sh __tests__/release/release-scripts.test.ts
git commit -m "feat: 增加生产数据一致性备份"
```

### Task 8: 实现 60 秒发布状态机、原子切换和自动回滚

**Files:**
- Modify: `scripts/lib/release-common.sh`
- Create: `scripts/release-production.sh`
- Modify: `__tests__/release/release-scripts.test.ts`

- [ ] **Step 1: 扩展 fake command harness 并写完整 RED 场景**

在临时 `fake-bin` 创建 `systemctl`、`curl`、`build-release`、`backup`、`now`。所有 fake 只向 `$PI_WEB_TEST_EVENTS` 追加一行，行为由 `$PI_WEB_TEST_SCENARIO` 控制。测试必须逐项断言：

```ts
function writeManifest(path: string, releaseId: string, commit: string, mtime: number): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "release.json"), JSON.stringify({
    releaseId,
    commit,
    builtAt: new Date(mtime).toISOString(),
    nodeVersion: process.version,
    appVersion: "0.6.12",
    piVersion: "0.75.5",
  }));
  const date = new Date(mtime);
  utimesSync(path, date, date);
}

function releaseFixture(scenario: string, options: { existingReleases?: number } = {}) {
  const root = tempRoot();
  const deploy = join(root, "deploy");
  const releases = join(deploy, "releases");
  const backups = join(root, "backups");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const eventsPath = join(root, "events");
  const nowPath = join(root, "now");
  const healthCountPath = join(root, "health-count");
  const envFile = join(root, "release.env");
  mkdirSync(releases, { recursive: true });
  mkdirSync(backups, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(eventsPath, "");
  writeFileSync(nowPath, "1000\n");
  writeFileSync(healthCountPath, "0\n");
  writeFileSync(envFile, "PI_WEB_RELEASE_TOKEN=test-release-token\nREGISTER_KEYWORD=test-register\n", { mode: 0o600 });

  const oldName = "20260713-120000-1111111";
  const previousName = "20260712-120000-2222222";
  const newName = "20260713-160000-3333333";
  const oldCommit = "1".repeat(40);
  const previousCommit = "2".repeat(40);
  const newCommit = "3".repeat(40);
  const oldRelease = join(releases, oldName);
  const initialPrevious = join(releases, previousName);
  const newRelease = join(releases, newName);
  writeManifest(initialPrevious, previousName, previousCommit, 1_000);
  writeManifest(oldRelease, oldName, oldCommit, 2_000);
  writeManifest(newRelease, newName, newCommit, 10_000);
  symlinkSync(oldRelease, join(deploy, "current"));
  symlinkSync(initialPrevious, join(deploy, "previous"));

  const historyNames: string[] = [];
  for (let index = 0; index < (options.existingReleases ?? 0); index += 1) {
    const name = `202607${String(index + 1).padStart(2, "0")}-010101-${String(index + 4).repeat(7).slice(0, 7)}`;
    historyNames.push(name);
    writeManifest(join(releases, name), name, String(index + 4).repeat(40).slice(0, 40), 3_000 + index * 100);
  }

  const build = join(bin, "build-release");
  executable(build, `
printf 'build\\n' >> "$PI_WEB_TEST_EVENTS"
case "$PI_WEB_TEST_SCENARIO" in verify-fails|staging-fails) exit 20;; esac
printf '%s\\n' "$PI_WEB_TEST_NEW_RELEASE"
`);
  const disk = join(bin, "disk-check");
  executable(disk, `
printf 'disk-check\\n' >> "$PI_WEB_TEST_EVENTS"
[[ "$PI_WEB_TEST_SCENARIO" != disk-full ]]
`);
  const backup = join(bin, "backup");
  executable(backup, `
command=$1
if [[ "$command" == retention ]]; then
  printf 'retention\\n' >> "$PI_WEB_TEST_EVENTS"
  exit 0
fi
printf 'backup:%s\\n' "$command" >> "$PI_WEB_TEST_EVENTS"
[[ "$PI_WEB_TEST_SCENARIO" == prebackup-fails && "$command" == prepare ]] && exit 21
[[ "$PI_WEB_TEST_SCENARIO" == final-backup-fails && "$command" == finalize ]] && exit 22
exit 0
`);
  const systemctl = join(bin, "systemctl");
  executable(systemctl, `
action=$2
current=$(readlink -f "$PI_WEB_DEPLOY_ROOT/current")
if [[ "$action" == stop ]]; then
  [[ "$current" == "$PI_WEB_TEST_NEW_RELEASE" ]] && event=stop-new || event=stop
elif [[ "$action" == start ]]; then
  [[ "$current" == "$PI_WEB_TEST_NEW_RELEASE" ]] && event=start-new || event=start-old
else
  exit 0
fi
printf '%s\\n' "$event" >> "$PI_WEB_TEST_EVENTS"
`);
  const now = join(bin, "now");
  executable(now, `cat "$PI_WEB_TEST_NOW"`);
  const sleep = join(bin, "sleep");
  executable(sleep, `
value=$(cat "$PI_WEB_TEST_NOW")
printf '%s\\n' "$((value + 1000))" > "$PI_WEB_TEST_NOW"
`);
  const curl = join(bin, "curl");
  executable(curl, `
config=$(cat)
args="$* $config"
if [[ "$args" == *'/api/internal/drain'* ]]; then
  printf 'drain\\n' >> "$PI_WEB_TEST_EVENTS"
  [[ "$PI_WEB_TEST_SCENARIO" == budget-exhausted ]] && printf '61001\\n' > "$PI_WEB_TEST_NOW"
  printf '{"state":"shutting_down","errors":[]}\\n'
  exit 0
fi
if [[ "$args" == *'/api/internal/resume'* ]]; then
  printf 'resume\\n' >> "$PI_WEB_TEST_EVENTS"
  printf '{"state":"running"}\\n'
  exit 0
fi
if [[ "$args" == *'/api/health/ready'* ]]; then
  current=$(readlink -f "$PI_WEB_DEPLOY_ROOT/current")
  if [[ "$current" == "$PI_WEB_TEST_NEW_RELEASE" ]]; then
    marker="$PI_WEB_TEST_ROOT/health-new-seen"
    [[ -e "$marker" ]] || { touch "$marker"; printf 'health-new\\n' >> "$PI_WEB_TEST_EVENTS"; }
    [[ "$PI_WEB_TEST_SCENARIO" == new-health-fails ]] && exit 22
    count=$(cat "$PI_WEB_TEST_HEALTH_COUNT")
    count=$((count + 1))
    printf '%s\\n' "$count" > "$PI_WEB_TEST_HEALTH_COUNT"
    case "$count" in 1|3) exit 22;; esac
    printf '{"status":"ready","releaseId":"%s","commit":"%s"}\\n' "$PI_WEB_TEST_NEW_ID" "$PI_WEB_TEST_NEW_COMMIT"
    exit 0
  fi
  marker="$PI_WEB_TEST_ROOT/health-old-seen"
  [[ -e "$marker" ]] || { touch "$marker"; printf 'health-old\\n' >> "$PI_WEB_TEST_EVENTS"; }
  printf '{"status":"ready","releaseId":"%s","commit":"%s"}\\n' "$PI_WEB_TEST_OLD_ID" "$PI_WEB_TEST_OLD_COMMIT"
  exit 0
fi
exit 2
`);

  let lockHolder: ReturnType<typeof spawn> | null = null;
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    HOME: home,
    PI_WEB_SOURCE_ROOT: resolve("."),
    PI_WEB_DEPLOY_ROOT: deploy,
    PI_WEB_BACKUP_ROOT: backups,
    PI_WEB_PRODUCTION_HOME: home,
    PI_WEB_RELEASE_ENV: envFile,
    PI_WEB_BUILD_RELEASE_BIN: build,
    PI_WEB_BACKUP_BIN: backup,
    PI_WEB_DISK_CHECK_BIN: disk,
    PI_WEB_SYSTEMCTL_BIN: systemctl,
    PI_WEB_CURL_BIN: curl,
    PI_WEB_NOW_BIN: now,
    PI_WEB_SLEEP_BIN: sleep,
    PI_WEB_NODE_BIN: process.execPath,
    PI_WEB_TEST_EVENTS: eventsPath,
    PI_WEB_TEST_SCENARIO: scenario,
    PI_WEB_TEST_NEW_RELEASE: newRelease,
    PI_WEB_TEST_NEW_ID: newName,
    PI_WEB_TEST_NEW_COMMIT: newCommit,
    PI_WEB_TEST_OLD_ID: oldName,
    PI_WEB_TEST_OLD_COMMIT: oldCommit,
    PI_WEB_TEST_NOW: nowPath,
    PI_WEB_TEST_HEALTH_COUNT: healthCountPath,
    PI_WEB_TEST_ROOT: root,
  };
  return {
    newRelease,
    oldRelease,
    initialPrevious,
    currentName: newName,
    previousName: oldName,
    historyNames,
    run() {
      const result = spawnSync("bash", ["scripts/release-production.sh"], { cwd: resolve("."), env: environment, encoding: "utf8" });
      lockHolder?.kill("SIGTERM");
      return result;
    },
    runWithArgs(args: string[]) {
      return spawnSync("bash", ["scripts/release-production.sh", ...args], { cwd: resolve("."), env: environment, encoding: "utf8" });
    },
    events() { return readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean); },
    currentTarget() { return realpathSync(join(deploy, "current")); },
    previousTarget() { return realpathSync(join(deploy, "previous")); },
    remainingReleaseNames() { return readdirSync(releases).sort(); },
    holdLock() {
      const ready = join(root, "lock-ready");
      lockHolder = spawn("bash", ["-c", `exec 9>${JSON.stringify(join(deploy, "release.lock"))}; flock 9; touch ${JSON.stringify(ready)}; sleep 30`], { stdio: "ignore" });
      const deadline = Date.now() + 2_000;
      while (!existsSync(ready) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      assert.equal(existsSync(ready), true);
    },
  };
}

const releaseCases = [
  ["verify-fails", ["build"], false],
  ["staging-fails", ["build"], false],
  ["disk-full", ["build", "disk-check"], false],
  ["prebackup-fails", ["build", "disk-check", "backup:prepare"], false],
  ["budget-exhausted", ["build", "disk-check", "backup:prepare", "drain", "resume"], false],
  ["final-backup-fails", ["build", "disk-check", "backup:prepare", "drain", "stop", "backup:finalize", "start-old", "health-old"], false],
  ["new-health-fails", ["build", "disk-check", "backup:prepare", "drain", "stop", "backup:finalize", "start-new", "health-new", "stop-new", "start-old", "health-old"], false],
  ["success", ["build", "disk-check", "backup:prepare", "drain", "stop", "backup:finalize", "start-new", "health-new", "retention"], true],
] as const;

for (const [scenario, expectedEvents, success] of releaseCases) {
  test(`release state machine: ${scenario}`, () => {
    const fixture = releaseFixture(scenario);
    const result = fixture.run();
    assert.equal(result.status === 0, success);
    assert.deepEqual(fixture.events(), expectedEvents);
    assert.equal(fixture.currentTarget(), success ? fixture.newRelease : fixture.oldRelease);
    assert.equal(fixture.previousTarget(), success ? fixture.oldRelease : fixture.initialPrevious);
  });
}
```

再加：

```ts
test("a concurrent release fails before build", () => {
  const fixture = releaseFixture("success");
  fixture.holdLock();
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.deepEqual(fixture.events(), []);
});

test("normal releases reject the one-time legacy migration flags", () => {
  const fixture = releaseFixture("success");
  const result = fixture.runWithArgs(["--allow-legacy-stop"]);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fixture.events(), []);
});

test("release retention preserves current and previous and keeps four total", () => {
  const fixture = releaseFixture("success", { existingReleases: 6 });
  assert.equal(fixture.run().status, 0);
  assert.deepEqual(fixture.remainingReleaseNames(), [
    fixture.currentName,
    fixture.previousName,
    fixture.historyNames.at(-1),
    fixture.historyNames.at(-2),
  ].sort());
});
```

Run tests and expect missing release script.

- [ ] **Step 2: 给 release-common 增加预算和健康原语**

追加：

```bash
begin_outage_budget() {
  OUTAGE_STARTED_MS=$(now_ms)
  OUTAGE_DEADLINE_MS=$((OUTAGE_STARTED_MS + 60000))
  export OUTAGE_STARTED_MS OUTAGE_DEADLINE_MS
}
remaining_budget_ms() {
  local now
  now=$(now_ms)
  printf '%s\n' "$((OUTAGE_DEADLINE_MS - now))"
}
require_budget() {
  local phase=$1 minimum_ms=${2:-1} remaining
  remaining=$(remaining_budget_ms)
  (( remaining >= minimum_ms )) || die "60 second outage budget exhausted before $phase"
}
run_with_budget() {
  local phase=$1
  shift
  require_budget "$phase" 1
  local remaining seconds
  remaining=$(remaining_budget_ms)
  seconds=$(awk -v ms="$remaining" 'BEGIN { printf "%.3f", ms / 1000 }')
  timeout --foreground "${seconds}s" "$@"
}
preflight_disk_space() {
  if [[ -n "${PI_WEB_DISK_CHECK_BIN:-}" ]]; then
    "$PI_WEB_DISK_CHECK_BIN" "$PRODUCTION_HOME" "$BACKUP_ROOT"
    return
  fi
  mkdir -p "$BACKUP_ROOT"
  local required available
  required=$(du -sb \
    "$PRODUCTION_HOME/.pi-web-auth" \
    "$PRODUCTION_HOME/pi-users" \
    "$PRODUCTION_HOME/.pi/agent" | awk '{ total += $1 } END { print total }')
  available=$(df -PB1 "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')
  [[ "$required" =~ ^[0-9]+$ && "$available" =~ ^[0-9]+$ ]] || die "disk preflight returned invalid values"
  (( available >= required + required / 10 )) || die "insufficient space for verified backup"
}
release_token_curl() {
  local endpoint=$1 max_time=$2
  "$CURL_BIN" --config - <<CURL_CONFIG
silent
show-error
fail-with-body
max-time = $max_time
request = "POST"
url = "http://127.0.0.1:8000$endpoint"
header = "Authorization: Bearer ${PI_WEB_RELEASE_TOKEN}"
CURL_CONFIG
}
wait_ready() {
  local expected_release=$1 expected_commit=$2 timeout_seconds=$3
  local deadline=$(( $(now_ms) + timeout_seconds * 1000 )) consecutive=0 body
  while (( $(now_ms) < deadline )); do
    if body=$($CURL_BIN -fsS --max-time 2 http://127.0.0.1:8000/api/health/ready) && \
       printf '%s' "$body" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const [r,c]=process.argv.slice(1);const v=JSON.parse(s);process.exit(v.status==="ready"&&v.releaseId===r&&v.commit===c?0:1)})' "$expected_release" "$expected_commit"; then
      consecutive=$((consecutive + 1))
      (( consecutive >= 3 )) && return 0
    else
      consecutive=0
    fi
    "$SLEEP_BIN" 1
  done
  return 1
}
prune_releases() {
  local current previous
  current=$(readlink -f "$DEPLOY_ROOT/current")
  previous=$(readlink -f "$DEPLOY_ROOT/previous" 2>/dev/null || true)
  mapfile -t candidates < <(find "$DEPLOY_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
  declare -A keep=()
  [[ -n "$current" && -f "$current/release.json" ]] && keep["$current"]=1
  [[ -n "$previous" && -f "$previous/release.json" ]] && keep["$previous"]=1
  local path
  for path in "${candidates[@]}"; do
    [[ -f "$path/release.json" ]] || continue
    (( ${#keep[@]} >= 4 )) && break
    keep["$path"]=1
  done
  for path in "${candidates[@]}"; do
    [[ -f "$path/release.json" ]] || continue
    [[ -n "${keep[$path]:-}" ]] || rm -rf --one-file-system "$path"
  done
}
```

`prune_releases` 的 protected set 中 current/previous 都占总数，再补最新 release 到总计 4 个。没有 `release.json` 的目录和 staging 不删除。

- [ ] **Step 3: 实现 release-production.sh**

创建 `scripts/release-production.sh`。环境覆盖只用于 test harness；生产默认路径来自 common：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/release-common.sh"

ENV_FILE=${PI_WEB_RELEASE_ENV:-/home/hsops/.config/pi-web-auth/release.env}
PRODUCTION_HOME=${PI_WEB_PRODUCTION_HOME:-/home/hsops}
BUILD_RELEASE_BIN=${PI_WEB_BUILD_RELEASE_BIN:-$SCRIPT_DIR/build-release.sh}
BACKUP_SCRIPT=${PI_WEB_BACKUP_SCRIPT:-$SCRIPT_DIR/backup-production.mjs}

service_stopped=false
previous_switched=false
links_switched=false
drain_started=false
release_succeeded=false
old_current=""
old_previous=""
old_release_id=""
old_commit=""
new_release=""
commit=""

if [[ -n "${PI_WEB_BACKUP_BIN:-}" ]]; then
  BACKUP_COMMAND=("$PI_WEB_BACKUP_BIN")
else
  BACKUP_COMMAND=("$NODE_BIN" "$BACKUP_SCRIPT")
fi
backup_command() {
  "${BACKUP_COMMAND[@]}" "$@"
}

read_manifest() {
  "$NODE_BIN" -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(typeof value.releaseId!=="string" || typeof value.commit!=="string" || !/^[0-9a-f]{40}$/.test(value.commit)) process.exit(2);
    process.stdout.write(`${value.releaseId}\n${value.commit}\n`);
  ' "$1/release.json"
}

restore_previous_link() {
  if [[ -n "$old_previous" ]]; then
    atomic_symlink "$old_previous" "$DEPLOY_ROOT/previous"
  else
    rm -f "$DEPLOY_ROOT/previous"
  fi
}

recover_failed_release() {
  local status=$1 recovery_started recovery_elapsed
  [[ "$status" -ne 0 && "$release_succeeded" != true ]] || return 0
  set +e
  recovery_started=$(now_ms)
  if [[ "$links_switched" == true ]]; then
    json_log rollback start 0 "restore-previous"
    "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
    atomic_symlink "$old_current" "$DEPLOY_ROOT/current"
    restore_previous_link
    "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
    if wait_ready "$old_release_id" "$old_commit" 30; then
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log rollback success "$recovery_elapsed" "previous-ready"
    else
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log rollback critical "$recovery_elapsed" "previous-not-ready"
      printf 'CRITICAL: new and previous releases are not ready; preserve releases, backup, and log\n' >&2
    fi
  elif [[ "$service_stopped" == true ]]; then
    [[ "$previous_switched" == true ]] && restore_previous_link
    "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
    if wait_ready "$old_release_id" "$old_commit" 30; then
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log recovery success "$recovery_elapsed" "old-service-ready"
    else
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log recovery critical "$recovery_elapsed" "old-service-not-ready"
    fi
  elif [[ "$drain_started" == true ]]; then
    if release_token_curl /api/internal/resume 5 >/dev/null; then
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log resume success "$recovery_elapsed" "old-process-running"
    else
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log resume failed "$recovery_elapsed" "manual-check-required"
    fi
  fi
  set -e
}
trap 'recover_failed_release $?' EXIT

main() {
  [[ $# -eq 0 ]] || die "release-production.sh does not accept legacy migration arguments"
  acquire_release_lock
  [[ -r "$ENV_FILE" ]] || die "release environment is unreadable"
  [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || die "release environment must have mode 600"
  set -a
  source "$ENV_FILE"
  set +a
  [[ -n "${PI_WEB_RELEASE_TOKEN:-}" && -n "${REGISTER_KEYWORD:-}" ]] || die "release environment is incomplete"

  mkdir -p "$DEPLOY_ROOT/logs" "$DEPLOY_ROOT/releases" "$BACKUP_ROOT"
  RELEASE_ID="pending-$$"
  RELEASE_LOG="$DEPLOY_ROOT/logs/$RELEASE_ID.log"
  export RELEASE_ID RELEASE_LOG PRODUCTION_HOME
  local phase_started
  phase_started=$(now_ms)
  new_release=$("$BUILD_RELEASE_BIN")
  new_release=$(readlink -f "$new_release")
  [[ "$new_release" == "$DEPLOY_ROOT/releases/"* ]] || die "build returned a release outside deploy root"
  mapfile -t new_manifest < <(read_manifest "$new_release")
  [[ ${#new_manifest[@]} -eq 2 ]] || die "new release manifest is invalid"
  RELEASE_ID=${new_manifest[0]}
  commit=${new_manifest[1]}
  mv "$RELEASE_LOG" "$DEPLOY_ROOT/logs/$RELEASE_ID.log" 2>/dev/null || true
  RELEASE_LOG="$DEPLOY_ROOT/logs/$RELEASE_ID.log"
  export RELEASE_ID RELEASE_LOG
  json_log build success "$(( $(now_ms) - phase_started ))" "staging-verified"

  old_current=$(readlink -f "$DEPLOY_ROOT/current")
  [[ "$old_current" == "$DEPLOY_ROOT/releases/"* ]] || die "current is not a managed release"
  mapfile -t old_manifest < <(read_manifest "$old_current")
  [[ ${#old_manifest[@]} -eq 2 ]] || die "current release manifest is invalid"
  old_release_id=${old_manifest[0]}
  old_commit=${old_manifest[1]}
  old_previous=$(readlink -f "$DEPLOY_ROOT/previous" 2>/dev/null || true)

  phase_started=$(now_ms)
  preflight_disk_space
  json_log disk-check success "$(( $(now_ms) - phase_started ))" "space-available"
  phase_started=$(now_ms)
  backup_command prepare \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$RELEASE_ID" \
    --release-id "$RELEASE_ID" \
    --commit "$commit" >/dev/null
  json_log pre-backup success "$(( $(now_ms) - phase_started ))" "online-copy-complete"

  begin_outage_budget
  drain_started=true
  phase_started=$(now_ms)
  release_token_curl /api/internal/drain 35 >/dev/null
  json_log drain success "$(( $(now_ms) - phase_started ))" "sessions-drained"

  require_budget stop 10000
  phase_started=$(now_ms)
  service_stopped=true
  run_with_budget stop "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
  json_log stop success "$(( $(now_ms) - phase_started ))" "old-service-stopped"

  require_budget finalize-backup 3000
  phase_started=$(now_ms)
  run_with_budget finalize-backup \
    "${BACKUP_COMMAND[@]}" finalize \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$RELEASE_ID" \
    --release-id "$RELEASE_ID" \
    --commit "$commit" >/dev/null
  json_log finalize-backup success "$(( $(now_ms) - phase_started ))" "verified"
  require_budget switch 1

  phase_started=$(now_ms)
  atomic_symlink "$old_current" "$DEPLOY_ROOT/previous"
  previous_switched=true
  atomic_symlink "$new_release" "$DEPLOY_ROOT/current"
  links_switched=true
  json_log symlink-switch success "$(( $(now_ms) - phase_started ))" "current-updated"

  phase_started=$(now_ms)
  "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
  json_log start success "$(( $(now_ms) - phase_started ))" "new-service-started"
  phase_started=$(now_ms)
  wait_ready "$RELEASE_ID" "$commit" 30
  json_log health-check success "$(( $(now_ms) - phase_started ))" "three-consecutive-ready"
  release_succeeded=true

  phase_started=$(now_ms)
  if backup_command retention --backup-root "$BACKUP_ROOT" >/dev/null && prune_releases; then
    json_log retention success "$(( $(now_ms) - phase_started ))" "policy-applied"
  else
    json_log retention warning "$(( $(now_ms) - phase_started ))" "manual-cleanup-required"
  fi
  printf 'released %s (%s)\n' "$RELEASE_ID" "$commit"
}

main "$@"
```

`BACKUP_COMMAND` 数组保证 prepare/finalize 使用同一个实现且不使用 `eval`。只有“新版本 ready 连续 3 次成功”之后执行 retention；retention 失败只记录 warning，不回滚已经健康的新 release。

日志固定到 `DEPLOY_ROOT/logs/RELEASE_ID.log`；禁止 `set -x`。日志 detail 只使用 controlled status，不记录 curl body、token、cookie、request body 或用户名。

- [ ] **Step 4: 修复 fake harness 以验证连续三次 ready**

fake curl 在 `success` 场景依次返回 `503, 200, 503, 200, 200, 200`，断言只有最后三个连续 200 才成功；在 `new-health-fails` 场景新 release 始终 503，切回 old 后连续三个匹配 old identity 的 200。

60 秒 fake clock 场景让 drain 后 now 从 1000 跳到 61001，断言 `systemctl stop` 未执行、links 不变、resume 被调用。final backup failure 场景断言 current/previous 都未修改，旧服务被重启。

- [ ] **Step 5: 运行完整 release tests（GREEN）**

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm run test:release
bash -n scripts/lib/release-common.sh scripts/release-production.sh
HOME=/home/hsops/.pi-release-reliability-dev-home npm run verify
```

Expected: 所有状态机场景 PASS；`npm run verify` 第一次在本分支完整执行 auth + release + UI tests，无过滤通过。

- [ ] **Step 6: 提交**

```bash
git add scripts/lib/release-common.sh scripts/release-production.sh __tests__/release/release-scripts.test.ts
git commit -m "feat: 增加原子发布与自动回滚"
```

### Task 9: 配置 standalone systemd 和首次迁移回滚

**Files:**
- Create: `systemd/pi-web-auth.service`
- Create: `scripts/migrate-first-release.sh`
- Modify: `__tests__/release/release-scripts.test.ts`

- [ ] **Step 1: 写 systemd 和首次迁移 RED tests**

先增加首次迁移 fixture；它创建真实临时 Git source 和 legacy `.next`，但 systemctl、curl、backup、时钟均为 fake：

```ts
function firstMigrationFixture(scenario: "new-health-fails") {
  const root = tempRoot();
  const source = join(root, "source");
  const deploy = join(root, "deploy");
  const releaseId = "20260713-170000-4444444";
  const commit = "4".repeat(40);
  const release = join(deploy, "releases", releaseId);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const installedUnit = join(root, "systemd", "pi-web-auth.service");
  const envFile = join(root, "release.env");
  const eventsPath = join(root, "events");
  const nowPath = join(root, "now");
  mkdirSync(join(source, ".next"), { recursive: true });
  mkdirSync(join(home, ".pi-web-auth"), { recursive: true });
  mkdirSync(join(home, "pi-users"), { recursive: true });
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  mkdirSync(dirname(installedUnit), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(source, "tracked.txt"), "source\n");
  writeFileSync(join(source, ".next", "build.txt"), "legacy-build\n");
  for (const args of [["init"], ["config", "user.email", "release@test"], ["config", "user.name", "Release Test"], ["add", "tracked.txt"], ["commit", "-m", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  writeManifest(release, releaseId, commit, 10_000);
  mkdirSync(join(release, "scripts"), { recursive: true });
  writeFileSync(join(release, "server.js"), "// fixture\n");
  writeFileSync(installedUnit, `[Service]\nWorkingDirectory=${source}\nEnvironment=REGISTER_KEYWORD=legacy-key\n`);
  writeFileSync(eventsPath, "");
  writeFileSync(nowPath, "1000\n");

  const disk = join(bin, "disk-check");
  executable(disk, `printf 'disk-check\\n' >> "$PI_WEB_TEST_EVENTS"`);
  const backup = join(bin, "backup");
  executable(backup, `printf 'backup:%s\\n' "$1" >> "$PI_WEB_TEST_EVENTS"`);
  const openssl = join(bin, "openssl");
  executable(openssl, `printf '%064d\\n' 0`);
  const now = join(bin, "now");
  executable(now, `cat "$PI_WEB_TEST_NOW"`);
  const sleep = join(bin, "sleep");
  executable(sleep, `value=$(cat "$PI_WEB_TEST_NOW"); printf '%s\\n' "$((value + 1000))" > "$PI_WEB_TEST_NOW"`);
  const systemctl = join(bin, "systemctl");
  executable(systemctl, `
action=$2
if [[ "$action" == daemon-reload ]]; then printf 'daemon-reload\\n' >> "$PI_WEB_TEST_EVENTS"; exit 0; fi
if grep -q 'pi-web-auth-deploy/current' "$PI_WEB_TEST_INSTALLED_UNIT"; then mode=new; else mode=old; fi
printf '%s-%s\\n' "$action" "$mode" >> "$PI_WEB_TEST_EVENTS"
`);
  const curl = join(bin, "curl");
  executable(curl, `
config=$(cat); args="$* $config"
if [[ "$args" == *'/api/internal/drain'* ]]; then printf 'drain\\n' >> "$PI_WEB_TEST_EVENTS"; printf '{}\\n'; exit 0; fi
if [[ "$args" == *'/api/internal/resume'* ]]; then printf 'resume\\n' >> "$PI_WEB_TEST_EVENTS"; exit 0; fi
if [[ "$args" == *'/api/health/ready'* ]]; then
  [[ -e "$PI_WEB_TEST_ROOT/health-seen" ]] || { touch "$PI_WEB_TEST_ROOT/health-seen"; printf 'health-new\\n' >> "$PI_WEB_TEST_EVENTS"; }
  exit 22
fi
if [[ "$args" == *'/login'* ]]; then printf 'login-old\\n' >> "$PI_WEB_TEST_EVENTS"; printf '<html></html>\\n'; exit 0; fi
exit 2
`);

  const environment = {
    ...process.env,
    NODE_ENV: "test",
    HOME: home,
    PI_WEB_SOURCE_ROOT: source,
    PI_WEB_DEPLOY_ROOT: deploy,
    PI_WEB_BACKUP_ROOT: join(root, "backups"),
    PI_WEB_PRODUCTION_HOME: home,
    PI_WEB_INSTALLED_UNIT: installedUnit,
    PI_WEB_UNIT_TEMPLATE: resolve("systemd/pi-web-auth.service"),
    PI_WEB_RELEASE_ENV: envFile,
    PI_WEB_LEGACY_NEXT: join(source, ".next"),
    PI_WEB_MIGRATION_ROOT: join(deploy, "migration"),
    PI_WEB_BACKUP_BIN: backup,
    PI_WEB_DISK_CHECK_BIN: disk,
    PI_WEB_OPENSSL_BIN: openssl,
    PI_WEB_SYSTEMCTL_BIN: systemctl,
    PI_WEB_CURL_BIN: curl,
    PI_WEB_NOW_BIN: now,
    PI_WEB_SLEEP_BIN: sleep,
    PI_WEB_NODE_BIN: process.execPath,
    PI_WEB_TEST_EVENTS: eventsPath,
    PI_WEB_TEST_NOW: nowPath,
    PI_WEB_TEST_INSTALLED_UNIT: installedUnit,
    PI_WEB_TEST_ROOT: root,
  };
  return {
    installedUnit,
    hashLegacyNext: () => readFileSync(join(source, ".next", "build.txt"), "utf8"),
    events: () => readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean),
    run: () => spawnSync("bash", [
      "scripts/migrate-first-release.sh",
      "--release", release,
      "--allow-legacy-stop",
      "--confirm-no-active-replies", releaseId,
    ], { cwd: resolve("."), env: environment, encoding: "utf8" }),
    runWithoutConfirmation: () => spawnSync("bash", [
      "scripts/migrate-first-release.sh",
      "--release", release,
    ], { cwd: resolve("."), env: environment, encoding: "utf8" }),
  };
}
```

`dirname` 需加入 `node:path` import。然后追加静态 unit 断言：

```ts
test("standalone unit preserves production environment and stop guards", () => {
  const unit = readFileSync("systemd/pi-web-auth.service", "utf8");
  assert.match(unit, /WorkingDirectory=\/home\/hsops\/pi-web-auth-deploy\/current/);
  assert.match(unit, /EnvironmentFile=\/home\/hsops\/\.config\/pi-web-auth\/release\.env/);
  assert.match(unit, /Environment=HOME=\/home\/hsops/);
  assert.match(unit, /Environment=PORT=8000/);
  assert.match(unit, /Environment=HOSTNAME=0\.0\.0\.0/);
  assert.match(unit, /ExecStart=.*node \/home\/hsops\/pi-web-auth-deploy\/current\/server\.js/);
  assert.match(unit, /ExecStop=.*current\/scripts\/systemd-stop\.sh/);
  assert.match(unit, /TimeoutStopSec=65/);
});

test("first migration failure restores the original unit and legacy next", () => {
  const fixture = firstMigrationFixture("new-health-fails");
  const beforeUnit = readFileSync(fixture.installedUnit, "utf8");
  const beforeNext = fixture.hashLegacyNext();
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(fixture.installedUnit, "utf8"), beforeUnit);
  assert.equal(fixture.hashLegacyNext(), beforeNext);
  assert.deepEqual(fixture.events(), [
    "disk-check",
    "backup:prepare",
    "stop-old",
    "backup:finalize",
    "daemon-reload",
    "start-new",
    "health-new",
    "stop-new",
    "daemon-reload",
    "start-old",
    "login-old",
  ]);
});

test("first migration refuses to stop legacy without both explicit confirmations", () => {
  const fixture = firstMigrationFixture("new-health-fails");
  const result = fixture.runWithoutConfirmation();
  assert.notEqual(result.status, 0);
  assert.deepEqual(fixture.events(), []);
});
```

Run tests; expect missing files.

- [ ] **Step 2: 创建 standalone unit 模板**

`systemd/pi-web-auth.service`：

```ini
[Unit]
Description=Pi Agent Web (standalone release, 8000)
After=network-online.target
Wants=network-online.target

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
KillSignal=SIGTERM
TimeoutStopSec=65
SyslogIdentifier=pi-web-auth

[Install]
WantedBy=default.target
```

`REGISTER_KEYWORD` 和 `PI_WEB_RELEASE_TOKEN` 只来自 mode 0600 的 `release.env`，不硬编码进版本库 unit。

- [ ] **Step 3: 实现 migrate-first-release.sh**

创建 `scripts/migrate-first-release.sh`。60 秒预算在调用 legacy stop 前开始；legacy `.next`
复制、在线预备份都在此之前完成，脚本不调用旧进程不存在的 drain API：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/release-common.sh"

PRODUCTION_HOME=${PI_WEB_PRODUCTION_HOME:-/home/hsops}
INSTALLED_UNIT=${PI_WEB_INSTALLED_UNIT:-/home/hsops/.config/systemd/user/pi-web-auth.service}
UNIT_TEMPLATE=${PI_WEB_UNIT_TEMPLATE:-$SOURCE_ROOT/systemd/pi-web-auth.service}
ENV_FILE=${PI_WEB_RELEASE_ENV:-/home/hsops/.config/pi-web-auth/release.env}
LEGACY_NEXT=${PI_WEB_LEGACY_NEXT:-$SOURCE_ROOT/.next}
MIGRATION_ROOT=${PI_WEB_MIGRATION_ROOT:-$DEPLOY_ROOT/migration}
BACKUP_SCRIPT=${PI_WEB_BACKUP_SCRIPT:-$SCRIPT_DIR/backup-production.mjs}
OPENSSL_BIN=${PI_WEB_OPENSSL_BIN:-openssl}

if [[ -n "${PI_WEB_BACKUP_BIN:-}" ]]; then
  BACKUP_COMMAND=("$PI_WEB_BACKUP_BIN")
else
  BACKUP_COMMAND=("$NODE_BIN" "$BACKUP_SCRIPT")
fi

release_path=""
service_stopped=false
migration_succeeded=false
legacy_backup=""
release_id=""
commit=""
allow_legacy_stop=false
confirmed_release=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) release_path=${2:-}; shift 2 ;;
    --allow-legacy-stop) allow_legacy_stop=true; shift ;;
    --confirm-no-active-replies) confirmed_release=${2:-}; shift 2 ;;
    *) die "usage: migrate-first-release.sh --release <directory> --allow-legacy-stop --confirm-no-active-replies <release-id>" ;;
  esac
done
[[ -n "$release_path" ]] || die "--release is required"
release_path=$(readlink -f "$release_path")

read_manifest() {
  "$NODE_BIN" -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(typeof value.releaseId!=="string" || typeof value.commit!=="string" || !/^[0-9a-f]{40}$/.test(value.commit)) process.exit(2);
    process.stdout.write(`${value.releaseId}\n${value.commit}\n`);
  ' "$1/release.json"
}

recover_legacy() {
  local status=$1 failed_next
  [[ "$status" -ne 0 && "$migration_succeeded" != true ]] || return 0
  set +e
  if [[ "$service_stopped" == true ]]; then
    "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
    cp "$legacy_backup/original.service" "$INSTALLED_UNIT"
    if [[ -e "$LEGACY_NEXT" ]]; then
      failed_next="${LEGACY_NEXT}.failed-$(date -u +%Y%m%d-%H%M%S)"
      mv "$LEGACY_NEXT" "$failed_next"
    fi
    cp -a --reflink=auto "$legacy_backup/legacy-next" "$LEGACY_NEXT"
    "$SYSTEMCTL_BIN" --user daemon-reload
    "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
    if "$CURL_BIN" -fsS --max-time 30 http://127.0.0.1:8000/login >/dev/null; then
      json_log legacy-rollback success 0 "source-service-ready"
    else
      json_log legacy-rollback critical 0 "source-service-not-ready"
    fi
  fi
  set -e
}
trap 'recover_legacy $?' EXIT

main() {
  acquire_release_lock
  [[ "$release_path" == "$DEPLOY_ROOT/releases/"* ]] || die "release is outside managed release root"
  mapfile -t manifest < <(read_manifest "$release_path")
  [[ ${#manifest[@]} -eq 2 ]] || die "release manifest is invalid"
  release_id=${manifest[0]}
  commit=${manifest[1]}
  [[ "$allow_legacy_stop" == true ]] || die "first migration requires --allow-legacy-stop"
  [[ "$confirmed_release" == "$release_id" ]] || die "active-reply confirmation must equal the target release id"
  RELEASE_ID=$release_id
  RELEASE_LOG="$DEPLOY_ROOT/logs/$RELEASE_ID.log"
  export RELEASE_ID RELEASE_LOG PRODUCTION_HOME
  mkdir -p "$DEPLOY_ROOT/logs" "$MIGRATION_ROOT" "$(dirname "$INSTALLED_UNIT")" "$(dirname "$ENV_FILE")"

  [[ -f "$INSTALLED_UNIT" ]] || die "legacy unit is missing"
  grep -Fq "WorkingDirectory=$SOURCE_ROOT" "$INSTALLED_UNIT" || die "installed unit is not the legacy source unit"
  [[ -d "$LEGACY_NEXT" ]] || die "legacy .next is missing"
  legacy_backup="$MIGRATION_ROOT/legacy-$(date -u +%Y%m%d-%H%M%S)"
  mkdir -p "$legacy_backup"
  cp "$INSTALLED_UNIT" "$legacy_backup/original.service"
  git -C "$SOURCE_ROOT" rev-parse HEAD > "$legacy_backup/source-commit"
  cp -a --reflink=auto "$LEGACY_NEXT" "$legacy_backup/legacy-next"
  json_log legacy-backup success 0 "unit-and-next-copied"

  if [[ ! -e "$ENV_FILE" ]]; then
    local register_keyword token
    register_keyword=$(sed -n 's/^Environment=REGISTER_KEYWORD=//p' "$INSTALLED_UNIT" | tail -n 1)
    [[ -n "$register_keyword" ]] || die "legacy REGISTER_KEYWORD is missing"
    token=$($OPENSSL_BIN rand -hex 32)
    [[ "$token" =~ ^[0-9a-f]{64}$ ]] || die "release token generation failed"
    printf 'PI_WEB_RELEASE_TOKEN=%s\nREGISTER_KEYWORD=%s\n' "$token" "$register_keyword" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || die "release environment must have mode 600"
  set -a
  source "$ENV_FILE"
  set +a
  [[ -n "${PI_WEB_RELEASE_TOKEN:-}" && -n "${REGISTER_KEYWORD:-}" ]] || die "release environment is incomplete"

  preflight_disk_space
  "${BACKUP_COMMAND[@]}" prepare \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$release_id" \
    --release-id "$release_id" \
    --commit "$commit" >/dev/null

  begin_outage_budget
  require_budget legacy-stop 10000
  local legacy_stop_started
  legacy_stop_started=$(now_ms)
  service_stopped=true
  run_with_budget legacy-stop "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
  json_log legacy_stop success "$(( $(now_ms) - legacy_stop_started ))" "drain-unavailable-one-time-exception"
  require_budget finalize-backup 3000
  run_with_budget finalize-backup \
    "${BACKUP_COMMAND[@]}" finalize \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$release_id" \
    --release-id "$release_id" \
    --commit "$commit" >/dev/null
  require_budget first-switch 1

  atomic_symlink "$release_path" "$DEPLOY_ROOT/current"
  install -m 0644 "$UNIT_TEMPLATE" "$INSTALLED_UNIT"
  "$SYSTEMCTL_BIN" --user daemon-reload
  "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
  wait_ready "$release_id" "$commit" 30

  "$NODE_BIN" -e '
    const fs=require("node:fs"), path=require("node:path");
    const [target,legacyBackup]=process.argv.slice(1);
    const temp=`${target}.tmp`;
    fs.writeFileSync(temp,JSON.stringify({legacyBackup:path.basename(legacyBackup),standaloneSuccesses:1,rollbackDrillPassed:false},null,2)+"\n",{mode:0o600});
    fs.renameSync(temp,target);
  ' "$MIGRATION_ROOT/status.json" "$legacy_backup"
  migration_succeeded=true
  json_log first-migration success "$(( $(now_ms) - OUTAGE_STARTED_MS ))" "standalone-ready"
  printf 'migrated %s (%s)\n' "$release_id" "$commit"
}

main "$@"
```

脚本永不自动删除 migration 目录。运维文档规定只有 `standaloneSuccesses >= 2` 且 `rollbackDrillPassed=true` 才允许人工清理。

在 `scripts/release-production.sh` 增加并在新版本 ready 后调用：

```bash
record_standalone_success() {
  local status_file="$DEPLOY_ROOT/migration/status.json"
  [[ -f "$status_file" ]] || return 0
  "$NODE_BIN" -e '
    const fs=require("node:fs");
    const path=process.argv[1], value=JSON.parse(fs.readFileSync(path,"utf8"));
    value.standaloneSuccesses=Number(value.standaloneSuccesses||0)+1;
    const temp=`${path}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+"\n",{mode:0o600});
    fs.renameSync(temp,path);
  ' "$status_file"
}
```

调用失败只写 `migration-status warning`，不回滚已经 ready 的新版本。

- [ ] **Step 4: 增加直接 systemctl stop 测试协议**

release integration fake 增加 standalone ExecStop 场景：第一次 drain API 返回完成，随后 SIGTERM
路径再次调用同一个 lifecycle result，fake session shutdown count 仍为 1。应用层由 Task 2
幂等 test 保证，脚本层断言 `systemd-stop.sh` 只调用 `/api/internal/drain`，max-time 为 60；
unit `TimeoutStopSec=65`。该测试在首次 legacy stop 之后适用。

- [ ] **Step 5: GREEN tests 和门禁**

```bash
HOME=/home/hsops/.pi-release-reliability-dev-home npm run test:release
bash -n scripts/migrate-first-release.sh scripts/systemd-stop.sh
HOME=/home/hsops/.pi-release-reliability-dev-home npm run verify
```

Expected: unit 静态断言、首次迁移缺少确认时 fail-closed、迁移路径不调用 drain、失败恢复、
standalone 幂等 stop 测试和完整门禁全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add systemd/pi-web-auth.service scripts/migrate-first-release.sh scripts/release-production.sh __tests__/release/release-scripts.test.ts
git commit -m "feat: 支持 standalone 首次生产迁移"
```

### Task 10: 完成运维文档、开发约束和隔离验收

**Files:**
- Create: `docs/operations/production-release.md`
- Create: `docs/operations/production-rollback.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 写 production release runbook**

`docs/operations/production-release.md` 必须按实际命令写清：

```bash
# 开发验收后，在生产 main 合并但尚未停服务
cd /home/hsops/pi-web-auth
git status --short --branch
HOME=/home/hsops npm ci
HOME=/home/hsops npm run verify

# 构建脚本会在 detached worktree npm ci/build/staging verify，不影响 8000
sudo -u hsops /home/hsops/pi-web-auth/scripts/build-release.sh

# 首次迁移（明确批准后）
RELEASE_ID=<release-id>
/home/hsops/pi-web-auth/scripts/migrate-first-release.sh \
  --release "/home/hsops/pi-web-auth-deploy/releases/$RELEASE_ID" \
  --allow-legacy-stop \
  --confirm-no-active-replies "$RELEASE_ID"

# 后续普通发布
/home/hsops/pi-web-auth/scripts/release-production.sh
```

文档明确：build/staging/prebackup 不计入 60 秒；普通发布从 drain 请求开始，到 stop + final
rsync + final SQLite snapshot + validate 完成为 60 秒；新版本 ready 为独立 30 秒；失败自动
回滚 previous，但不自动恢复用户数据。首次迁移单独说明：维护窗口从确认无活跃回复开始，
旧进程不具备 drain；60 秒从 `legacy_stop` 前开始，且该例外只允许使用一次。

列出发布后检查命令：

```bash
readlink -f /home/hsops/pi-web-auth-deploy/current
readlink -f /home/hsops/pi-web-auth-deploy/previous
systemctl --user status pi-web-auth.service --no-pager
curl -fsS http://127.0.0.1:8000/api/health/ready
find /home/hsops/pi-web-auth-backups -mindepth 1 -maxdepth 1 -type d -name '[!.]*' | wc -l
```

以及用户数、登录 session 数、模型偏好数、Pi jsonl 数与 `backup.json` 对比的方法；SQL 只输出 count，不输出用户记录。

- [ ] **Step 2: 写 rollback/restore runbook**

`docs/operations/production-rollback.md` 分开写：

- 程序回滚：停止服务、验证 previous manifest、原子交换 current/previous、启动、连续三次 ready；不触碰数据。
- 自动回滚失败：保留 release/backup/log，恢复 legacy unit（首次迁移）或手工指向已知健康 release。
- 数据恢复：先停止服务，先运行默认 dry-run，再用 `--apply <backup-id>` 并输入完整 ID，恢复后先 validate/count，再启动服务。
- 严重故障：previous 也不 ready 时禁止 retention 和清理，记录 current/previous 目标及 journal，但不得把 release token 输出到工单。

- [ ] **Step 3: 更新 AGENTS.md 发布规则**

替换开头旧的“停止服务后在源码工作树 npm run build”段落，至少写入：

```markdown
## Production Release

- Production runs the immutable standalone release at `/home/hsops/pi-web-auth-deploy/current`; it must not run `.next` from the source worktree.
- Keep `/home/hsops/pi-web-auth` on clean `main`. A release build uses a temporary detached worktree, runs `npm ci`, `npm run verify`, standalone build, and isolated staging verification before production drain.
- Normal publish: feature tests -> non-8000 user acceptance -> merge to `main` -> standalone build/staging verification -> online pre-backup -> explicit production approval -> `scripts/release-production.sh`.
- The 60-second outage budget starts when drain is requested and includes draining, stopping, final rsync, final SQLite backup, and validation. The new release has a separate 30-second ready window and automatically rolls back to `previous` on failure.
- The first legacy-to-standalone migration is the only exception: after explicit no-active-reply confirmation, its 60-second budget starts before `legacy_stop`; every standalone release must use drain.
- Keep current plus three historical releases (four total) and seven verified data backups. Never delete `.incomplete-*`, failed staging releases, migration backups, or failure logs automatically.
- Code rollback never restores user data. Use `scripts/restore-production-backup.sh`, which defaults to dry-run and requires the service to be stopped plus full backup-ID confirmation for `--apply`.
```

保留既有 admin/roles 架构说明。把 Quick Start 的 lint/typecheck 命令更新为 `npm run verify` 的真实 scripts；继续强调 dev worktree 不直接运行 next build。

- [ ] **Step 4: 执行自动化验收**

```bash
git status --short --branch
HOME=/home/hsops/.pi-release-reliability-dev-home npm ci
HOME=/home/hsops/.pi-release-reliability-dev-home npm run verify
bash -n scripts/*.sh scripts/lib/*.sh
git diff --check
```

Expected: clean dependency install 后 verify 全 PASS；所有 shell syntax PASS；无 whitespace error。

- [ ] **Step 5: 执行非 8000 功能验收**

```bash
mkdir -p /home/hsops/.pi-release-reliability-dev-home/.pi-web-auth
mkdir -p /home/hsops/.pi-release-reliability-dev-home/pi-users
mkdir -p /home/hsops/.pi-release-reliability-dev-home/.pi/agent
HOME=/home/hsops/.pi-release-reliability-dev-home PI_WEB_RELEASE_TOKEN=release-dev-only REGISTER_KEYWORD=releasecheck npm run dev -- -p 8145
```

在另一个 shell 验证：

```bash
curl -fsS http://127.0.0.1:8145/api/health/live
curl -fsS http://127.0.0.1:8145/api/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8145/api/internal/drain
curl -fsS -X POST -H 'Authorization: Bearer release-dev-only' http://127.0.0.1:8145/api/internal/drain
curl -sS -D - -o /dev/null -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8145/api/agent/new
curl -fsS -X POST -H 'Authorization: Bearer release-dev-only' http://127.0.0.1:8145/api/internal/resume
```

Expected: health 200；无 token drain 401；有 token drain 200；draining 后 agent POST 503 且 `Retry-After: 5`（即使未登录，drain gate 在 route 内的顺序应先返回发布状态；若 middleware 的 cookie 检查先返回 401，则用已登录测试 cookie执行该断言，不能扩大公开 agent API）；resume 200。停止 dev server，确认无残留 node/MCP 进程，并检查生产：

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/login
systemctl --user is-active pi-web-auth.service
```

Expected: `200` 和 `active`。

- [ ] **Step 6: 提交文档**

```bash
git add docs/operations/production-release.md docs/operations/production-rollback.md AGENTS.md
git commit -m "docs: 记录 standalone 生产发布流程"
```

- [ ] **Step 7: 请求代码审查和用户验收**

使用 `superpowers:requesting-code-review` 审查 `a05547d..HEAD`，重点检查：

- 所有原始需求和设计验收标准都有自动测试或明确生产检查。
- 任何失败路径在切换前不修改 current/previous；切换后失败会恢复 old current。
- release token 不出现在 argv、JSON、日志、Git diff。
- 60 秒 deadline 使用单调时钟，30 秒 startup window 独立。
- release/backup retention 不删除 referenced、invalid、incomplete 或诊断现场。

修复所有 High/Medium findings，重新运行 `npm ci && npm run verify`，然后在 8145 提交用户验收。没有明确生产批准时停在这里。

### Task 11: 经明确批准后完成首次生产迁移

**Files:**
- Production state only; no source edits expected.

- [ ] **Step 1: 创建生产切换前审计记录**

在生产 worktree 检查：

```bash
cd /home/hsops/pi-web-auth
git status --short --branch
git rev-parse HEAD
systemctl --user is-active pi-web-auth.service
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/login
stat -c '%a %n' /home/hsops/.config/pi-web-auth/release.env 2>/dev/null || true
```

Expected: clean `main`、旧生产 active、login 200。记录切换前 users/session/preferences/jsonl 四个 count，不记录行内容。

- [ ] **Step 2: 合并 feature 并在停止生产前完成全部耗时工作**

使用非交互 merge，把已验收分支合并到 main。然后：

```bash
HOME=/home/hsops npm ci
HOME=/home/hsops npm run verify
/home/hsops/pi-web-auth/scripts/build-release.sh
```

Expected: detached worktree verify/build/staging standalone 全 PASS，新 release 已进入 `releases/<id>`，8000 仍 active。若任一步失败，停止，不执行迁移。

- [ ] **Step 3: 再次取得停机批准并运行首次迁移**

把 Step 2 的 release ID、commit、staging 结果和切换前 counts 报告给用户。得到明确批准后：

```bash
RELEASE_ID=<release-id>
/home/hsops/pi-web-auth/scripts/migrate-first-release.sh \
  --release "/home/hsops/pi-web-auth-deploy/releases/$RELEASE_ID" \
  --allow-legacy-stop \
  --confirm-no-active-replies "$RELEASE_ID"
```

Expected: 不调用 drain；`legacy_stop` + final backup/validation 在 60 秒内；新 release 在独立
30 秒内连续 3 次 ready；失败则恢复原 unit 和旧 `.next`。执行命令前再次确认所有用户已停止聊天。

- [ ] **Step 4: 验证生产功能和数据保持**

```bash
systemctl --user status pi-web-auth.service --no-pager
systemctl --user cat pi-web-auth.service
readlink -f /home/hsops/pi-web-auth-deploy/current
curl -fsS http://127.0.0.1:8000/api/health/ready
```

连续调用 ready 三次均为 200 且 release ID/commit 匹配。复核 users/session/preferences/jsonl count 与迁移前一致；浏览器 smoke test 登录、普通用户聊天/模型偏好、管理员用户/文件/对话权限。

- [ ] **Step 5: 验证 stop guard 和保留策略**

在单独批准的维护窗口执行一次 `systemctl --user restart pi-web-auth.service`，确认 stop 在 65 秒内退出且 journal 没有 SIGKILL；restart 后连续三次 ready。确认最多 4 个有效 release、最多 7 个 verified backup，migration legacy backup 仍保留。

- [ ] **Step 6: 更新迁移状态但不清理 legacy backup**

第二次 standalone 发布成功并完成一次 previous 回滚演练后，将 `migration/status.json` 的 `standaloneSuccesses` 增至 2、`rollbackDrillPassed` 设为 true。清理 legacy unit/`.next` 备份仍需后续单独人工批准，不在本阶段自动执行。

## 最终验收映射

| 设计要求 | 实施任务 |
|---|---|
| standalone 不可变 release、detached build、动态扩展 staging | Task 6 |
| 30 秒 active reply grace、abort、shutdown、dispose、幂等 signal | Task 2-4 |
| drain 后 agent POST 503 + Retry-After | Task 2-4、Task 10 |
| token-only internal API、0600 env | Task 4、Task 9 |
| 普通发布 drain/stop/final backup/validate 共用 60 秒；首次迁移从 legacy stop 计时 | Task 7-9 |
| 在线预复制和 SQLite backup API | Task 7 |
| current/previous 原子切换、30 秒 ready、失败自动回滚 | Task 8 |
| health API 公开但不泄密、release 身份匹配 | Task 5-6 |
| current + 3 历史 release、7 份 verified backup | Task 7-8 |
| standalone systemd、TimeoutStopSec=65、ExecStop drain | Task 6、Task 9 |
| 首次迁移显式 legacy stop、缺少确认 fail-closed、失败恢复原 unit 和旧 `.next` | Task 9 |
| Vitest + node:test + app/test tsc + lint + CI | Task 1 |
| 锁、结构化日志、运维/回滚文档 | Task 8-10 |
| 数据恢复与代码回滚分离 | Task 7、Task 10 |
| 生产用户数据保持和权限 smoke test | Task 11 |

## 计划自检

- **规格覆盖：** 设计文档第 1-18 节的目标、非目标、时限、备份语义、回滚、systemd、首次迁移、质量门禁、自动测试、日志和验收均有对应任务；后续凭据安全、模型治理和审计治理没有混入本计划。
- **失败边界：** verify/build/staging/disk/prebackup 失败不 drain/stop；普通发布 drain 或 final
  backup 失败不切链接；首次迁移缺少确认时不 stop，stop 后失败恢复 legacy unit/`.next`；
  切换后健康失败恢复 previous；previous 也失败时保留所有诊断现场并返回严重故障。
- **时间边界：** 普通发布 full backup 在 drain 前，drain、stop、final rsync、final SQLite
  snapshot、validate 位于 60 秒内；首次迁移从 `legacy_stop` 到 final validate 位于 60 秒内；
  新 release 和 rollback health 各自使用独立 30 秒窗口；systemd 65 秒只是 standalone 的最后保护。
- **敏感数据：** token 只在 0600 env 和 curl stdin config 中；健康、drain、manifest、backup manifest 和日志都不含 cookie、API key、用户名或消息内容。
- **类型一致：** lifecycle 状态、`DrainResult`、`DrainableSession.shutdown("quit")`、`SessionDisposeError`、release ID/commit 和 internal response 在所有任务中使用同一命名。
- **测试隔离：** 自动测试只使用临时目录/fake commands/隔离 HOME，不运行真实 systemctl、真实生产 rsync、真实模型请求或 8000 开发服务。
