# Node 版本运行时校验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在进程启动（生产 server.js / dev / CLI）与发布阶段强制校验 Node 版本，不符即明确失败退出并给中文提示，避免原生模块（better-sqlite3）ABI 崩溃的模糊堆栈。

**Architecture:** 单一逻辑源 `lib/node-version-guard.cjs`（CommonJS，纯函数 + 可注入入口），被三个运行时入口（instrumentation.ts、bin/pi-web.js）共用，用 semver 判断允许范围；发布脚本用纯 Node 内置做等价前置断言（装依赖前拦截，不依赖第三方包）。每个入口从自己可信根显式传入 package.json 路径，无 cwd 隐式回退。

**Tech Stack:** Node.js `>=24 <25`、TypeScript、Next.js 16（instrumentation 钩子 + standalone 输出）、semver、`node:test` 单测、bash 发布脚本。

设计来源：`docs/superpowers/specs/2026-07-29-node-version-runtime-guard-design.md`

## Global Constraints

- 允许范围唯一源：`package.json:engines.node`（当前 `>=24 <25`），代码中不重复写范围字符串。
- 已验证/运维固定版本：`v24.17.0`，仅用于错误提示中的运维推荐，从具名常量取，与 `scripts/lib/release-common.sh:8`、`systemd/pi-web-auth.service:14` 语义一致。
- 全部回复与提示用中文；普通连字符和直引号，禁用 em-dash 和花式引号。
- guard 逻辑唯一源：`lib/node-version-guard.cjs`；运行时三入口共用；发布脚本用等价纯内置实现（约束固定 `>=24 <25`，允许不用 semver）。
- 每个入口从自己可信根读 package.json：CLI 用 pkgDir、instrumentation 用 cwd、发布脚本用 `$SOURCE_ROOT`。禁止 guard 内部 cwd 隐式回退。
- 测试用 range 覆盖必须双变量门控：只有 `PI_WEB_ALLOW_TEST_ENGINE_RANGE=1` 时才读取 `PI_WEB_TEST_ENGINE_RANGE`。生产或普通 shell 中单独设置 `PI_WEB_TEST_ENGINE_RANGE` 必须被忽略。
- 单测用 `node:test`（`import { test } from "node:test"` + `node:assert/strict`），可注入 exit/log/version/path，参考 `__tests__/lib/auth/process-lifecycle.test.ts`。
- CLI guard 必须在 `require("next")` 之前执行。
- 发布前置断言必须在 `build-release`（含 `npm ci`）之前、不依赖 semver/source node_modules。
- 开发验证不用 8000 端口；通过 user systemd dev service（当前 lane 为 `pi-web-auth-8144-dev.service`）验证，不用长跑 shell/PTY。不要在开发 worktree 直接运行 `next build`。standalone 构建只通过 release 脚本在 detached worktree 中执行。
- 完成判据：`npm run verify`（typecheck + lint + test）通过。

## 文件结构

- Create `lib/node-version-guard.cjs` - 核心逻辑唯一源。导出 `checkNodeVersion`、`readEngineRange`、`assertNodeVersion`、`VERIFIED_NODE_VERSION` 常量。
- Create `lib/node-version-guard.d.ts` - 上述导出的 TS 类型声明。
- Create `instrumentation.ts`（项目根）- Next server 启动钩子，覆盖生产 server.js + dev。
- Modify `bin/pi-web.js` - guard 调用移到 `require("next")` 之前。
- Modify `package.json` - 加 `semver` + `@types/semver` 直接依赖；`files` 补入两个 guard 文件。
- Modify `scripts/release-production.sh` - 发布前置版本断言（纯内置）。
- Create `__tests__/lib/node-version-guard.test.ts` - guard 单测。
- Modify `scripts/verify-standalone.mjs` - 表面测试：注入排除当前 Node 的 range，断言 standalone 启动退出码 1 + 中文提示。
- Modify `__tests__/release/release-scripts.test.ts` - 发布断言测试。

依赖顺序：Task 1（guard 核心）→ Task 2（依赖与打包）→ Task 3（instrumentation）→ Task 4（bin）→ Task 5（发布断言）→ Task 6（instrumentation 表面测试）。

---

### Task 1: guard 核心逻辑与单测

**Files:**
- Create: `lib/node-version-guard.cjs`
- Create: `lib/node-version-guard.d.ts`
- Test: `__tests__/lib/node-version-guard.test.ts`

**Interfaces:**
- Consumes: `semver`（Task 2 会加为直接依赖；若先跑本任务，本地 node_modules 当前已有间接 semver，测试可先红后绿，但最终不得依赖间接包）。
- Produces:
  - `checkNodeVersion(current: string, range: string): { ok: boolean; message: string }`
  - `readEngineRange(packageJsonPath: string): string`
  - `assertNodeVersion(opts: { engineRange?: string; packageJsonPath?: string; version?: string; exit?: (code: number) => never; log?: (msg: string) => void }): void`
  - `VERIFIED_NODE_VERSION: string`（值 `"v24.17.0"`）

- [ ] **Step 1: 写失败测试**

创建 `__tests__/lib/node-version-guard.test.ts`：

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkNodeVersion,
  readEngineRange,
  assertNodeVersion,
  VERIFIED_NODE_VERSION,
} from "../../lib/node-version-guard.cjs";

test("checkNodeVersion: 合规版本 ok:true 且 message 为空", () => {
  for (const v of ["v24.17.0", "v24.0.0", "v24.99.0"]) {
    const r = checkNodeVersion(v, ">=24 <25");
    assert.equal(r.ok, true);
    assert.equal(r.message, "");
  }
});

test("checkNodeVersion: 低版本 ok:false 且 message 含范围与已验证版本", () => {
  const r = checkNodeVersion("v22.14.0", ">=24 <25");
  assert.equal(r.ok, false);
  assert.match(r.message, />=24 <25/);
  assert.match(r.message, /v24\.17\.0/);
});

test("checkNodeVersion: 高版本 ok:false", () => {
  assert.equal(checkNodeVersion("v25.0.0", ">=24 <25").ok, false);
});

test("checkNodeVersion: 带 minor 的未来约束由 semver 正确处理", () => {
  assert.equal(checkNodeVersion("v24.4.0", ">=24.5 <25").ok, false);
  assert.equal(checkNodeVersion("v24.17.0", ">=24.5 <25").ok, true);
});

test("checkNodeVersion: 无法解析的版本串 fail-closed", () => {
  assert.equal(checkNodeVersion("not-a-version", ">=24 <25").ok, false);
});

test("readEngineRange: 从 package.json 读 engines.node", () => {
  const dir = mkdtempSync(join(tmpdir(), "nvg-"));
  try {
    const p = join(dir, "package.json");
    writeFileSync(p, JSON.stringify({ engines: { node: ">=24 <25" } }));
    assert.equal(readEngineRange(p), ">=24 <25");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEngineRange: engines.node 缺失时抛错", () => {
  const dir = mkdtempSync(join(tmpdir(), "nvg-"));
  try {
    const p = join(dir, "package.json");
    writeFileSync(p, JSON.stringify({ name: "x" }));
    assert.throws(() => readEngineRange(p), /缺少 engines\.node/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEngineRange: 文件不存在时抛错", () => {
  assert.throws(() => readEngineRange(join(tmpdir(), "nonexistent-nvg", "package.json")), /无法读取 package\.json/);
});

test("assertNodeVersion: 合规 version+engineRange 不退出不打印", () => {
  let logged = "";
  assertNodeVersion({
    version: "v24.17.0",
    engineRange: ">=24 <25",
    exit: (code: number) => { throw new Error(`unexpected exit ${code}`); },
    log: (m) => { logged += m; },
  });
  assert.equal(logged, "");
});

test("assertNodeVersion: 不合规调用 log 并 exit(1)", () => {
  let code = -1;
  let logged = "";
  assert.throws(() => assertNodeVersion({
    version: "v22.0.0",
    engineRange: ">=24 <25",
    exit: (c: number) => { code = c; throw new Error("exit"); },
    log: (m) => { logged += m; },
  }), /exit/);
  assert.equal(code, 1);
  assert.match(logged, /v24\.17\.0/);
  assert.match(logged, /nvm use v24\.17\.0/);
});

test("assertNodeVersion: 传 packageJsonPath 读取 range 并判断", () => {
  const dir = mkdtempSync(join(tmpdir(), "nvg-"));
  try {
    const p = join(dir, "package.json");
    writeFileSync(p, JSON.stringify({ engines: { node: ">=24 <25" } }));
    let code = -1;
    assert.throws(() => assertNodeVersion({
      version: "v22.0.0",
      packageJsonPath: p,
      exit: (c: number) => { code = c; throw new Error("exit"); },
      log: () => {},
    }), /exit/);
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("assertNodeVersion: 既无 engineRange 也无 packageJsonPath 抛错", () => {
  assert.throws(() => assertNodeVersion({ version: "v24.17.0" }));
});

test("VERIFIED_NODE_VERSION 常量为 v24.17.0", () => {
  assert.equal(VERIFIED_NODE_VERSION, "v24.17.0");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:auth 2>&1 | head -30`（test:auth glob 是 `__tests__/lib/auth/**`，不含本文件，需临时用直接命令）
实际运行：`node --experimental-strip-types --test "__tests__/lib/node-version-guard.test.ts"`
Expected: FAIL，报 `Cannot find module '../../lib/node-version-guard.cjs'`

- [ ] **Step 3: 实现 guard**

创建 `lib/node-version-guard.cjs`：

```javascript
"use strict";

const { readFileSync } = require("node:fs");
const semver = require("semver");

// 已验证/运维固定版本。与 scripts/lib/release-common.sh:8、
// systemd/pi-web-auth.service:14 语义一致，改动需同步。
const VERIFIED_NODE_VERSION = "v24.17.0";

function checkNodeVersion(current, range) {
  const ok = semver.satisfies(current, range, { includePrerelease: false });
  if (ok) return { ok: true, message: "" };
  const message =
    `Node 版本不符：当前 ${current}，要求 ${range}。\n` +
    `请切换到已验证版本 ${VERIFIED_NODE_VERSION}（例如：nvm use ${VERIFIED_NODE_VERSION}）后重试。`;
  return { ok: false, message };
}

function readEngineRange(packageJsonPath) {
  let raw;
  try {
    raw = readFileSync(packageJsonPath, "utf8");
  } catch (error) {
    const detail = error && error.message ? `：${error.message}` : "";
    throw new Error(`无法读取 package.json：${packageJsonPath}${detail}`);
  }

  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (error) {
    const detail = error && error.message ? `：${error.message}` : "";
    throw new Error(`package.json 不是有效 JSON：${packageJsonPath}${detail}`);
  }

  const range = pkg && pkg.engines && pkg.engines.node;
  if (typeof range !== "string" || range.length === 0) {
    throw new Error(`package.json 缺少 engines.node：${packageJsonPath}`);
  }
  return range;
}

function assertNodeVersion(opts) {
  const options = opts || {};
  const version = options.version || process.version;
  const exit = options.exit || process.exit;
  const log = options.log || ((m) => process.stderr.write(m + "\n"));

  let range = options.engineRange;
  if (typeof range !== "string") {
    if (typeof options.packageJsonPath !== "string") {
      throw new Error("assertNodeVersion 需要 engineRange 或 packageJsonPath 之一");
    }
    range = readEngineRange(options.packageJsonPath);
  }

  const result = checkNodeVersion(version, range);
  if (!result.ok) {
    log(result.message);
    exit(1);
  }
}

module.exports = { checkNodeVersion, readEngineRange, assertNodeVersion, VERIFIED_NODE_VERSION };
```

创建 `lib/node-version-guard.d.ts`：

```typescript
export interface CheckResult {
  ok: boolean;
  message: string;
}

export interface AssertOptions {
  engineRange?: string;
  packageJsonPath?: string;
  version?: string;
  exit?: (code: number) => never;
  log?: (msg: string) => void;
}

export declare const VERIFIED_NODE_VERSION: string;
export declare function checkNodeVersion(current: string, range: string): CheckResult;
export declare function readEngineRange(packageJsonPath: string): string;
export declare function assertNodeVersion(opts: AssertOptions): void;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --experimental-strip-types --test "__tests__/lib/node-version-guard.test.ts"`
Expected: PASS，全部用例通过

- [ ] **Step 5: 提交**

```bash
git add lib/node-version-guard.cjs lib/node-version-guard.d.ts __tests__/lib/node-version-guard.test.ts
git commit -m "feat: add Node version guard core logic (P0-1)"
```

---

### Task 2: semver 直接依赖 + package.json files 打包

**Files:**
- Modify: `package.json`（dependencies、devDependencies、files、test 脚本）

**Interfaces:**
- Consumes: Task 1 的 `lib/node-version-guard.cjs`、`lib/node-version-guard.d.ts`。
- Produces: semver 成为直接依赖；guard 单测纳入 `npm test`；guard 文件进入发布产物 `files`。

- [ ] **Step 1: 加 semver 直接依赖与类型**

Run:
```bash
npm install semver@^7 && npm install --save-dev @types/semver
```
说明：当前 semver 是间接依赖；升为直接依赖，避免间接依赖被删时 guard 崩。仓库现有依赖多用 caret range，保持同一风格。`@types/semver` 供 TS 侧（本 guard 用 .cjs+.d.ts，类型主要给未来直接 import 者）。

- [ ] **Step 2: package.json files 补入 guard 文件**

Modify `package.json` 的 `files` 数组，加两行（放在 `"bin"` 之后）：

```json
  "files": [
    "bin",
    "lib/node-version-guard.cjs",
    "lib/node-version-guard.d.ts",
    ".next",
    "!.next/cache",
    "!.next/dev",
    "!.next/**/*.js.map",
    "public",
    "next.config.ts",
    "package.json"
  ],
```

理由：`bin/pi-web.js` 会 `require("../lib/node-version-guard.cjs")`，CLI 安装场景该文件必须在发布产物中（design 组件 3 打包约束）。

- [ ] **Step 3: 把 guard 单测纳入 npm test**

Modify `package.json` scripts，把 guard 测试并入 `test:auth`（该脚本已用 `node --experimental-strip-types --test`）。将：
```json
    "test:auth": "node --experimental-strip-types --test \"__tests__/lib/auth/**/*.test.ts\"",
```
改为：
```json
    "test:auth": "node --experimental-strip-types --test \"__tests__/lib/auth/**/*.test.ts\" \"__tests__/lib/node-version-guard.test.ts\"",
```

- [ ] **Step 4: 验证依赖与测试**

Run: `npm run test:auth 2>&1 | tail -20`
Expected: PASS，含 guard 用例；`node -e "console.log(require('semver/package.json').version)"` 显示 7.x

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json
git commit -m "build: add semver direct dep and package guard files (P0-1)"
```

---

### Task 3: instrumentation.ts 覆盖生产 server.js 与 dev

**Files:**
- Create: `instrumentation.ts`（项目根）

**Interfaces:**
- Consumes: Task 1 的 `assertNodeVersion`。
- Produces: Next server 启动时执行版本校验（生产 + dev）。

- [ ] **Step 1: 写 instrumentation 钩子**

创建 `instrumentation.ts`：

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const path = await import("node:path");
  const { assertNodeVersion } = await import("./lib/node-version-guard.cjs");
  const override =
    process.env.PI_WEB_ALLOW_TEST_ENGINE_RANGE === "1"
      ? process.env.PI_WEB_TEST_ENGINE_RANGE
      : undefined;
  assertNodeVersion(
    override
      ? { engineRange: override }
      : { packageJsonPath: path.join(process.cwd(), "package.json") },
  );
}
```

说明：
- 仅 nodejs runtime 执行，跳过 edge（middleware 不受影响）。
- `PI_WEB_TEST_ENGINE_RANGE` 只有在 `PI_WEB_ALLOW_TEST_ENGINE_RANGE=1` 时生效（Task 6 表面测试用）。生产或普通 shell 中单独设置 `PI_WEB_TEST_ENGINE_RANGE` 会被忽略。
- 生产 cwd = release root（systemd WorkingDirectory，service:7），dev cwd = 项目根，均含 package.json。

- [ ] **Step 2: dev 启动实测（版本合规路径）**

Run:
```bash
systemctl --user restart pi-web-auth-8144-dev.service
sleep 3
systemctl --user status pi-web-auth-8144-dev.service --no-pager
curl -fsS http://127.0.0.1:8144/login >/dev/null
```
Expected: service 为 running，`curl` 退出 0，无版本错误输出（当前 Node 24 合规）。

- [ ] **Step 3: dev 启动实测（注入不合规 range，验证钩子生效）**

Run:
```bash
systemctl --user set-environment PI_WEB_ALLOW_TEST_ENGINE_RANGE=1 PI_WEB_TEST_ENGINE_RANGE='>=99'
systemctl --user restart pi-web-auth-8144-dev.service || true
sleep 3
journalctl --user -u pi-web-auth-8144-dev.service --no-pager -n 80
systemctl --user unset-environment PI_WEB_ALLOW_TEST_ENGINE_RANGE PI_WEB_TEST_ENGINE_RANGE
systemctl --user restart pi-web-auth-8144-dev.service
```
Expected: journal 输出中文版本提示（含 `v24.17.0`），不打印 `Ready`；随后 unset 并 restart 后 dev service 恢复合规启动。
说明：这是本地手工验证钩子确实执行；自动化版本在 Task 6。

- [ ] **Step 4: typecheck 通过**

Run: `npm run typecheck:app 2>&1 | tail -20`
Expected: 无错误（instrumentation.ts 与 .cjs 动态 import 类型解析正常）

- [ ] **Step 5: 提交**

```bash
git add instrumentation.ts
git commit -m "feat: enforce Node version via Next instrumentation hook (P0-1)"
```

---

### Task 4: bin/pi-web.js 在 require("next") 之前校验

**Files:**
- Modify: `bin/pi-web.js:14-18`

**Interfaces:**
- Consumes: Task 1 的 `assertNodeVersion`。
- Produces: CLI 启动前的版本校验，先于 Next 加载。

- [ ] **Step 1: 调整 bin 加载顺序**

当前 `bin/pi-web.js:5-18`：
```javascript
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { parseArgs } = require("util");
const next = require("next");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");
```

改为（把 `require("next")` 移到版本校验之后；保留各行的 eslint-disable 注释）：
```javascript
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// 版本校验必须在 require("next") 之前：否则错误 Node 可能先在
// Next 加载阶段抛出难懂错误，来不及给出中文提示。
const { assertNodeVersion } = require("../lib/node-version-guard.cjs");
assertNodeVersion({ packageJsonPath: path.join(pkgDir, "package.json") });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const next = require("next");
```
注意：删除原第 14-15 行 `next` 的 require（含其上方 eslint-disable 注释），在新位置重建。其余 require 上方的 eslint-disable 注释保持不变。

- [ ] **Step 2: 合规版本下 CLI 校验通过（冒烟）**

Run: `node -e "const p=require('path'); const {assertNodeVersion}=require('./lib/node-version-guard.cjs'); assertNodeVersion({packageJsonPath: p.join(process.cwd(),'package.json')}); console.log('ok')"`
Expected: 输出 `ok`（当前 Node 24 合规，不退出）

- [ ] **Step 3: 不合规版本下 CLI 校验退出（冒烟）**

Run: `node -e "const {assertNodeVersion}=require('./lib/node-version-guard.cjs'); assertNodeVersion({version:'v22.0.0', engineRange:'>=24 <25', log:(m)=>process.stderr.write(m+'\n')})"; echo "exit=$?"`
Expected: stderr 打印中文提示（含 `v24.17.0`），`exit=1`

- [ ] **Step 4: lint 通过**

Run: `npm run lint 2>&1 | tail -20`
Expected: 无错误（bin/pi-web.js 的 require 顺序不触发 lint 报错）

- [ ] **Step 5: 提交**

```bash
git add bin/pi-web.js
git commit -m "feat: check Node version before loading Next in CLI (P0-1)"
```

---

### Task 5: 发布脚本前置版本断言（纯内置，装依赖前）

**Files:**
- Modify: `scripts/release-production.sh:104-120`（main 函数开头）
- Test: `__tests__/release/release-scripts.test.ts`

**Interfaces:**
- Consumes: `$SOURCE_ROOT`（release-common.sh:5）、`$NODE_BIN`（release-common.sh:8）、`die`（release-common.sh:18）。
- Produces: 发布在错误 Node 版本下 `die` 中止，先于 build-release/npm ci。

- [ ] **Step 1: 写发布断言测试（先失败）**

先在 `releaseFixture()` 返回对象中加入一个测试辅助方法，放在现有 `run()` 和 `runWithArgs()` 之间：

```typescript
    runWithEnv(extraEnv: Record<string, string>) {
      const result = spawnSync("bash", ["scripts/release-production.sh"], {
        cwd: resolve("."),
        env: { ...environment, ...extraEnv },
        encoding: "utf8",
      });
      lockHolder?.kill("SIGTERM");
      return result;
    },
```

然后在 `normal releases reject the one-time legacy migration flags` 测试之前追加两个用例：

```typescript
test("release production rejects wrong Node before build", () => {
  const fixture = releaseFixture("success");
  const result = fixture.runWithEnv({
    PI_WEB_ALLOW_TEST_ENGINE_RANGE: "1",
    PI_WEB_TEST_ENGINE_RANGE: ">=99",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /v24\.17\.0/);
  assert.deepEqual(fixture.events(), []);
});

test("release production ignores test range without explicit allow flag", () => {
  const fixture = releaseFixture("success");
  const result = fixture.runWithEnv({
    PI_WEB_TEST_ENGINE_RANGE: ">=99",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fixture.events(), ["build", "disk-check", "backup:prepare", "drain", "stop", "backup:finalize", "start-new", "health-new", "retention"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:release 2>&1 | tail -25`
Expected: FAIL，第一个新用例没有看到 `v24.17.0`，说明 release 脚本尚未执行 Node 前置断言。

- [ ] **Step 3: 在 release-production.sh main 开头加纯内置断言**

将 `scripts/release-production.sh` 的 `main()` 开头改为：

```bash
main() {
  [[ $# -eq 0 ]] || die "release-production.sh does not accept legacy migration arguments"
  assert_node_version_or_die
  acquire_release_lock
```

并在文件中 `main()` 定义之前（例如紧接变量声明之后）加函数定义：

```bash
assert_node_version_or_die() {
  local range_override=""
  if [[ "${PI_WEB_ALLOW_TEST_ENGINE_RANGE:-0}" == 1 ]]; then
    range_override=${PI_WEB_TEST_ENGINE_RANGE:-}
  fi

  "$NODE_BIN" - "$SOURCE_ROOT/package.json" "$range_override" <<'NODE' || \
    die "Node 版本不符，已验证版本为 v24.17.0，发布中止"
const { readFileSync } = require("node:fs");

const [packageJsonPath, rangeOverride] = process.argv.slice(2);
const verified = "v24.17.0";

function parseVersion(value) {
  const match = String(value).match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

function compare(left, right) {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function satisfiesSimpleRange(version, range) {
  const current = parseVersion(version);
  if (!current) return false;
  return range.trim().split(/\s+/).every((part) => {
    const match = part.match(/^(>=|>|<=|<|=)?v?(\d+(?:\.\d+){0,2})$/);
    if (!match) return false;
    const operator = match[1] || "=";
    const target = parseVersion(match[2]);
    if (!target) return false;
    const relation = compare(current, target);
    if (operator === ">=") return relation >= 0;
    if (operator === ">") return relation > 0;
    if (operator === "<=") return relation <= 0;
    if (operator === "<") return relation < 0;
    return relation === 0;
  });
}

let range = rangeOverride;
if (!range) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  range = pkg && pkg.engines && pkg.engines.node;
}

if (typeof range !== "string" || range.length === 0) {
  process.stderr.write(`package.json 缺少 engines.node：${packageJsonPath}\n`);
  process.exit(1);
}

if (!satisfiesSimpleRange(process.version, range)) {
  process.stderr.write(`Node 版本不符：当前 ${process.version}，要求 ${range}。请切换到已验证版本 ${verified} 后重试。\n`);
  process.exit(1);
}
NODE
}
```

说明：这段是 design 组件 4 要求的纯内置实现。它不 `require("semver")`，不读 source `node_modules`，只读取 `$SOURCE_ROOT/package.json`。`PI_WEB_TEST_ENGINE_RANGE` 只有在 `PI_WEB_ALLOW_TEST_ENGINE_RANGE=1` 时覆盖 range。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:release 2>&1 | tail -25`
Expected: PASS，新用例通过。错误版本用例非零退出、stderr 含 `v24.17.0`、events 为空；未加 allow flag 的测试 range 用例仍走完整 success 事件序列。

- [ ] **Step 5: 提交**

```bash
git add scripts/release-production.sh __tests__/release/release-scripts.test.ts
git commit -m "feat: assert Node version before release build (P0-1)"
```

---

### Task 6: 表面测试证明 instrumentation 真被 Next 执行

**Files:**
- Modify: `scripts/verify-standalone.mjs`（新增一个前置子检查，或独立小函数）

**Interfaces:**
- Consumes: Task 3 的 instrumentation + 双变量门控的测试 range 覆盖入口；`verify-standalone.mjs` 已有的 spawn server.js 能力。
- Produces: 在当前 Node 24 单环境证明 standalone 的 instrumentation 钩子确执行 guard。

- [ ] **Step 1: 读 verify-standalone 现有启动结构**

先读 `scripts/verify-standalone.mjs:42-90`，确认 `spawn(process.execPath, [join(releaseDir, "server.js")], {cwd: releaseDir, env: {...}})` 的用法，复用同样的 spawn 方式。

- [ ] **Step 2: 加表面子检查函数**

在 `verify-standalone.mjs` 主流程中加入：用 `PI_WEB_ALLOW_TEST_ENGINE_RANGE=1 PI_WEB_TEST_ENGINE_RANGE=">=99"` 启动一个短命 server.js，断言它以非零码退出且 stderr 含中文提示。现有文件会在顶层先启动正常 server；短命进程用 `PORT=0`，不会和正常 staging 端口冲突。

新增函数（放在文件内合适位置，复用已有 import 的 spawn/once）：

```javascript
async function assertVersionGuardEngages(releaseDir, home) {
  const proc = spawn(process.execPath, [join(releaseDir, "server.js")], {
    cwd: releaseDir,
    env: {
      ...process.env,
      HOME: home,
      PORT: "0",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PI_WEB_ALLOW_TEST_ENGINE_RANGE: "1",
      PI_WEB_TEST_ENGINE_RANGE: ">=99",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (c) => { stderr = `${stderr}${c}`.slice(-4096); });
  const [code] = await once(proc, "exit");
  if (code === 0) {
    throw new Error("instrumentation guard 未生效：注入 >=99 后 server 未退出");
  }
  if (!/v24\.17\.0/.test(stderr)) {
    throw new Error(`instrumentation guard 提示缺失，stderr=${stderr}`);
  }
}
```

在主流程 `try` 块开头（`await waitForReady()` 之前）调用：
```javascript
  await assertVersionGuardEngages(releaseDir, home);
```

- [ ] **Step 3: 脚本语法快速验证**

Run: `node --check scripts/verify-standalone.mjs`
Expected: 语法检查通过。

说明：不要在开发 worktree 直接运行 `next build`。`verify-standalone.mjs` 的真实表面验证会在 `scripts/build-release.sh` 的 detached worktree staging 阶段执行；Task 7 的 `npm run verify` 证明脚本类型/语法和 release 测试仍通过。

- [ ] **Step 4: 确认生产路径不受影响**

Run: 检查生产不设测试覆盖变量：`grep -rn "PI_WEB_TEST_ENGINE_RANGE\\|PI_WEB_ALLOW_TEST_ENGINE_RANGE" systemd/ scripts/lib/`
Expected: 无输出。`scripts/release-production.sh` 与 `scripts/verify-standalone.mjs` 可出现这些变量，但只有测试路径或显式 allow flag 会使用。

- [ ] **Step 5: 提交**

```bash
git add scripts/verify-standalone.mjs
git commit -m "test: prove instrumentation guard engages in standalone (P0-1)"
```

---

### Task 7: 全量校验与收尾

**Files:** 无新增，仅验证。

- [ ] **Step 1: 全量 verify**

Run: `npm run verify 2>&1 | tail -30`
Expected: typecheck + lint + test 全绿。

- [ ] **Step 2: 确认无遗留 placeholder**

Run: `rg -n "T[B]D|T[O]DO|implement late[r]|Similar t[o]|适[当]" docs/superpowers/plans/2026-07-29-node-version-runtime-guard.md lib instrumentation.ts bin scripts/release-production.sh`
Expected: 无输出。

- [ ] **Step 3: 确认版本字符串没有散落**

Run: `rg -n "24\\.17\\.0|>=24 <25" lib instrumentation.ts bin scripts/release-production.sh package.json`
Expected: `package.json` 有 `>=24 <25`；`lib/node-version-guard.cjs` 有 `v24.17.0` 常量；`scripts/release-production.sh` 有发布前置断言的 `v24.17.0` 提示。不要在 `instrumentation.ts` 或 `bin/pi-web.js` 硬编码范围。

- [ ] **Step 4: 最终提交（若有零散改动）**

```bash
git add lib/node-version-guard.cjs lib/node-version-guard.d.ts instrumentation.ts bin/pi-web.js package.json package-lock.json scripts/release-production.sh scripts/verify-standalone.mjs __tests__/lib/node-version-guard.test.ts __tests__/release/release-scripts.test.ts
git status --short
git commit -m "chore: finalize Node version guard (P0-1)" || echo "nothing to commit"
```

---

## 验收对照（对齐 spec 验收标准）

- [ ] Node 24 下三入口正常启动无额外输出 - Task 3/4 冒烟 + Task 7 verify
- [ ] 非 24 下三入口退出码 1 + 中文提示 - Task 1 单测（逻辑）+ Task 3/4 冒烟（入口）
- [ ] 表面测试证明 instrumentation 被执行 - Task 6
- [ ] 发布脚本错误版本中止、在 npm ci 之前、不依赖 source node_modules - Task 5
- [ ] CLI guard 在 require("next") 之前 - Task 4
- [ ] engines 唯一约束源；v24.17.0 具名常量；无散落硬编码 - Task 1 + Task 7 Step 3
- [ ] 各入口从可信根读 package.json，无 cwd 隐式回退 - Task 1（抛错用例）+ 各入口传参
- [ ] npm run verify 通过 - Task 7
