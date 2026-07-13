# pi-web-auth

基于 [pi 编程智能体](https://github.com/badlogic/pi-mono) 二次开发的多用户网页界面。当前版本需要从本仓库源码本地构建，生产服务通过 `.next/` 下的构建产物启动。

网页端支持用户注册登录、工作目录隔离、历史会话浏览、实时对话、模型切换，以及基于角色的管理后台。管理员可查看和管理用户，普通用户不能访问 Models、Skills 和全局 provider 配置。

## 本地源码启动

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev   # http://localhost:8000
```

生产机的 8000 端口由 `pi-web-auth.service` 使用。隔离开发应使用独立 HOME 和其他端口，例如：

```bash
HOME=/home/hsops/.pi-admin-dev-home npm run dev -- -p 8133
```

生产模式需要先生成 `.next/` 构建产物：

```bash
npm run build
npm run start # http://localhost:8000
```

`npm run start` 使用 `next start -p 8000`，读取 `.next/` 目录中的生产构建。代码更新后必须重新执行 `npm run build`，否则服务仍会运行旧的页面和 API。

## 配置本地 AI 模型

本地模型建议使用 OpenAI-compatible 接口接入，例如 Ollama、LM Studio、vLLM、SGLang 或 LiteLLM。`baseUrl` 可以直接使用 `http://`，不要求 HTTPS。

在网页里点击侧边栏底部的 **Models**，添加自定义 provider：

- **Provider name**：例如 `local-openai` 或 `ollama`
- **Base URL**：例如 `http://127.0.0.1:11434/v1`、`http://127.0.0.1:1234/v1`
- **API**：选择 `openai-completions`
- **API Key**：本地服务没有真实密钥时也需要填一个占位值，例如 `local`、`dummy`、`ollama`
- **Model ID**：必须和本地服务暴露的模型 id 一致，例如 `qwen2.5-coder:7b`

也可以直接编辑 `~/.pi/agent/models.json`：

```bash
mkdir -p ~/.pi/agent
nano ~/.pi/agent/models.json
```

最小示例：

```json
{
  "providers": {
    "local-openai": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [
        {
          "id": "qwen2.5-coder:7b",
          "name": "Qwen2.5 Coder 7B (Local)"
        }
      ]
    }
  }
}
```

`apiKey` 字段不能省略，否则模型不会出现在可选列表里；但对不需要鉴权的本地服务，它只是占位字符串，服务端通常会忽略。普通字符串会先按环境变量名解析，环境变量不存在时就按字面值使用，所以 `local`、`dummy` 都可以。

如果本地 OpenAI-compatible 服务不支持 `developer` role 或 `reasoning_effort`，可以加兼容配置：

```json
{
  "providers": {
    "local-openai": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen2.5-coder:7b",
          "name": "Qwen2.5 Coder 7B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

部分 Responses API 兼容网关不接受 Pi AgentSession 的 `session_id` 缓存亲和请求头。简单模型测试正常、实际对话返回 HTTP 400 时，可在对应模型上关闭该请求头：

```json
{
  "api": "openai-responses",
  "compat": {
    "sendSessionIdHeader": false
  }
}
```

如果希望新会话默认使用本地模型，可编辑 `~/.pi/agent/settings.json`：

```json
{
  "defaultProvider": "local-openai",
  "defaultModel": "qwen2.5-coder:7b"
}
```

通过 Models 面板保存后通常不需要重启服务；刷新页面或重新打开模型下拉即可看到新模型。已有会话需要在输入栏模型下拉中切换，新会话才会使用新的默认模型。

## 使用 systemctl 管理服务

推荐使用用户级 systemd 服务运行本仓库的生产构建。服务会以当前用户身份读取 `~/.pi/agent` 下的会话、模型和 skill 配置。

先在仓库目录生成生产构建：

```bash
cd /home/hsops/pi-web-auth
npm install
npm run build
```

创建用户级服务文件：

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/pi-web-auth.service
```

写入以下内容；如果仓库路径不同，请同步修改 `WorkingDirectory`：

```ini
[Unit]
Description=Pi Agent Web (auth, 8000)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/hsops/pi-web-auth
Environment=NODE_ENV=production
Environment=REGISTER_KEYWORD=replace-with-registration-keyword
ExecStart=/home/hsops/.nvm/versions/node/v22.20.0/bin/node /home/hsops/pi-web-auth/node_modules/next/dist/bin/next start -p 8000
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=default.target
```

启用并启动服务：

```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-web-auth
```

常用管理命令：

```bash
systemctl --user status pi-web-auth
systemctl --user restart pi-web-auth
systemctl --user stop pi-web-auth
journalctl --user -u pi-web-auth -f
```

如果需要开机后即使未登录也自动启动用户服务：

```bash
sudo loginctl enable-linger "$USER"
```

更新服务版本：

```bash
cd /home/hsops/pi-web-auth
git switch main
git pull --ff-only
npm ci
systemctl --user stop pi-web-auth
npm run build
systemctl --user start pi-web-auth
curl -fsS http://127.0.0.1:8000/login >/dev/null
```

`pi-web-auth.service` 使用 `next start` 读取 `.next/` 下的生产构建。仅拉取代码并重启服务不会重新编译页面和 API，仍可能继续运行旧构建。

### 生产数据备份

生产数据位于代码仓库之外，合并或切换 Git 分支不会覆盖这些目录：

- `~/.pi-web-auth/auth.db`：用户、角色、禁用状态和登录 session
- `~/pi-users/<username>/`：每个用户的工作目录
- `~/.pi/agent/sessions/`：Pi 对话 jsonl
- `~/.pi/agent/models.json`、`settings.json`：模型和默认设置

发布前应停止服务后创建一致性快照，至少包含以上目录。恢复时先停止服务，把备份恢复到原路径并保留文件所有者和权限，再启动 `pi-web-auth.service`。

## 已实现功能

- **用户与角色** — 支持 `user`、`admin`、`super_admin`，禁用账号会立即撤销其登录 session
- **管理后台** — `/admin` 支持用户列表、角色管理、禁用和彻底删除用户，并可只读查看目标用户的文件与对话
- **多用户隔离** — 普通用户只能访问 `~/pi-users/<username>` 下的工作目录和归属会话
- **配置权限** — Models、Skills、provider/API Key 配置仅管理员可见且由服务端强制鉴权
- **会话浏览器** — 按工作目录分组展示 `~/.pi/agent/sessions` 下的 pi 会话，支持历史会话读取和孤儿会话提示
- **实时对话** — 通过 SSE 流式输出与智能体实时交互，刷新页面后可自动重连仍在运行的会话
- **会话分叉** — 从任意用户消息创建独立的新会话分支，并在侧边栏中展示父子关系
- **会话内分支** — 支持回退到同一会话内的任意节点继续对话，保留同一 `.jsonl` 文件内的分支结构
- **分支导航器** — 可视化切换同一会话内的不同消息分支
- **模型管理与切换** — 支持网页编辑 `models.json`、配置 OpenAI-compatible provider、设置默认模型，并在对话中途切换模型
- **OAuth / API Key 管理** — Models 面板可管理受支持 provider 的登录状态和 API Key
- **思考强度控制** — 根据模型能力展示 thinking 选项，支持在输入栏切换
- **工具预设面板** — 支持关闭工具、默认工具和完整工具预设，新会话创建时会按当前预设传入 tool names
- **Skills 管理** — 支持查看、搜索、安装和启停 pi skills，包含用户级和项目级 skill
- **压缩会话** — 支持手动压缩长会话，并兼容新旧 compaction SSE 事件
- **引导 / 追加** — 智能体运行中可发送 steer 指令，完成后可继续追加 follow-up 消息
- **上下文与用量展示** — 顶部栏显示上下文窗口占用、输入 / 输出 token、缓存命中和成本信息
- **完成提示音** — 可在输入栏切换智能体完成后的声音提醒
- **文件浏览器** — 侧边栏内置当前工作目录文件树，可在标签页中打开文件
- **文本 / Markdown / 代码预览** — 支持文本、Markdown 和代码文件预览，文件变化后可自动刷新
- **图片预览与下载** — 支持常见图片文件预览，图片文件可直接下载
- **音频预览与下载** — 支持常见音频文件播放和下载
- **二进制文件下载** — 不适合浏览器预览的文件会展示下载入口
- **图片上传输入** — 输入栏支持选择、拖拽或粘贴图片，图片随消息作为多模态输入发送给智能体
- **文本 / 文档上传** — 支持上传 `txt`、`md`、`markdown`、`pdf`、`doc`、`docx`、`xls`、`xlsx`、`csv`、`ppt`、`pptx` 文件，保存到当前工作目录 `uploads/` 下，并把附件路径自动追加到消息中
- **消息内下载按钮** — 智能体回复中出现相对文件路径时，会自动生成下载按钮，便于下载生成的文本、图片或其他文件
- **标签页文件查看** — 聊天页和文件页共用顶部标签栏，可在多个文件和会话之间切换

## 注意事项

- **数据目录** — 用户库位于 `~/.pi-web-auth/auth.db`，工作目录位于 `~/pi-users/`，会话位于 `~/.pi/agent/sessions/`。可通过环境变量 `PI_CODING_AGENT_DIR` 指定 Pi 数据目录。
- **模型配置** — 从智能体数据目录下的 `models.json` 读取可用模型，可在侧边栏的 **Models** 面板中编辑。
- **Skill 路径** — pi 的 skill 默认存放在 `~/.pi/agent/skills/`，项目级 skill 存放在当前工作目录的 `.pi/agent/skills/`。
- **文件访问范围** — 文件浏览和下载只允许访问已知会话工作目录、当前打开的新会话目录以及常见用户目录，避免任意路径读取。
- **上传限制** — 文档上传默认单文件最大 50MB、一次最多 20 个文件，可通过 `PI_WEB_UPLOAD_MAX_MB` 和 `PI_WEB_UPLOAD_MAX_COUNT` 调整。图片走多模态输入通道，不写入 `uploads/`。
- **生产更新** — 二次开发后必须重新执行 `npm run build` 生成 `.next/`，再重启 systemd 服务。
- **开发限制** — 开发时使用 `npm run dev`，不要用 `next build` 替代开发服务器；生产发布前再执行 `npm run build`。

## 项目结构

```
app/
  api/
    sessions/      # 读写会话文件
    agent/         # 发送命令、SSE 事件流
    upload/        # 文档附件上传
    files/         # 文件列表、预览、监听与下载
    auth/          # OAuth 与 API Key 管理
    skills/        # skill 查询、搜索、安装和启停
    models/        # 可用模型列表与默认模型
    models-config/ # 读写 models.json
components/        # UI 组件
hooks/             # 会话、主题、拖拽和声音等前端状态
lib/
  session-reader.ts  # 解析 .jsonl 会话文件
  rpc-manager.ts     # 管理 AgentSession 生命周期
  normalize.ts       # 规范化 toolCall 字段名
  upload.ts          # 上传文件类型和限制配置
  file-paths.ts      # 文件 API 路径编码和下载 URL
  types.ts
```

会话文件存储路径：`~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`

pi 的 skill 存放路径：`~/.pi/agent/skills/`
