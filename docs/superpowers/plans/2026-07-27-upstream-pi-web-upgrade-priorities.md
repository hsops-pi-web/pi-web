# 上游 Pi Web 升级优先级

日期：2026-07-27

## 背景

当前项目是一个基于 `@agegr/pi-web@0.6.12` 的定制版本，Pi 相关依赖大致固定在：

| 包 | 当前版本范围 |
|---|---:|
| `@earendil-works/pi-ai` | `^0.75.5` |
| `@earendil-works/pi-coding-agent` | `^0.75.5` |

本仓库已经在 `spike/node24-compat` 上完成 Node.js `v24.17.0` 验证，当前基线应按 `>=24 <25` 统一理解，而不是继续沿用旧的 Node 22 建议。

上游 `agegr/pi-web` 后续已经经过 `0.6.x`、`0.7.x`、`0.8.x` 多个版本线，最新到 `v0.8.1`，Pi 相关依赖已经到 `0.82.1` 附近。

当前项目不是上游的原版安装。它已经加入了本地登录认证、角色边界、多用户工作区、管理员控制台、独立 standalone 生产发布流程、数据备份与回滚流程，以及非 8000 端口验收要求。因此，直接合并上游 `v0.8.1` 风险较高。推荐做法是按优先级选择性迁移。

## P0：必须优先更新

| 上游变更 | 来源版本 | 为什么当前项目需要 | 建议方式 |
|---|---:|---|---|
| 本地 API 和文件系统边界加固 | `v0.8.1` | 当前项目是多用户系统，并暴露文件读取、上传、管理员访问等能力。路径和 Origin 边界属于安全底线。 | 对照 `lib/auth/paths.ts`、`app/api/files`、`app/api/upload` 选择性移植。 |
| 上传、图片附件、输出跟踪路径限制 | `v0.8.1` | 上传会写入用户工作区；图片处理已经实际暴露过产品行为问题。 | 吸收上游安全模型，但必须接入当前项目的 user-root 校验，不能直接覆盖。 |
| 默认绑定 loopback、LAN 模式 Origin 校验 | `v0.8.1` | 8000 是生产服务。如果允许局域网访问，Host / Origin 行为必须明确。 | 审计生产 service 绑定、middleware 和 API Origin 校验。 |
| 发送失败后保留输入内容 | `v0.8.1` | 模型或网络请求失败时不能丢失用户 prompt。 | 低风险前端状态修复，建议独立移植。 |
| 流式新会话在侧边栏可见，并在后台完成后刷新 | `v0.8.1` | 会话不可见会造成“会话丢失”的感受，也会破坏正常导航。 | 对照 `hooks/useAgentSession`、session index、SSE 事件处理。 |
| 防止并发新会话复用同一个 RPC lock | `v0.8.1` | 多用户、多会话使用会放大并发风险。 | 重点审查并加固 `lib/rpc-manager.ts`。 |
| compaction-aware 会话上下文加载和压缩后消息分组修复 | `v0.7.12`、`v0.8.1` | 长会话和自动压缩是核心聊天行为。分组错误会破坏会话展示。 | 移植 session-reader/context 逻辑，并围绕 compaction entry 增加测试。 |
| 明确 Node 版本校验 | `v0.8.1` | 项目已经遇到过 Node ABI 与原生模块不匹配问题。 | 增加启动和发布校验。当前生产稳定性建议固定在 `>=24 <25`，并以 `v24.17.0` 为已验证版本。 |

## P1：高价值，建议近期做

| 上游变更 | 来源版本 | 为什么当前项目需要 | 建议方式 |
|---|---:|---|---|
| 文件浏览器单/多文件上传，支持冲突检测、覆盖和跳过 | `v0.7.15` | 上传是工作区流程的一部分，也能补齐当前附件上传体验。 | 与当前 `uploads/` 行为和用户目录授权统一设计。 |
| Git 工作区状态标记和文件 diff 视图 | `v0.8.0` | coding agent 用户需要直接在 UI 里查看文件改动。 | 可独立移植，不需要同时升级 Pi runtime。 |
| `Cmd+I` 引用文件查看器中选中的代码行 | `v0.8.1` | 这是高频聊天工作流：把精确代码片段带入 prompt。 | 以前端为主移植，同时保持现有文件权限边界。 |
| 输入历史回溯 | `v0.8.1` | 改善聊天输入体验，架构风险低。 | 可作为独立小改动实现。 |
| Markdown 图片预览、LaTeX/KaTeX、Mermaid 渲染与缩放平移 | `v0.6.14`、`v0.8.1` | 改善文档、规格、图表和文件预览阅读体验。 | 分批移植；XSS 和 sanitizer 行为必须纳入验收。 |
| 完整会话历史视图 | `v0.7.12` | 对长会话、分支、compaction 后的历史查看很有价值。 | 需要接入当前 session ownership、indexing、admin visibility 规则。 |
| 长聊天懒渲染和 minimap 测量优化 | `v0.7.13` | 随着 session 数量和聊天长度增长会越来越重要。 | 先测当前长会话性能，再移植。 |
| 会话列表和模型 API 缓存，并支持主动失效 | `v0.7.13` | 大工作区下可降低扫描和 API 成本。 | 移植前需要和当前 session-index 设计对齐。 |
| 新配置的 provider 立即可选 | `v0.8.1` | 能补全模型配置闭环。 | 对照 `ModelsConfig.tsx` 和 `/api/models` 当前行为。 |
| runtime/model 错误可见，错误状态下模型选择器不消失 | `v0.8.1` | 配置失败应该可诊断，UI 不应消失。 | 小范围 UI / state 修复，可独立移植。 |

## P2：有用，但可以后做

| 上游变更 | 来源版本 | 为什么当前项目可能需要 | 建议方式 |
|---|---:|---|---|
| 自动会话命名 | `v0.8.0` | 改善导航，但不是关键稳定性问题。 | 启用前先评估模型调用成本和失败行为。 |
| 通过 `cwd` URL 参数直接进入工作区 | `v0.8.0` | 对分享链接、书签、深链有用。 | 必须经过当前 user-root 授权。 |
| 可浏览目录选择器 | `v0.7.13`、`v0.8.1` | 有帮助，但当前项目已经有 workspace/session 导航。 | 只移植 Web 目录选择器，避免引入桌面 bridge 依赖。 |
| 鼠标中键关闭文件标签页 | `v0.8.0` | 小体验优化。 | 低风险独立改动。 |
| 浏览器标题包含当前 workspace | `v0.7.15` | 多窗口时更容易识别上下文。 | 低风险独立改动。 |
| 全局快捷键：`Esc` 停 Agent、`Ctrl+Alt+N` 新会话 | `v0.7.15` | 对高级用户有用。 | 必须保留 IME 组合输入行为，避免误停止。 |
| `!command` / `!!command` shell 前缀 | `v0.7.17` | 对高级用户很强大。 | 多用户 Web 环境下 shell 执行风险高，默认关闭或由 admin/config 控制。 |
| cache write 用量统计和 compaction token savings 展示 | `v0.6.17`、`v0.8.1` | 有助于成本和上下文观测。 | 可和 usage 展示整理放在同一阶段做。 |

## P3：当前没有必要

| 上游变更 | 来源版本 | 为什么不优先 |
|---|---:|---|
| 产品名从 Pi Agent Web 改为 Pi Web | `v0.8.0` | 当前项目已经是定制版本，品牌命名不是功能缺口。 |
| 日文 README 和文档导航 | `v0.8.1` | 对当前生产功能没有直接价值。 |
| 桌面原生目录选择器 / `piDesktop` bridge | `v0.7.13` | 当前部署是 Web + systemd，不是桌面应用。 |
| `pi-web --no-open` / `PI_WEB_NO_OPEN=1` | `v0.7.13` | 对 standalone/systemd 生产发布流程大概率无关。只有启动行为变更时需要检查。 |
| Windows packaged build 修复 | `v0.7.14` | 当前生产环境是 Linux。 |
| 额外 provider 图标 | `v0.6.15` | 纯视觉补充，除非正在重做模型 UI。 |
| 音频文件预览 | `v0.6.13` | 除非用户经常处理音频，否则价值较低。 |
| headless 自定义 TUI 渲染 | `v0.7.17` | runtime 集成风险高，当前收益不明确。 |
| xAI/Kimi/Grok provider 能力更新 | `v0.7.16` | 属于更大的 Pi runtime 升级，不应只为了 provider 列表升级核心 runtime。 |

## 主要风险

| 风险 | 影响 | 缓解方式 |
|---|---|---|
| Pi runtime 从 `0.75.5` 跳到 `0.82.1` | 中间 ModelRuntime API、auth/OAuth、tool loading、session handling、compaction 行为都变过。 | 不直接升级。单独开 Pi runtime 迁移 spike 分支。 |
| 上游本地/单用户假设和当前多用户 fork 冲突 | 直接复制文件和 cwd 逻辑可能绕过本地用户边界。 | 所有文件/路径相关改动必须经过 `getUserRoot`、`resolveExistingAndCheck` 等当前 guard。 |
| 发布流程不一致 | 上游 npm release 流程不匹配当前 immutable standalone、backup、drain、rollback 流程。 | 不直接复制上游发布脚本，保留当前生产发布流程。 |
| Node/native 依赖不匹配 | `better-sqlite3` 等原生模块可能因 Node ABI 不一致失败。 | 统一 dev/prod Node 版本，并在依赖或 runtime 变更前增加显式检查。 |
| UI 功能移植绕过 admin/user 角色规则 | 上游功能可能没有当前 fork 的模型、工具、会话、文件权限边界。 | 任何涉及 admin、files、models、tools、sessions 的移植都要包含角色/ownership 验收测试。 |

## 推荐实施路线

| 阶段 | 目标 | 包含工作 |
|---|---|---|
| Phase 1：安全和稳定 | 优先消除安全、数据丢失、会话错乱风险。 | 路径/Origin 加固、上传边界、发送失败保留输入、并发 session lock 修复、流式会话可见性、compaction 分组、Node 版本检查。 |
| Phase 2：文件工作流 | 提升 coding agent 的核心使用效率。 | 文件上传冲突处理、Git 状态/diff、选中代码引用、Markdown/Mermaid/LaTeX 预览。 |
| Phase 3：长会话体验 | 让大量历史和大量 session 更可扩展。 | 完整历史、长聊天懒渲染、session/model 缓存、usage/cache-write/token-savings 展示。 |
| Phase 4：可选 UX 优化 | 核心风险降低后增加小型体验能力。 | 输入历史、自动命名、中键关 tab、浏览器标题、快捷键。 |
| Phase 5：Pi runtime 迁移 | 评估升级 Pi 本身是否值得。 | 单独 spike，覆盖 model config、AgentSession、tools、compaction、fork、SSE、provider auth 的端到端验证。 |

## 总体建议

不要直接把上游 `v0.8.1` 合并进当前 fork。应该先基于当前架构 cherry-pick 或重新实现 P0 和部分 P1 行为。Pi runtime 从 `0.75.5` 升到 `0.82.1` 应该作为单独 spike 处理，并要求完整端到端验证。Node.js 基线已经独立验证为 `v24.17.0`，这部分可以先合并回主线，不必再作为迁移风险保留在文档里。
