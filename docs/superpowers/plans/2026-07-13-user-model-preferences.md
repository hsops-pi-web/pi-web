# 用户模型偏好与全局默认隔离实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 聊天模型切换只影响当前会话并记住当前用户偏好，全局默认模型只允许管理员在 Models 界面显式修改。

**Architecture:** 所有 Web AgentSession 使用从文件设置克隆出的内存 `SettingsManager`，Pi 继续写 session jsonl，但不写共享 `settings.json`。SQLite 按 username 保存模型偏好；`GET /api/models` 按“用户偏好 > 全局默认 > 可用模型”解析新会话默认值，管理员通过独立 API 写全局默认。

**Tech Stack:** Next.js 16 App Router、TypeScript、better-sqlite3、`@earendil-works/pi-coding-agent`、Node test runner、React。

**隔离环境:** worktree `/home/hsops/pi-web-auth-model-preferences`，分支 `feat/user-model-preferences`，`HOME=/home/hsops/.pi-model-pref-dev-home`，端口 8144。开发期间不得修改或重启生产 8000。

---

### Task 1: 用户偏好数据层与默认解析

**Files:**
- Modify: `lib/auth/db.ts`
- Create: `lib/auth/model-preferences.ts`
- Create: `__tests__/lib/auth/model-preferences.test.ts`

- [ ] **Step 1: 写失败测试**

测试使用临时 HOME，覆盖两个用户互不影响、UPSERT、删除，以及“用户偏好 > 全局默认 > 首个可用模型”：

```ts
test("stores isolated preferences and upserts", () => {
  setUserModelPreference("alice", "glm", "glm-5.2");
  setUserModelPreference("bob", "qwen", "qwen3.6");
  setUserModelPreference("alice", "opus", "claude-opus");
  assert.deepEqual(getUserModelPreference("alice"), { provider: "opus", modelId: "claude-opus" });
  assert.deepEqual(getUserModelPreference("bob"), { provider: "qwen", modelId: "qwen3.6" });
  deleteUserModelPreference("alice");
  assert.equal(getUserModelPreference("alice"), null);
});

test("resolves effective default with validity checks", () => {
  const available = [{ provider: "glm", id: "glm-5.2" }, { provider: "qwen", id: "qwen3.6" }];
  assert.deepEqual(resolveEffectiveDefault(available, { provider: "qwen", modelId: "qwen3.6" }, { provider: "glm", modelId: "glm-5.2" }), { provider: "qwen", modelId: "qwen3.6" });
  assert.deepEqual(resolveEffectiveDefault(available, { provider: "gone", modelId: "gone" }, { provider: "glm", modelId: "glm-5.2" }), { provider: "glm", modelId: "glm-5.2" });
  assert.deepEqual(resolveEffectiveDefault(available, null, { provider: "gone", modelId: "gone" }), { provider: "glm", modelId: "glm-5.2" });
});
```

测试 setup 必须在首次 `getDb()` 前设置临时 `HOME` 和 `globalThis.__piAuthDb = undefined`，teardown 关闭数据库并删除临时目录。

- [ ] **Step 2: 运行测试确认 RED**

```bash
HOME=/home/hsops/.pi-model-pref-dev-home node --experimental-strip-types --test __tests__/lib/auth/model-preferences.test.ts
```

Expected: FAIL，`lib/auth/model-preferences.ts` 不存在。

- [ ] **Step 3: 增加表和最小实现**

`lib/auth/db.ts` 初始化 SQL 增加：

```sql
CREATE TABLE IF NOT EXISTS user_model_preferences (
  username TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`lib/auth/model-preferences.ts` 导出：

```ts
export interface ModelRef { provider: string; modelId: string }
export interface AvailableModelRef { provider: string; id: string }

export function getUserModelPreference(username: string): ModelRef | null;
export function setUserModelPreference(username: string, provider: string, modelId: string): void;
export function deleteUserModelPreference(username: string): void;
export function resolveEffectiveDefault(
  available: readonly AvailableModelRef[],
  userPreference: ModelRef | null,
  globalDefault: ModelRef | null
): ModelRef | null;
```

存储使用 `INSERT ... ON CONFLICT(username) DO UPDATE`，`updated_at` 写 ISO 时间。解析函数只接受仍在 available 中的引用，否则继续回退，最终把 available[0] 转成 `{provider, modelId}`。

- [ ] **Step 4: GREEN、全量测试和提交**

```bash
HOME=/home/hsops/.pi-model-pref-dev-home node --experimental-strip-types --test __tests__/lib/auth/model-preferences.test.ts
HOME=/home/hsops/.pi-model-pref-dev-home npm test
git add lib/auth/db.ts lib/auth/model-preferences.ts __tests__/lib/auth/model-preferences.test.ts
git commit -m "feat: 增加用户模型偏好存储与默认解析"
```

Expected: 新测试及全量 auth 测试通过。

---

### Task 2: 会话级 SettingsManager 隔离

**Files:**
- Create: `lib/session-settings.ts`
- Create: `__tests__/lib/auth/session-settings.test.ts`
- Modify: `lib/rpc-manager.ts`

- [ ] **Step 1: 写磁盘不变的失败测试**

创建临时 `agent/settings.json` 和 `project/.pi/settings.json`，记录原始字节，调用 `createSessionSettingsManager()` 后执行：

```ts
const settings = createSessionSettingsManager(cwd, agentDir);
assert.deepEqual(settings.getExtensionPaths(), ["project-ext"]);
settings.setDefaultModelAndProvider("qwen", "qwen3.6");
settings.setDefaultThinkingLevel("low");
await settings.flush();
assert.equal(settings.getDefaultModel(), "qwen3.6");
assert.equal(readFileSync(globalPath, "utf8"), beforeGlobal);
assert.equal(readFileSync(projectPath, "utf8"), beforeProject);
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --experimental-strip-types --test __tests__/lib/auth/session-settings.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现内存存储工厂**

`lib/session-settings.ts`：

```ts
import { SettingsManager } from "@earendil-works/pi-coding-agent";

type Scope = "global" | "project";
type Updater = (current: string | undefined) => string | undefined;

class SessionMemorySettingsStorage {
  private values: Record<Scope, string | undefined>;
  constructor(globalSettings: object, projectSettings: object) {
    this.values = {
      global: JSON.stringify(globalSettings, null, 2),
      project: JSON.stringify(projectSettings, null, 2),
    };
  }
  withLock(scope: Scope, update: Updater): void {
    const next = update(this.values[scope]);
    if (next !== undefined) this.values[scope] = next;
  }
}

export function createSessionSettingsManager(cwd: string, agentDir: string): SettingsManager {
  const persisted = SettingsManager.create(cwd, agentDir);
  return SettingsManager.fromStorage(new SessionMemorySettingsStorage(
    persisted.getGlobalSettings(),
    persisted.getProjectSettings()
  ));
}
```

- [ ] **Step 4: 确认 GREEN 并接入 rpc-manager**

`startRpcSession()` 始终创建 `const settingsManager = createSessionSettingsManager(canonicalCwd, agentDir)`，传给 `createAgentSession()`。有额外 extension 时，`DefaultResourceLoader` 也使用同一 manager。删除原先只在有额外 extension 时创建文件型 manager 的分支。

- [ ] **Step 5: 测试、lint、提交**

```bash
HOME=/home/hsops/.pi-model-pref-dev-home npm test
npx eslint lib/session-settings.ts lib/rpc-manager.ts __tests__/lib/auth/session-settings.test.ts
git add lib/session-settings.ts lib/rpc-manager.ts __tests__/lib/auth/session-settings.test.ts
git commit -m "fix: 隔离聊天会话对全局设置的写入"
```

Expected: 测试通过，定向 lint 无 error。

---

### Task 3: 模型切换成功后保存偏好

**Files:**
- Create: `lib/model-selection.ts`
- Create: `__tests__/lib/auth/model-selection.test.ts`
- Modify: `lib/auth/session-guard.ts`
- Modify: `app/api/agent/new/route.ts`
- Modify: `app/api/agent/[id]/route.ts`

- [ ] **Step 1: 写成功保存、失败不保存的测试**

```ts
test("remembers only after switching succeeds", async () => {
  const calls: string[] = [];
  const session = { send: async () => { calls.push("switch"); return { id: "qwen3.6" }; } };
  await switchModelAndRemember(session, "alice", "qwen", "qwen3.6", () => calls.push("remember"));
  assert.deepEqual(calls, ["switch", "remember"]);
});

test("does not remember a failed switch", async () => {
  let remembered = false;
  const session = { send: async () => { throw new Error("unavailable"); } };
  await assert.rejects(switchModelAndRemember(session, "alice", "gone", "gone", () => { remembered = true; }), /unavailable/);
  assert.equal(remembered, false);
});
```

- [ ] **Step 2: RED 后实现 helper**

```ts
export async function switchModelAndRemember(
  session: { send(command: Record<string, unknown>): Promise<unknown> },
  username: string,
  provider: string,
  modelId: string,
  remember = setUserModelPreference
): Promise<unknown> {
  const result = await session.send({ type: "set_model", provider, modelId });
  remember(username, provider, modelId);
  return result;
}
```

先运行单测确认缺少模块的 RED，再实现并确认 2 tests PASS。

- [ ] **Step 3: 接入新会话和已有会话**

`SessionGuardResult` 成功结果增加 `username`，所有成功 return 透传。`agent/new` 用 helper 替换直接 `session.send(set_model)`。`agent/[id]` 在 operation guard 中仅对 `body.type === "set_model"` 校验 provider/modelId 后调用 helper，其他命令保持 `session.send(body)`。

- [ ] **Step 4: 全量测试、lint、提交**

```bash
HOME=/home/hsops/.pi-model-pref-dev-home npm test
npx eslint lib/model-selection.ts lib/auth/session-guard.ts app/api/agent/new/route.ts 'app/api/agent/[id]/route.ts' __tests__/lib/auth/model-selection.test.ts
git add lib/model-selection.ts lib/auth/session-guard.ts app/api/agent/new/route.ts 'app/api/agent/[id]/route.ts' __tests__/lib/auth/model-selection.test.ts
git commit -m "feat: 模型切换后保存用户偏好"
```

Expected: 失败切换不写偏好，成功切换先改变会话再保存偏好。

---

### Task 4: `/api/models` 返回用户有效默认

**Files:**
- Modify: `app/api/models/route.ts`
- Modify: `__tests__/lib/auth/model-list.test.ts`

- [ ] **Step 1: 增加失效偏好回退测试并确认 RED**

```ts
test("invalid preference falls back to available global default", () => {
  const effective = resolveEffectiveDefault(
    models,
    { provider: "removed", modelId: "removed" },
    { provider: "glm", modelId: "glm-5.2" }
  );
  assert.deepEqual(effective, { provider: "glm", modelId: "glm-5.2" });
  assert.equal(orderAvailableModels(models, effective, [])[0].id, "glm-5.2");
});
```

Run: `node --experimental-strip-types --test __tests__/lib/auth/model-list.test.ts`。
Expected: 缺少 `resolveEffectiveDefault` 导入时 FAIL；接入 Task 1 导出后 PASS。

- [ ] **Step 2: 接入用户偏好和全局默认**

保持现有全局设置解析，但将其命名为 `globalDefaultModel`。读取 `getUserModelPreference(username)` 后：

```ts
defaultModel = resolveEffectiveDefault(
  availableModels,
  getUserModelPreference(username),
  globalDefaultModel
);
modelList = orderAvailableModels(availableModels, defaultModel, configuredModelKeys);
```

响应增加 `globalDefaultModel`，原 `defaultModel` 改为当前用户有效默认。普通用户仍可访问模型列表，不获得任何凭据。

- [ ] **Step 3: 测试、lint、提交**

```bash
HOME=/home/hsops/.pi-model-pref-dev-home npm test
npx eslint app/api/models/route.ts __tests__/lib/auth/model-list.test.ts
git add app/api/models/route.ts __tests__/lib/auth/model-list.test.ts
git commit -m "feat: 新会话优先使用用户模型偏好"
```

---

### Task 5: 管理员显式设置全局默认 API

**Files:**
- Create: `app/api/models-config/default/route.ts`

- [ ] **Step 1: 实现 admin-only PUT**

路由必须先 `requireAdmin(req)`，再校验 body 中非空 provider/modelId。核心实现：

```ts
const agentDir = getAgentDir();
const registry = ModelRegistry.create(AuthStorage.create());
const model = registry.find(provider, modelId);
if (!model || !registry.hasConfiguredAuth(model)) {
  return NextResponse.json({ error: "模型不存在或未配置鉴权" }, { status: 400 });
}
const settings = SettingsManager.create(process.cwd(), agentDir);
settings.setDefaultModelAndProvider(provider, modelId);
await settings.flush();
return NextResponse.json({ globalDefaultModel: { provider, modelId } });
```

未登录、普通用户、无效模型、写入异常分别返回 401、403、400、500。

- [ ] **Step 2: 在隔离 HOME 启动 8144 并验证权限**

```bash
mkdir -p /home/hsops/.pi-model-pref-dev-home/.pi/agent
cp /home/hsops/.pi/agent/models.json /home/hsops/.pi-model-pref-dev-home/.pi/agent/models.json
HOME=/home/hsops/.pi-model-pref-dev-home npm run dev -- -p 8144
```

通过注册接口创建 `hsops` 和普通用户 `alice`，登录 cookie 保存为 mode 600 临时文件。依次调用 PUT：无 cookie 为 401、alice 为 403、hsops 设置有效模型为 200、hsops 设置不存在模型为 400。成功后隔离 `settings.json` 的 provider/model 必须更新。

- [ ] **Step 3: 停 dev、测试、lint、提交**

```bash
HOME=/home/hsops/.pi-model-pref-dev-home npm test
npx eslint app/api/models-config/default/route.ts
git add app/api/models-config/default/route.ts
git commit -m "feat: 管理员显式设置全局默认模型"
```

Expected: 8144 停止，生产 `curl http://127.0.0.1:8000/login` 仍为 200。

---

### Task 6: Models 界面增加全局默认控制

**Files:**
- Modify: `components/ModelsConfig.tsx`

- [ ] **Step 1: 增加类型、状态和加载函数**

新增 `AvailableModel`、`ModelRef`，并用 `JSON.stringify([provider, modelId])` 生成无分隔符冲突的 option value。组件状态包括 availableModels、globalDefaultModel、selectedDefaultKey、defaultSaving 和 defaultStatus。

```ts
const loadModelDefaults = useCallback(async () => {
  const res = await authFetch("/api/models");
  const data = await res.json() as {
    modelList?: AvailableModel[];
    globalDefaultModel?: ModelRef | null;
  };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const globalDefault = data.globalDefaultModel ?? null;
  setAvailableModels(data.modelList ?? []);
  setGlobalDefaultModel(globalDefault);
  setSelectedDefaultKey(globalDefault ? JSON.stringify([globalDefault.provider, globalDefault.modelId]) : "");
}, []);
```

初始 effect 调用该函数，错误写入现有 saveError/error 区域。

- [ ] **Step 2: 增加显式保存 handler**

```ts
const handleSetGlobalDefault = useCallback(async () => {
  if (!selectedDefaultKey || defaultSaving) return;
  const [provider, modelId] = JSON.parse(selectedDefaultKey) as [string, string];
  setDefaultSaving(true);
  setDefaultStatus(null);
  try {
    const res = await authFetch("/api/models-config/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, modelId }),
    });
    const data = await res.json() as { globalDefaultModel?: ModelRef; error?: string };
    if (!res.ok || !data.globalDefaultModel) throw new Error(data.error ?? `HTTP ${res.status}`);
    setGlobalDefaultModel(data.globalDefaultModel);
    setDefaultStatus("saved");
  } catch (error) {
    setDefaultStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setDefaultSaving(false);
  }
}, [defaultSaving, selectedDefaultKey]);
```

- [ ] **Step 3: 增加响应式工具栏**

在 Models header 下方增加非卡片工具栏：原生 select 列出 `provider / name`，命令按钮文案 `Set global default`，当前默认显示 `Default`，保存中禁用重复提交。桌面单行，窄屏允许换行；select `minWidth: 0`、容器 `flexWrap: "wrap"`，不得横向溢出。

- [ ] **Step 4: lint、8144 桌面/移动验收、提交**

```bash
npx eslint components/ModelsConfig.tsx
HOME=/home/hsops/.pi-model-pref-dev-home npm run dev -- -p 8144
```

用管理员验证保存与刷新；在 1440x900 和 390x844 截图检查无重叠。普通用户仍看不到 Models。停止 dev 后：

```bash
git add components/ModelsConfig.tsx
git commit -m "feat: Models界面支持设置全局默认模型"
```

---

### Task 7: 删除联动、文档和完整隔离验收

**Files:**
- Modify: `lib/auth/delete-user.ts`
- Modify: `docs/superpowers/specs/2026-07-13-user-model-preferences-design.md`

- [ ] **Step 1: 原子删除用户记录与偏好**

文件和 jsonl 删除成功后，用 transaction 替换单独 users 删除：

```ts
db.transaction(() => {
  db.prepare("DELETE FROM user_model_preferences WHERE username=?").run(username);
  db.prepare("DELETE FROM users WHERE username=?").run(username);
})();
```

- [ ] **Step 2: 全量测试、改动文件 lint 和类型检查**

```bash
HOME=/home/hsops/.pi-model-pref-dev-home npm test
npx eslint lib/auth/model-preferences.ts lib/session-settings.ts lib/model-selection.ts lib/auth/session-guard.ts lib/auth/delete-user.ts app/api/models/route.ts app/api/models-config/default/route.ts app/api/agent/new/route.ts 'app/api/agent/[id]/route.ts' components/ModelsConfig.tsx
node_modules/.bin/tsc --noEmit 2>&1 | tee /tmp/pi-model-tsc.log
```

Expected: auth tests 全绿，改动文件 lint 无 error。若 tsc 仍报告基线 Jest/Testing Library 和 `.ts` import 配置错误，过滤这些已知测试错误后不得出现生产源码错误。

- [ ] **Step 3: 8144 多用户端到端验收**

1. 管理员显式设置全局模型 G。
2. 记录隔离 `settings.json` SHA-256。
3. alice 切换模型 A 并成功发送一轮，bob 切换模型 B 并成功发送一轮。
4. SHA-256 必须不变。
5. 分别请求 `/api/models`：alice 默认 A、bob 默认 B，globalDefaultModel 都为 G。
6. 管理员聊天切换模型只更新管理员偏好，全局仍为 G。
7. 删除测试用户后，users、sessions、user_model_preferences 和用户目录均无残留。
8. 普通用户 Models/Skills API 保持 403；生产 8000 登录页保持 200。

- [ ] **Step 4: 更新实现记录并提交**

在设计文档末尾记录提交、自动测试数量、8144 验收结果和生产未受影响。

```bash
git add lib/auth/delete-user.ts docs/superpowers/specs/2026-07-13-user-model-preferences-design.md
git commit -m "feat: 删除用户时清理模型偏好"
```

- [ ] **Step 5: 最终检查**

```bash
git status --short
git log --oneline main..HEAD
git diff --check main...HEAD
```

Expected: worktree clean，diff check 无输出。保持功能分支和 8144 验收环境；未经明确发布授权不合并、不 build、不重启生产。
