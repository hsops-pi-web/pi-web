# Node 版本运行时校验设计

日期：2026-07-29
来源：`docs/superpowers/plans/2026-07-27-upstream-pi-web-upgrade-priorities.md` P0 第 1 条
状态：已获用户批准，待写实现计划

## 背景与问题

`package.json` 已声明 `engines.node = ">=24 <25"`，但这只是 `npm install` 阶段的软警告，**运行时不强制**。本项目依赖原生模块（`better-sqlite3`），历史上遇到过 Node ABI 与原生模块不匹配的问题。若在错误的 Node 版本下启动，进程会在加载原生模块时抛出难懂的堆栈，而不是给出明确的版本不符提示。

需要在**进程实际启动时**校验 Node 版本：不符即明确失败退出，并给出可操作的中文指引。

## 关键约束（已核对代码）

- **生产入口是 systemd 直接执行 `node server.js`**（Next.js standalone 产物），`systemd/pi-web-auth.service:ExecStart` 硬编码 `.../v24.17.0/bin/node .../current/server.js`，**不经过 `bin/pi-web.js`**。
- **dev 入口**是 `next dev`（`package.json:scripts.dev`）。
- **`bin/pi-web.js`** 仅用于 npm 安装后的 CLI 场景，是纯 CommonJS，不经 TS 编译。
- 当前**没有** `instrumentation.ts`。
- 现有 `lib/process-lifecycle.ts:installProcessSignalHandlers` 提供了"可注入 exit、幂等"的可测模式，本设计沿用。

因此：只改 `bin/pi-web.js` 覆盖不到生产（方案 B 已否决）；必须用 Next 的 `instrumentation.ts` 钩子覆盖生产 server.js 与 dev。

## 方案（方案 A + semver + .cjs 共享模块 + 发布脚本断言）

生产产品，不做简化。四个组件，单一逻辑源、单一版本约束源。

```
package.json (engines.node = ">=24 <25")   ← 版本约束唯一真相源
        │  运行时读取
        ▼
lib/node-version-guard.cjs  (+ .d.ts 类型声明)  ← 逻辑唯一源，CommonJS
   checkNodeVersion(current, range) → { ok, message }     纯函数，semver.satisfies
   assertNodeVersion({version?, engineRange?, exit?, log?}) → 读 engines、比对、不符则退出
        │                          │                         │
        ▼                          ▼                         ▼
  instrumentation.ts         bin/pi-web.js             scripts/release-production.sh
  register() [生产+dev]      顶部 require [CLI]         发布前置断言 [纵深防御]
```

### 组件 1：`lib/node-version-guard.cjs`（新建）

CommonJS 模块，配 `lib/node-version-guard.d.ts` 类型声明。

选择 `.cjs` 的原因：`bin/pi-web.js` 是 CommonJS，用 `require` 可同步加载 `.cjs`；`instrumentation.ts`（TS/ESM）也可 import，Next 会将其打包进 standalone。三个入口共用同一文件、同一段逻辑，**零重复、零漂移**。`.d.ts` 保证 TS 侧类型安全。

导出两个函数：

- `checkNodeVersion(current: string, range: string): { ok: boolean; message: string }`
  - 纯函数，无副作用，不读 `process`/`fs`。
  - 用 `semver.satisfies(current, range, { includePrerelease: false })` 判断。
  - `ok === false` 时，`message` 为人类可读中文，包含：当前版本、要求范围、已验证版本 `v24.17.0`、nvm 切换指引。
  - `ok === true` 时 `message` 为空字符串。

- `assertNodeVersion(opts?: { version?: string; engineRange?: string; exit?: (code: number) => never; log?: (msg: string) => void }): void`
  - `version` 默认 `process.version`。
  - `engineRange` 默认从 `package.json` 的 `engines.node` 读取（版本约束唯一真相源，绝不在代码里再写一遍范围字符串）。
  - `exit` 默认 `process.exit`，`log` 默认 `(m) => process.stderr.write(m + "\n")`。全部可注入，便于测试。
  - 调 `checkNodeVersion`；不符则 `log(message)` 后 `exit(1)`；符合则静默返回。
  - 校验无副作用（只读 + 可能退出），instrumentation 与 bin 即便都触发也无需去重。

### 依赖：`semver`

新增显式依赖 `semver`（纯 JS，无原生模块，npm 自身即用它做 engines 检查）。

为什么不手写 major 比对：`>=24 <25` 只是当前值，`engines` 未来可能改为带 minor/patch 的约束（如 `>=24.5 <25`）。手写 major 比对会在那天悄悄判错。`semver.satisfies` 正确处理所有比较符、`||`、prerelease、`v` 前缀，久经考验，无维护负担。

### 组件 2：`instrumentation.ts`（新建，项目根）

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertNodeVersion } = await import("./lib/node-version-guard.cjs");
    assertNodeVersion();
  }
}
```

- 仅在 `NEXT_RUNTIME === "nodejs"` 执行，跳过 edge runtime（middleware 不受影响）。
- Next 16 standalone 会打包并在 server 启动时执行 `register()`，因此**同时覆盖生产 server.js 与 dev**。

### 组件 3：`bin/pi-web.js`（编辑）

在文件顶部现有 `require` 之后、`app.prepare()` 之前，`require` 共享 guard 模块并调用 `assertNodeVersion()`。覆盖 npm CLI 场景。因共用 `.cjs`，无需内联、无逻辑重复。

**打包约束（已核对）**：`package.json:files` 当前为 `["bin", ".next", ..., "next.config.ts", "package.json"]`，**不含 `lib/`**。若 bin `require("../lib/node-version-guard.cjs")`，npm 发布产物中该文件缺失，CLI 启动会崩。两种解法，实现阶段二选一：
- （推荐）将 `lib/node-version-guard.cjs` 与 `lib/node-version-guard.d.ts` 加入 `package.json:files`（最小增量，仅带上 guard 文件）。
- 或把 guard 放在 bin 可达且已打包的位置（如 `bin/node-version-guard.cjs`），instrumentation 与 bin 都从此处引用。
本设计采用推荐解法：guard 留在 `lib/`，并把这两个文件补进 `files`。

### 组件 4：`scripts/release-production.sh`（编辑，纵深防御第二道防线）

在发布流程早期（`build-release` 之前）加一道 Node 版本前置断言：用 `$NODE_BIN` 执行一小段读取 `package.json` engines 并调用 guard 的校验，不符则 `die` 中止发布。让错误版本在**发布阶段**就被拦下，而非等进程启动才退出。这是纵深防御，非冗余。

## 数据流

1. 进程启动（生产 server.js / dev / CLI / 发布脚本）。
2. 对应入口调用 `assertNodeVersion()`。
3. 读 `package.json` engines → 得 `range`；取 `process.version` → 得 `current`。
4. `checkNodeVersion(current, range)` 用 semver 判断。
5. 符合 → 静默继续启动；不符 → stderr 打印中文提示 → `exit(1)`。

## 错误处理

- 版本不符：明确退出码 1 + 中文提示，不进入后续启动逻辑，避免原生模块崩溃的模糊堆栈。
- `package.json` 读取失败或 `engines.node` 缺失：视为配置错误，`assertNodeVersion` 抛出明确错误（不静默放行），因为无约束源无法保证安全启动。
- `semver.satisfies` 对无法解析的 `current`：semver 返回 false，走不符分支，安全侧默认拒绝。

## 测试策略（TDD）

纯函数 + 可注入入口，全部可单测，遵循现有 `node:test` 风格（参考 `__tests__/lib/auth/process-lifecycle.test.ts`）。

`__tests__/lib/node-version-guard.test.ts`：

- `checkNodeVersion`：
  - `v24.17.0` + `">=24 <25"` → ok:true
  - `v24.0.0` / `v24.99.0` + `">=24 <25"` → ok:true
  - `v22.14.0` → ok:false，message 含要求范围与 `v24.17.0`
  - `v25.0.0` → ok:false
  - 未来约束 `">=24.5 <25"`：`v24.4.0` → ok:false，`v24.17.0` → ok:true（证明 semver 正确处理 minor）
  - 无法解析的版本串 → ok:false（fail-closed）
- `assertNodeVersion`：
  - 注入合规 version → 不调用 exit、不调用 log
  - 注入不合规 version → 调用 log（内容含提示）且 exit(1)
  - 注入自定义 engineRange 覆盖默认
  - 默认从 package.json 读 engines（不注入 engineRange 时，用合规/不合规 version 验证行为）

发布脚本断言纳入现有 `__tests__/release/release-scripts.test.ts` 风格：验证错误 Node 版本时发布脚本非零退出。

## 验收标准

- 在 Node 24 下：生产、dev、CLI 均正常启动，无额外输出。
- 在非 24 版本下：三个入口均以退出码 1 失败，stderr 显示中文版本提示（含要求范围与 `v24.17.0`）。
- 发布脚本在错误 Node 版本下中止，不产出发布产物。
- `engines.node` 是唯一版本约束源；guard 逻辑是唯一判断源；无重复的版本字符串或比对逻辑。
- 新增单测全部通过；`npm run verify`（typecheck + lint + test）通过。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `.cjs` 在 Next TS/ESM 侧 import 的互操作 | Next 16 支持混合模块；`instrumentation.ts` 用动态 `import()`，`.d.ts` 提供类型；实现阶段以 dev 启动实测验证 |
| standalone 是否打包 `lib/node-version-guard.cjs` | instrumentation 引用即会被 Next 追踪打包；实现后需在 standalone 产物中验证文件存在（参考 `scripts/verify-standalone.mjs`） |
| bin 的相对路径 `../lib/...cjs` 在 npm 安装布局下是否有效 | 已确认 `package.json:files` 不含 `lib/`，实现须将两个 guard 文件补进 `files`（见组件 3 打包约束） |
| 新增 semver 依赖 | semver 纯 JS 无原生、体积小、npm 自身依赖，风险极低 |

## 不做（YAGNI）

- 不做版本自动切换/安装（只校验并提示，切换是运维职责）。
- 不校验 npm/bun 版本（本轮只针对 Node 运行时 ABI 问题）。
- 不引入配置开关跳过校验（安全底线不应可绕过）。
