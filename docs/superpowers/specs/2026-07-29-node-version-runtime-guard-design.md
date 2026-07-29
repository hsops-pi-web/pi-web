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

导出三个函数（review 反馈 #1：把"读 package.json 的位置"显式化，消除三入口漂移）：

- `checkNodeVersion(current: string, range: string): { ok: boolean; message: string }`
  - 纯函数，无副作用，不读 `process`/`fs`。
  - 用 `semver.satisfies(current, range, { includePrerelease: false })` 判断。
  - `ok === false` 时，`message` 为人类可读中文，包含：当前版本、要求范围（`range`）、已验证/运维固定版本 `v24.17.0`、nvm 切换指引。
    - 说明（review 反馈 #3）：`range` 是"允许范围"，来自 `engines.node`；`v24.17.0` 是"已验证/运维固定版本"，是独立概念，见下方「版本概念的两个来源」。
  - `ok === true` 时 `message` 为空字符串。

- `readEngineRange(packageJsonPath: string): string`
  - 从**显式传入的** `packageJsonPath` 读 `engines.node` 并返回。
  - 读取失败或 `engines.node` 缺失 → 抛出明确错误（不静默放行）。
  - 关键：不使用 `process.cwd()`、不使用相对默认路径。调用方必须从自己可信的包根算出绝对路径传入。

- `assertNodeVersion(opts: { engineRange?: string; packageJsonPath?: string; version?: string; exit?: (code: number) => never; log?: (msg: string) => void }): void`
  - **`engineRange` 或 `packageJsonPath` 至少提供其一**（review 反馈 #1）：
    - 传 `engineRange` → 直接用（发布脚本/测试场景，range 已由调用方从可信源取得）。
    - 传 `packageJsonPath` → 内部 `readEngineRange(packageJsonPath)`。
    - 两者都不传 → 抛出明确错误（不回退到 `process.cwd()`，避免读错 package.json）。
  - `version` 默认 `process.version`。
  - `exit` 默认 `process.exit`，`log` 默认 `(m) => process.stderr.write(m + "\n")`。全部可注入，便于测试。
  - 调 `checkNodeVersion`；不符则 `log(message)` 后 `exit(1)`；符合则静默返回。
  - 校验无副作用（只读 + 可能退出），instrumentation 与 bin 即便都触发也无需去重。

**每个入口从自己的可信根传入 packageJsonPath**（review 反馈 #1，已核对各入口的可信根）：
- CLI：`bin/pi-web.js` 用 `path.join(pkgDir, "package.json")`，`pkgDir = path.join(__dirname, "..")`（bin/pi-web.js:17）。
- 生产/dev：`instrumentation.ts` 用相对模块自身解析的绝对路径（不用 cwd，因生产 cwd 是 release root）。
- 发布脚本：从 `$SOURCE_ROOT`（release-common.sh:5）指向的 package.json 取 range，见组件 4。

### 依赖：`semver`

新增显式依赖 `semver`（纯 JS，无原生模块，npm 自身即用它做 engines 检查）。

为什么不手写 major 比对：`>=24 <25` 只是当前值，`engines` 未来可能改为带 minor/patch 的约束（如 `>=24.5 <25`）。手写 major 比对会在那天悄悄判错。`semver.satisfies` 正确处理所有比较符、`||`、prerelease、`v` 前缀，久经考验，无维护负担。

### 版本概念的两个来源（review 反馈 #3）

文档里有两个不同的"版本"，先前混为一谈，现拆清：

| 概念 | 含义 | 唯一来源 | 谁用 |
|---|---|---|---|
| **允许范围** | 运行时可接受的 Node 版本区间，如 `>=24 <25` | `package.json:engines.node` | guard 的 `range` 参数、semver 判断 |
| **已验证/运维固定版本** | 实际部署固定用的、经端到端验证的具体版本 `v24.17.0` | 运维决定，已硬编码于 `scripts/lib/release-common.sh:8` 与 `systemd/pi-web-auth.service:14` | 错误提示里给用户的"建议装这个版本"指引 |

- `engines.node` 是**允许范围的唯一源**，guard 判断只依赖它，代码里不重复写范围字符串。
- `v24.17.0` 是**已验证版本**，出现在错误提示中作为运维推荐；它不是"允许范围"的源，因此不违反"范围唯一源"。为避免第三处硬编码，guard 的错误提示从一个具名常量取该值，并在注释里注明"与 release-common.sh / systemd 保持一致"。

### 组件 2：`instrumentation.ts`（新建，项目根）

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const path = await import("node:path");
    const { assertNodeVersion } = await import("./lib/node-version-guard.cjs");
    // 用模块自身位置解析 package.json，不用 process.cwd()（生产 cwd 是 release root）
    assertNodeVersion({ packageJsonPath: path.join(process.cwd(), "package.json") });
  }
}
```

- 仅在 `NEXT_RUNTIME === "nodejs"` 执行，跳过 edge runtime（middleware 不受影响）。
- Next 16 standalone 会打包并在 server 启动时执行 `register()`，因此**同时覆盖生产 server.js 与 dev**。
- **package.json 路径解析（review 反馈 #1）**：standalone 产物中 `server.js` 与 `package.json` 同在 release root，且 systemd `WorkingDirectory` 即 release root（service:7），故 `process.cwd()` 在生产可信；dev 下 cwd 是项目根，也可信。
  - 本地证据支持此结论：`scripts/build-release.sh:90` 用 `cp -a "$worktree/.next/standalone/." "$stage/"` 把 standalone 目录内容整体拷到 stage 根，server.js 即从 stage 根运行——印证 standalone 根同时含 server.js 与精简 package.json。
  - 官方文档在本环境无法在线核实（nextjs.org 受网络限制）。因此**不作硬假设**：实现阶段必须在 standalone 产物里实测 `package.json` 位于 cwd；若不成立则改用 `import.meta`/`__dirname` 向上解析。此点列入实现阶段验证项与风险表。

### 组件 3：`bin/pi-web.js`（编辑）

**放置点必须在 `require("next")` 之前**（review 反馈 #5）：当前 `bin/pi-web.js:15` 在文件顶部就 `require("next")`。若在错误 Node 版本下运行，Next 自身加载阶段可能先抛难懂错误，guard 来不及给中文提示。因此改为：

1. 顶部先只 `require` 内置模块（`path`、`fs`）与共享 guard 模块。
2. 计算 `pkgDir = path.join(__dirname, "..")`，调用 `assertNodeVersion({ packageJsonPath: path.join(pkgDir, "package.json") })`。
3. 版本检查通过后，再 `require("next")` 及其余逻辑。

即把 `const next = require("next")` 从文件顶部移到版本检查之后。guard 用 `packageJsonPath` 显式传入，从 CLI 自己的可信包根（pkgDir）读取，不依赖 cwd。

**打包约束（已核对）**：`package.json:files` 当前为 `["bin", ".next", ..., "next.config.ts", "package.json"]`，**不含 `lib/`**。若 bin `require("../lib/node-version-guard.cjs")`，npm 发布产物中该文件缺失，CLI 启动会崩。两种解法，实现阶段二选一：
- （推荐）将 `lib/node-version-guard.cjs` 与 `lib/node-version-guard.d.ts` 加入 `package.json:files`（最小增量，仅带上 guard 文件）。
- 或把 guard 放在 bin 可达且已打包的位置（如 `bin/node-version-guard.cjs`），instrumentation 与 bin 都从此处引用。
本设计采用推荐解法：guard 留在 `lib/`，并把这两个文件补进 `files`。

### 组件 4：`scripts/release-production.sh`（编辑，纵深防御第二道防线）

在发布流程早期（`build-release` 之前）加一道 Node 版本前置断言，不符则 `die` 中止发布，让错误版本在**发布阶段**就被拦下。

**不依赖 semver / source node_modules**（review 反馈 #2）：干净源码树的 `node_modules` 尚不存在——`npm ci` 只发生在 detached worktree 内（build-release.sh:86）。若断言在源码树 `require("semver")` 会 `MODULE_NOT_FOUND` 而非版本提示。因此发布前置断言用**纯内置能力**实现，不引入 semver、不依赖 source node_modules：
- 用 `$NODE_BIN -e` 读 `$SOURCE_ROOT/package.json` 的 `engines.node`（review 反馈 #1：从可信的 `$SOURCE_ROOT` 而非 cwd 取），取 `process.version`，做一次仅用 Node 内置的范围判断。
- 这一处 gate 约束固定（`>=24 <25`），判断逻辑简单，可容忍不用 semver；与运行时 guard 的语义一致即可。若判断不符则 `die` 并打印中文提示（含 `v24.17.0`）。
- 放在 `build-release`（含 `npm ci`）**之前**，确保连装依赖的机会都不给错误版本；此时不能依赖任何第三方包，正是用纯内置实现的原因。

## 数据流

1. 进程启动（生产 server.js / dev / CLI / 发布脚本）。
2. 对应入口调用 guard，**从自己可信根显式提供 `packageJsonPath` 或 `engineRange`**（不依赖 cwd）：
   - CLI → `packageJsonPath = pkgDir/package.json`。
   - 生产/dev（instrumentation）→ `packageJsonPath = cwd/package.json`（standalone 与 dev 下 cwd 均可信，实现阶段核实）。
   - 发布脚本 → 从 `$SOURCE_ROOT/package.json` 取 range，纯内置判断（不进 guard 的 semver 路径）。
3. 读到 `range`（允许范围）；取 `process.version` → `current`。
4. `checkNodeVersion(current, range)` 用 semver 判断（运行时三入口）；发布脚本用等价的纯内置判断。
5. 符合 → 静默继续启动；不符 → stderr 打印中文提示（含允许范围 + 已验证版本 `v24.17.0`）→ `exit(1)` / `die`。

## 错误处理

- 版本不符：明确退出码 1 + 中文提示，不进入后续启动逻辑，避免原生模块崩溃的模糊堆栈。
- `packageJsonPath` 与 `engineRange` 都未提供：`assertNodeVersion` 抛出明确错误（不回退 cwd、不静默放行）。
- `package.json` 读取失败或 `engines.node` 缺失：视为配置错误，`readEngineRange` 抛出明确错误，因为无约束源无法保证安全启动。
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
- `readEngineRange`：
  - 传入含 `engines.node` 的临时 package.json → 返回该 range
  - `engines.node` 缺失 / 文件不存在 → 抛出明确错误
- `assertNodeVersion`：
  - 注入合规 version + engineRange → 不调用 exit、不调用 log
  - 注入不合规 version + engineRange → 调用 log（内容含允许范围与 `v24.17.0`）且 exit(1)
  - 传 packageJsonPath（指向临时 package.json）→ 正确读到 range 并判断
  - 既不传 engineRange 也不传 packageJsonPath → 抛出明确错误（不回退 cwd）

发布脚本断言纳入现有 `__tests__/release/release-scripts.test.ts` 风格：
  - 用注入的假 `$NODE_BIN`/伪造 `process.version` 使版本不符 → 断言脚本非零退出、未产出发布产物、输出含中文提示。
  - 断言前置检查在 `build-release`（`npm ci`）之前触发（顺序验证，呼应 review 反馈 #2）。

**表面测试：证明 instrumentation 真被 Next 执行（review 反馈 #4）**

单测和发布测试都无法证明 `instrumentation.ts` 被 Next 加载——若钩子没生效，当前 Node 24 下一切照样通过。需一个 CI 可跑的端到端表面测试，独立于"必须换 Node binary"的手工验证：

- 新增测试（或扩展 `scripts/verify-standalone.mjs`）：启动 standalone `server.js`（以及一个 dev 变体）时，**注入一个使当前 Node 必然不符的允许范围**——通过环境变量把 guard 读到的 `engineRange` 覆盖成排除当前版本的值（如 `>=99`）。为此 guard/instrumentation 需支持一个**仅测试用**的 range 覆盖入口（如 `PI_WEB_TEST_ENGINE_RANGE` 环境变量，仅在明确的测试标志下生效，生产默认忽略）。
- 断言：进程以退出码 1 终止，stderr 含中文版本提示。
- 这样在当前 Node 24 单一环境即可证明"钩子确实执行了 guard"，无需第二个 Node binary。
- 补充：`scripts/verify-standalone.mjs:42` 现用 `process.execPath` 起 server，天然是"当前 Node"，正适合承载此覆盖测试。
- 「非 24 三入口手工验证」仍保留为发布前 checklist 项（用另一 Node binary 实跑一次），但不作为 CI 唯一保证。

## 验收标准

- 在 Node 24 下：生产、dev、CLI 均正常启动，无额外输出。
- 在非 24 版本下：三个入口均以退出码 1 失败，stderr 显示中文版本提示（含允许范围与 `v24.17.0`）。
- 表面测试证明 instrumentation 确被执行：注入排除当前 Node 的允许范围后，standalone/dev 启动即退出码 1 + 中文提示（不需第二个 Node binary）。
- 发布脚本在错误 Node 版本下中止、不产出发布产物，且前置断言在 `npm ci` 之前触发、不依赖 source node_modules。
- CLI guard 在 `require("next")` 之前执行（错误版本先得到中文提示，而非 Next 加载崩溃）。
- **允许范围**（`engines.node`）是唯一约束源；guard 逻辑是唯一运行时判断源；错误提示中的 `v24.17.0`（已验证版本）从具名常量取，与 release-common.sh / systemd 语义一致。
- 每个入口从自己可信根（pkgDir / cwd / $SOURCE_ROOT）读 package.json，guard 无 cwd 隐式回退。
- 新增单测全部通过；`npm run verify`（typecheck + lint + test）通过。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `.cjs` 在 Next TS/ESM 侧 import 的互操作 | Next 16 支持混合模块；`instrumentation.ts` 用动态 `import()`，`.d.ts` 提供类型；实现阶段以 dev 启动实测验证 |
| standalone 是否打包 `lib/node-version-guard.cjs` | instrumentation 引用即会被 Next 追踪打包；实现后需在 standalone 产物中验证文件存在（参考 `scripts/verify-standalone.mjs`） |
| standalone 产物中 package.json 是否在 cwd（review #1） | `output: "standalone"` 会生成精简 package.json 到产物根，systemd WorkingDirectory 即产物根；实现阶段在 verify-standalone 中核实，若不成立改用模块相对路径解析 |
| bin 的相对路径 `../lib/...cjs` 在 npm 安装布局下是否有效 | 已确认 `package.json:files` 不含 `lib/`，实现须将两个 guard 文件补进 `files`（见组件 3 打包约束） |
| 发布前置断言在装依赖前运行、无第三方包可用（review #2） | 该断言用纯 Node 内置实现，不 require semver、不读 source node_modules；运行时三入口才用 semver |
| 仅测试用的 range 覆盖入口被生产误用（review #4） | 覆盖入口（`PI_WEB_TEST_ENGINE_RANGE`）仅在明确测试标志下生效，生产默认忽略；实现阶段确认生产路径不读该变量 |
| 新增 semver 依赖 | semver 纯 JS 无原生、体积小、npm 自身依赖，风险极低 |

## 不做（YAGNI）

- 不做版本自动切换/安装（只校验并提示，切换是运维职责）。
- 不校验 npm/bun 版本（本轮只针对 Node 运行时 ABI 问题）。
- 不引入配置开关跳过校验（安全底线不应可绕过）。
