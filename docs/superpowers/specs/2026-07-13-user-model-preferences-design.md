# 用户模型偏好与全局默认隔离设计

日期：2026-07-13
分支：`feat/user-model-preferences`
生产：`main` worktree `/home/hsops/pi-web-auth`，用户级 `pi-web-auth.service`，端口 8000
开发：worktree `/home/hsops/pi-web-auth-model-preferences`，隔离 HOME `/home/hsops/.pi-model-pref-dev-home`，端口 8144

## 1. 背景

Pi 的 `AgentSession.setModel()` 会同时把模型变更写入当前会话 jsonl 和全局
`~/.pi/agent/settings.json`。在多用户 Web 服务中，这意味着任意用户在聊天中切换模型都可能改变其他用户新会话的默认模型。

本功能把聊天会话状态、用户个人偏好和管理员全局默认拆成三个独立层级，避免共享配置竞争，同时保留用户对后续新会话的模型记忆。

## 2. 目标与非目标

### 目标

- 所有用户在聊天中切换模型时，只改变当前 AgentSession，不写全局 `settings.json`。
- 模型切换成功后，将该模型保存为当前用户的个人偏好。
- 用户创建新会话时优先使用自己的有效偏好。
- 管理员通过 Models 界面的独立操作设置全局默认模型。
- 管理员在聊天中切换模型也只更新管理员自己的偏好，不隐式修改全局默认。
- thinking level 的聊天切换同样只作用于会话，不写全局设置。

### 非目标

- 不保存用户级 thinking level、工具预设或其他 Pi 设置。
- 不自动覆盖所有用户已有偏好。
- 不修改生产 8000 或生产数据，直至功能完成、用户验收并明确进入发布阶段。

## 3. 默认模型优先级

从高到低：

1. 已有会话 jsonl 中最后一个有效 `model_change`。
2. 当前用户的有效模型偏好。
3. 管理员设置的全局默认模型。
4. ModelRegistry 中首个可用模型。

用户偏好或全局默认只有在 provider/model 仍位于 `ModelRegistry.getAvailable()` 时才有效。失效记录保留在数据库中，但本次请求回退到下一层；模型重新可用后偏好可再次生效。

## 4. 数据模型

在 `~/.pi-web-auth/auth.db` 增加：

```sql
CREATE TABLE IF NOT EXISTS user_model_preferences (
  username   TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  model_id   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- 现有用户不回填，首次使用时自然回退全局默认。
- 使用 UPSERT 保存用户偏好。
- 删除用户时显式删除对应偏好，不能依赖未统一启用的 SQLite foreign key pragma。

## 5. 会话设置隔离

新增一个创建会话级 `SettingsManager` 的模块：

1. 用普通 `SettingsManager` 读取全局与项目设置。
2. 把两层原始设置装入仅存在于当前进程内存中的 `SettingsStorage`。
3. 把该 manager 传给 `createAgentSession()` 和 `DefaultResourceLoader`。

Pi 后续调用 `setDefaultModelAndProvider()` 或 `setDefaultThinkingLevel()` 时，只更新这个会话内存副本。模型变更仍由 Pi 正常追加到 session jsonl，项目级 extensions/skills 等设置仍可被读取，但磁盘上的全局和项目设置均不会被聊天操作改写。

所有 Web AgentSession 都使用该隔离 manager，不根据角色开放隐式磁盘写入。管理员全局修改走独立 API。

## 6. 用户偏好读写

新增 `lib/auth/model-preferences.ts`，提供：

- `getUserModelPreference(username)`
- `setUserModelPreference(username, provider, modelId)`
- `deleteUserModelPreference(username)`
- `resolveEffectiveDefault(available, userPreference, globalDefault)` 纯函数

写入时机：

- 新会话显式选择模型：`session.send({type: "set_model"})` 成功后 UPSERT。
- 已有会话切换模型：`set_model` 命令成功后 UPSERT。
- 模型查找、鉴权或切换失败：不更新偏好。

若模型已切换但 SQLite 写入失败，命令返回错误并保留当前会话已完成的模型切换；客户端可重试同一选择，服务端不得谎报偏好已保存。

## 7. API

### `GET /api/models`

保持所有登录用户可访问。返回：

- `defaultModel`：当前登录用户的有效默认模型，用于新会话预选。
- `globalDefaultModel`：当前管理员全局默认；该值不是凭据，可对登录用户返回。
- 其余 `modelList`、thinking 元数据保持现有契约。

`modelList` 按当前用户的 `defaultModel` 优先排序，其后是显式配置模型与其他可用模型。

### `PUT /api/models-config/default`

仅 `admin` / `super_admin`：

```json
{"provider":"glm-5.1","modelId":"glm-5.2"}
```

服务端必须：

1. 通过 `requireAdmin` 鉴权。
2. 用 ModelRegistry 验证模型存在且已配置鉴权。
3. 用文件型 `SettingsManager` 写入全局 provider/model 并 `flush()`。
4. 返回新的 `globalDefaultModel`。

普通用户返回 403，未登录返回 401，无效或无鉴权模型返回 400，写入失败返回 500。

## 8. Models 管理界面

Models 弹窗头部下方增加紧凑的全局默认工具栏：

- 模型下拉列出 `/api/models` 的可用模型。
- 当前全局默认模型作为选中值。
- “设为全局默认”是显式命令按钮。
- 保存期间禁用重复提交；成功后刷新模型数据并显示短暂成功状态；失败显示服务端错误。
- 工具栏仅存在于本来就仅管理员可见的 Models 界面，服务端仍独立执行权限检查。

不在聊天模型下拉中加入全局设置入口。

## 9. 删除与并发

- `deleteUserCompletely()` 在删除 users 记录前删除模型偏好，并继续沿用现有删除锁。
- 偏好以 username 为主键，UPSERT 保证同一用户最后一次成功选择生效。
- 不同用户写不同主键，不共享偏好状态。
- 所有聊天会话不再写 `settings.json`，从根源消除用户间文件写竞争。
- 管理员全局默认仍使用 Pi `FileSettingsStorage` 的文件锁与字段级合并。

## 10. 测试与验收

### 自动测试

- 会话 SettingsManager 能读取全局和项目设置，模型/thinking 修改后磁盘文件字节不变。
- 用户偏好 UPSERT、用户间隔离和删除。
- 默认解析优先级：用户偏好、全局默认、注册表兜底。
- 偏好失效时回退且不把失效模型放到首位。
- 模型切换失败不写偏好，成功后写偏好。
- 普通用户调用全局默认 API 为 403，管理员有效写入成功，无效模型为 400。
- 删除用户同时删除偏好。

### 隔离验收

在 `HOME=/home/hsops/.pi-model-pref-dev-home`、8144 端口执行：

1. 创建管理员、用户 A、用户 B。
2. 管理员设置全局默认为模型 G。
3. A 选择模型 A，B 选择模型 B，确认各自新会话预选不同模型。
4. 对比聊天切换前后隔离 HOME 下 `.pi/agent/settings.json` 校验值不变。
5. 管理员聊天切换模型不改变全局默认；Models 显式设置才改变。
6. 删除/停用偏好模型后确认回退全局默认。
7. 确认普通用户仍看不到 Models/Skills，配置 API 仍为 403。

生产 8000 在开发和验收期间保持运行且不修改。发布继续遵循 `AGENTS.md` 的备份、合并、构建和 systemd 流程。

## 11. 实施记录

实施分支为 `feat/user-model-preferences`，提交包括：

- `21f6bc4`：用户偏好存储与默认解析。
- `4507ca1`：会话 SettingsManager 内存隔离。
- `46167aa`：模型切换成功后保存用户偏好。
- `7d0bb4c`：新会话优先使用用户模型偏好。
- `2f5b8ff`：管理员显式设置全局默认 API。
- `d466965`：Models 界面全局默认控制。

最终验收在隔离 HOME 和 8144 端口完成：

- auth 测试 `54/54` 通过，所有改动文件 ESLint 通过。
- `tsc --noEmit` 仅保留仓库既有的测试配置错误：缺少 Jest/Testing Library 类型，以及测试文件 `.ts` 导入扩展未启用；生产源码无新增类型错误。
- Alice、Bob、管理员分别保存不同模型偏好，`GET /api/models` 返回各自默认模型且模型列表首项一致。
- 无显式模型参数的新会话恢复用户偏好；自动预选不会被误写成用户偏好，手动选择才会记忆。
- 聊天模型和 thinking level 切换前后，隔离 `settings.json` 的 SHA-256 保持不变；管理员聊天切换不改变全局默认。
- 普通用户界面不显示 Models、Skills 和后台入口，但聊天模型选择器仍显示完整可用列表；配置 API 返回 403。
- 删除临时用户后，users、sessions、user_model_preferences 和用户工作目录均无残留。
- 管理员 Models 界面已在 1440x900 和 390x844 验证，无横向溢出，并能显式保存及恢复全局默认。
- 生产 `http://127.0.0.1:8000/login` 持续返回 200；未合并、未构建、未重启生产服务。
