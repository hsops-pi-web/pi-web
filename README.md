# pi-web

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的网页界面。在浏览器中浏览会话、与智能体对话、分叉对话、切换消息分支。

## 快速开始

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://localhost:8000](http://localhost:8000)。

**可选参数：**

```bash
pi-web --port 8080               # 自定义端口
pi-web --hostname 127.0.0.1      # 仅本机访问
pi-web -p 8080 -H 127.0.0.1     # 组合使用

PORT=8080 pi-web                 # 也支持环境变量
```

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

如果希望新会话默认使用本地模型，可编辑 `~/.pi/agent/settings.json`：

```json
{
  "defaultProvider": "local-openai",
  "defaultModel": "qwen2.5-coder:7b"
}
```

通过 Models 面板保存后通常不需要重启服务；刷新页面或重新打开模型下拉即可看到新模型。已有会话需要在输入栏模型下拉中切换，新会话才会使用新的默认模型。

## 使用 systemctl 管理服务

推荐使用用户级 systemd 服务运行 `pi-web`，这样服务会以当前用户身份读取 `~/.pi/agent` 下的会话和模型配置。

先全局安装并确认 `pi-web` 的绝对路径：

```bash
npm install -g @agegr/pi-web
command -v pi-web
command -v node
```

创建用户级服务文件：

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/pi-web.service
```

写入以下内容，并把 `ExecStart` 改成 `command -v pi-web` 输出的绝对路径：

```ini
[Unit]
Description=Pi Agent Web
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/pi-web --hostname 0.0.0.0 --port 8000
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

启用并启动服务：

```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-web
```

常用管理命令：

```bash
systemctl --user status pi-web
systemctl --user restart pi-web
systemctl --user stop pi-web
journalctl --user -u pi-web -f
```

如果需要开机后即使未登录也自动启动用户服务：

```bash
sudo loginctl enable-linger "$USER"
```

更新服务版本：

```bash
npm install -g @agegr/pi-web@latest
systemctl --user restart pi-web
```

本仓库本地开发合并到 `main` 后发布到 systemd 服务时，需要先重新生成生产构建产物，再重启服务：

```bash
git checkout main
npm run build
systemctl --user restart pi-web
```

`pi-web.service` 使用 `next start` 读取 `.next/` 下的生产构建。仅合并代码并重启服务不会重新编译页面和 API，仍可能继续运行旧构建。

## 功能介绍

- **会话浏览器** — 按工作目录分组展示所有 pi 会话
- **实时对话** — 通过 SSE 流式输出与智能体实时交互
- **会话分叉** — 从任意用户消息创建独立的新会话分支
- **会话内分支** — 回退到任意节点继续对话，在同一文件内创建分支
- **分支导航器** — 可视化切换同一会话内的各个分支
- **模型切换** — 对话中途随时切换模型
- **工具面板** — 控制智能体可使用的工具
- **压缩会话** — 对长会话进行摘要，节省上下文窗口
- **引导 / 追加** — 打断正在运行的智能体，或在其完成后追加消息

## 注意事项

- **数据目录** — 默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他目录。
- **模型配置** — 从智能体数据目录下的 `models.json` 读取可用模型，可在侧边栏的「Models」面板中编辑。
- **文件浏览** — 侧边栏内置文件浏览器，可在标签页中查看当前工作目录下的文件。

## 开发

```bash
npm install
npm run dev   # 端口 8000
```

## 项目结构

```
app/
  api/
    sessions/      # 读写会话文件
    agent/         # 发送命令、SSE 事件流
    files/         # 文件内容读取
    models/        # 可用模型列表与默认模型
    models-config/ # 读写 models.json
components/        # UI 组件
lib/
  session-reader.ts  # 解析 .jsonl 会话文件
  rpc-manager.ts     # 管理 AgentSession 生命周期
  normalize.ts       # 规范化 toolCall 字段名
  types.ts
```

会话文件存储路径：`~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`
pi的skill存放路径: `~/.pi/agent/skills/`
