# pi-web-auth-public

[English README](./README.md)

Pi coding agent Web UI 的公开多用户 fork。它在 Pi agent runtime 之上增加登录、用户独立工作区、会话浏览、流式聊天、模型切换、文件上传/下载和管理员控制台。

## 上游来源和归属

本项目基于 [`agegr/pi-web`](https://github.com/agegr/pi-web) 开发。上游项目是 Pi coding agent 的本地 Web UI，并采用 MIT License。

本 fork 保留上游 license 和归属说明，并面向私有团队部署增加多用户、认证、权限和生产运维能力。核心方向是用户隔离、角色管理、文档上传/下载和更稳妥的 standalone 生产发布流程。

开发来源：这个公开包来自一个私有 `pi-web` 二次开发线。该开发线从上游 `agegr/pi-web` 的 `main` 分支提交 `722f7096a36dab68e00afdd4aa6f6698066cc364` 分叉，提交信息是 `chore: refresh npm lockfile metadata`，时间是 2026-05-31。该私有线先增加了文档上传/下载、systemd/service 部署说明、本地模型配置说明、HTTPS/service 修复和最近工作区历史，然后继续扩展成当前带认证的 `pi-web-auth-public` fork。

准备这份 README 时，上游 `main` 已经继续向前发展。因此本项目应被视为一个功能 fork，而不是上游最新版本的直接镜像。

如果你需要原始的单用户本地 `pi-web` 体验，请使用 [`agegr/pi-web`](https://github.com/agegr/pi-web)。如果你需要登录、用户工作区隔离、后台管理和生产发布工具，可以使用这个 fork。

## 功能

- 用户登录和注册，支持 `user`、`admin`、`super_admin` 角色。
- 每个用户独立工作区，默认位于 `~/pi-users/<username>`。
- 从 `~/.pi/agent/sessions` 读取并浏览历史会话。
- 支持流式聊天和刷新后的 SSE 重连。
- 支持模型配置和聊天过程中的模型切换。
- 支持工具 preset：`off`、`default`、`full`。
- 支持文件浏览、文件预览、文档上传和生成文件下载。
- 支持管理员控制台，用于用户管理和只读观测。
- 提供可选的 standalone 生产发布脚本。

## 项目截图

### 认证团队入口

![带注册邀请码和密码登录的登录页面](./docs/images/login.png)

登录页是共享部署的主要入口，体现了本 fork 新增的认证层、注册邀请码、角色初始化和私有团队访问模式。

### 模型和工具 preset 配置

![包含 provider 配置和工具 preset 的模型与工具设置页面](./docs/images/models-tools-settings.png)

模型和工具设置页展示了新增的运维配置界面，可用于配置 provider、可用模型、兼容性参数，以及认证用户在聊天中使用的工具 preset。

## 相比 `agegr/pi-web` 的新增内容

本项目从公开的 `agegr/pi-web` Web UI 出发，增加了更适合团队内部部署的产品层：

- **认证和注册**：访问会话、文件、模型和聊天前需要登录；注册可通过 `REGISTER_KEYWORD` 保护。
- **角色权限控制**：`user`、`admin`、`super_admin` 同时在 UI 和 API 层 enforced。
- **用户工作区隔离**：普通用户被限制在自己的 `~/pi-users/<username>` 工作区内。
- **管理员控制台**：`/admin` 支持用户管理、角色调整、禁用/删除、会话可见性、工作区可见性、只读文件浏览和概览页面。
- **会话归属索引**：会话元数据带有归属、归档、收藏、标签、搜索、孤儿会话识别和管理员观测能力。
- **用户模型偏好**：用户可以保存个人默认模型，不需要修改全局模型注册表。
- **聊天输入区增强**：模型选择、thinking level、工具 preset、compact、附件上传和完成音效保留在聊天界面，并由服务端 API 做权限控制。
- **文档上传和下载**：文档和表格可以上传到当前工作区的 `uploads/` 目录，自动加入 prompt 引用，也可以从 Web UI 预览和下载。
- **发布生命周期 API**：提供 drain/resume 和 health endpoint，用于更安全的生产切换。
- **standalone 生产发布工具**：脚本会构建不可变 release、做 staging 验证、切换 `current`/`previous` symlink、记录 release 元数据，并在新版本 readiness 失败时回滚代码。
- **生产备份和恢复工具**：发布流程会做 SQLite-aware 数据备份，保留 backup manifest，支持 dry-run restore，并区分代码回滚和数据恢复。
- **更完整的测试覆盖**：增加 auth、ownership、admin observability、session index、release 和 UI smoke tests。

部分上游 `agegr/pi-web` 功能不是这个 fork 的重点，例如 npm `pi-web` CLI 分发流程、plugin/worktree 专用接口，以及部分 Markdown/file rendering 增强。本 fork 更关注带认证的内部/团队部署、用户隔离和生产运维。

## 环境要求

- Node.js 22 或更新版本
- npm
- git
- 生产 release 脚本需要 rsync、curl 和 systemd
- 可用的 Pi agent runtime：`@earendil-works/pi-coding-agent`

## 部署路径说明

大部分配置路径都和进程的 `HOME` 有关。

| 运行方式 | `HOME` 指向哪里 | `~/.pi/agent/models.json` 的实际示例路径 |
| --- | --- | --- |
| 本地开发 | 当前 shell 用户的 home 目录 | `/home/alice/.pi/agent/models.json` |
| 简单生产命令 | 运行 `npm run start` 的 shell 里的 `HOME` | 取决于服务用户 |
| 示例 systemd unit | `/var/lib/pi-web-auth` | `/var/lib/pi-web-auth/.pi/agent/models.json` |
| 用户级 systemd unit | 当前 Linux 用户的 home 目录 | `/home/piweb/.pi/agent/models.json` |

如果按照本文档的生产示例部署，请把 `/var/lib/pi-web-auth` 视为应用数据 home。也就是说，`~/.pi/agent/models.json` 实际是 `/var/lib/pi-web-auth/.pi/agent/models.json`。

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
npm run dev
```

默认监听 `http://localhost:8000`。如果需要隔离开发环境，可以使用独立 `HOME` 和非生产端口：

```bash
HOME=/tmp/pi-web-auth-dev-home npm run dev -- -p 8144
```

日常开发不要运行 `next build`。只有生产构建时才使用它。

## 验证

```bash
npm run typecheck
npm run lint
npm run verify
```

`npm run verify` 会执行 typecheck、lint、auth tests、release tests 和 UI tests。

## 运行时数据

运行时数据存储在源码仓库之外：

- `~/.pi-web-auth/auth.db`：用户、角色、禁用状态和登录 session。
- `~/pi-users/<username>/`：每个用户的工作区。
- `~/.pi/agent/sessions/`：Pi session `.jsonl` 文件。
- `~/.pi/agent/models.json`：模型/provider 配置。
- `~/.pi/agent/settings.json`：默认模型设置。
- `~/.pi/agent/auth.json`：Pi 管理的 provider auth/API key 存储。

不要把这些文件提交到公开仓库。

## 必配配置文件

共享部署或生产部署前，建议逐项检查这些文件和配置：

| 配置项 | 文件或变量 | 需要配置什么 |
| --- | --- | --- |
| 注册 | `REGISTER_KEYWORD` | 新用户注册邀请码。不配置时注册会 fail closed。 |
| 超级管理员 | `PI_WEB_SUPER_ADMIN_USERNAME` | 始终被视为 `super_admin` 的用户名，默认是 `admin`。 |
| 应用数据 HOME | `HOME` | 决定 `.pi-web-auth/`、`pi-users/`、`.pi/agent/` 存储在哪里。示例 systemd unit 使用 `/var/lib/pi-web-auth`。 |
| 发布环境文件 | `/etc/pi-web-auth/release.env` | systemd 和 release 脚本读取的生产环境文件。建议放 `REGISTER_KEYWORD`、`PI_WEB_RELEASE_TOKEN`、`PI_WEB_SUPER_ADMIN_USERNAME` 和路径覆盖变量，权限设为 `0600`。 |
| systemd unit | `systemd/pi-web-auth.service.example` | 复制到 `/etc/systemd/system/pi-web-auth.service` 后，如果路径不同，需要修改 `WorkingDirectory`、`EnvironmentFile`、`HOME`、`PORT`、`HOSTNAME`、`ExecStart`、`ExecStop`。 |
| 模型注册表 | `~/.pi/agent/models.json` | provider、模型 ID、展示名称、base URL、兼容性参数、上下文窗口和自定义 provider 的 API key。 |
| 默认模型 | `~/.pi/agent/settings.json` | 新聊天使用的 `defaultProvider` 和 `defaultModel`。 |
| Provider 认证 | `~/.pi/agent/auth.json` | Pi provider 登录/认证流程管理的 API key。不要提交或分享。 |
| 上传限制 | `PI_WEB_UPLOAD_MAX_MB`、`PI_WEB_UPLOAD_MAX_COUNT` | 单个文档大小上限和单次上传数量上限。 |
| 发布路径 | `PI_WEB_SOURCE_ROOT`、`PI_WEB_DEPLOY_ROOT`、`PI_WEB_BACKUP_ROOT`、`PI_WEB_PRODUCTION_HOME`、`PI_WEB_RELEASE_ENV` | 如果不使用 `/opt/pi-web-auth`、`/var/lib/pi-web-auth`、`/var/backups/pi-web-auth`，用这些变量覆盖默认路径。 |

OpenAI-compatible 自定义 provider 的 API key 可以放在 `models.json` 的 provider 配置里，字段名是 `apiKey`。通过 Pi 自身登录流程认证的 provider，key 会放在 `auth.json`。这两个文件都属于敏感配置，必须放在 Git 仓库之外。

最小 `/etc/pi-web-auth/release.env` 示例：

```bash
REGISTER_KEYWORD=change-me
PI_WEB_RELEASE_TOKEN=<random-hex-token>
PI_WEB_SUPER_ADMIN_USERNAME=admin
PI_WEB_PRODUCTION_HOME=/var/lib/pi-web-auth
PI_WEB_SOURCE_ROOT=/opt/pi-web-auth/source
PI_WEB_DEPLOY_ROOT=/opt/pi-web-auth
PI_WEB_BACKUP_ROOT=/var/backups/pi-web-auth
```

## 重要环境变量

- `REGISTER_KEYWORD`：注册邀请码。
- `PI_WEB_SUPER_ADMIN_USERNAME`：始终 bootstrapped 为 `super_admin` 的用户名，默认是 `admin`。
- `PI_CODING_AGENT_DIR`：Pi agent 数据目录覆盖路径。
- `PI_WEB_UPLOAD_MAX_MB`：单个上传文档大小上限，默认 `50`。
- `PI_WEB_UPLOAD_MAX_COUNT`：单次上传文档数量上限，默认 `20`。
- `PI_WEB_ALLOWED_DEV_ORIGINS`：Next.js 允许的额外开发来源，例如 `192.168.1.10,devbox.local`。

## 模型配置

管理员可以从 **Models** 面板配置模型。配置存储在 `~/.pi/agent/models.json`。

最小 OpenAI-compatible provider 示例：

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

默认模型设置位于 `~/.pi/agent/settings.json`：

```json
{
  "defaultProvider": "local-openai",
  "defaultModel": "qwen2.5-coder:7b"
}
```

## 生产部署选项

### 推荐部署流程

对外或团队环境建议按这个顺序部署：

1. 准备主机、数据目录和 `/etc/pi-web-auth/release.env`。
2. 在生产数据 home 下配置至少一个模型 provider 和默认模型。
3. 在干净 checkout 中运行 `npm run verify`。
4. 先用简单生产命令启动一次，确认登录和模型配置可用。
5. 安装 systemd service，用于长期运行。
6. 后续升级使用 standalone release scripts。

简单生产命令更适合第一次 smoke test。standalone release 流程更适合长期生产运行，因为它会构建不可变 release、做 staging 验证、保留 `current` 和 `previous`，并在切换版本前备份数据。

### 准备生产主机

先安装 Node.js 22 或更新版本、npm、git、curl、rsync 和 systemd。然后准备源码、数据、备份和 release 配置目录：

```bash
sudo mkdir -p /opt/pi-web-auth/source /opt/pi-web-auth/releases /opt/pi-web-auth/staging /opt/pi-web-auth/logs
sudo mkdir -p /var/lib/pi-web-auth/.pi/agent /var/lib/pi-web-auth/.pi-web-auth /var/lib/pi-web-auth/pi-users
sudo mkdir -p /var/backups/pi-web-auth /etc/pi-web-auth
sudo chown -R "$USER":"$USER" /opt/pi-web-auth /var/lib/pi-web-auth /var/backups/pi-web-auth
sudo install -m 600 /dev/null /etc/pi-web-auth/release.env
sudo chown "$USER":"$USER" /etc/pi-web-auth/release.env
```

克隆项目：

```bash
git clone https://github.com/luciferhs/pi-web.git /opt/pi-web-auth/source
cd /opt/pi-web-auth/source
npm ci
npm run verify
```

写入生产环境文件：

```bash
cat > /etc/pi-web-auth/release.env <<'EOF'
REGISTER_KEYWORD=change-me
PI_WEB_RELEASE_TOKEN=replace-with-a-random-long-token
PI_WEB_SUPER_ADMIN_USERNAME=admin
PI_WEB_PRODUCTION_HOME=/var/lib/pi-web-auth
PI_WEB_SOURCE_ROOT=/opt/pi-web-auth/source
PI_WEB_DEPLOY_ROOT=/opt/pi-web-auth
PI_WEB_BACKUP_ROOT=/var/backups/pi-web-auth
PI_WEB_RELEASE_ENV=/etc/pi-web-auth/release.env
EOF
chmod 600 /etc/pi-web-auth/release.env
```

对外暴露服务前，生成更强的 release token：

```bash
openssl rand -hex 32
```

把 `PI_WEB_RELEASE_TOKEN` 替换成生成的值。邀请用户前，也要修改 `REGISTER_KEYWORD`。

### 首次登录前配置模型

在生产 `HOME` 下创建模型注册表：

```bash
mkdir -p /var/lib/pi-web-auth/.pi/agent
nano /var/lib/pi-web-auth/.pi/agent/models.json
```

OpenAI-compatible 示例：

```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "api": "openai-completions",
      "apiKey": "replace-with-your-api-key",
      "models": [
        {
          "id": "gpt-5",
          "name": "GPT-5"
        }
      ]
    }
  }
}
```

设置默认模型：

```bash
cat > /var/lib/pi-web-auth/.pi/agent/settings.json <<'EOF'
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-5"
}
EOF
```

OpenAI-compatible 自定义 provider 可以把 API key 放在 `models.json` 的 `apiKey` 字段。通过 Pi 自身登录流程认证的 provider，会把凭据存储在 `/var/lib/pi-web-auth/.pi/agent/auth.json`。

`models.json`、`settings.json` 和 `auth.json` 都是运行时配置，不是源码文件，必须放在 Git 仓库之外。

### 不使用 systemd 的首次 smoke test

先从源码目录启动一次应用，确认注册、登录和模型加载正常：

```bash
cd /opt/pi-web-auth/source
set -a
source /etc/pi-web-auth/release.env
set +a
HOME=/var/lib/pi-web-auth npm run build
HOME=/var/lib/pi-web-auth npm run start
```

打开 `http://<server-ip>:8000/login`。

注册第一个超级管理员用户，用户名填写 `admin`，或者填写你在 `PI_WEB_SUPER_ADMIN_USERNAME` 中配置的值。注册时使用 `release.env` 里的 `REGISTER_KEYWORD`。密码在注册表单里设置，系统不会明文保存密码。

登录后打开 Models 面板，确认配置的模型能看到。切换到 systemd 前，先发起一次测试聊天。

### 简单 Next.js 生产模式

适合小型私有部署：

```bash
npm ci
npm run build
REGISTER_KEYWORD=change-me PI_WEB_SUPER_ADMIN_USERNAME=admin npm run start
```

这会启动 `next start -p 8000`。

### Standalone Release Scripts

仓库包含不可变 standalone release 脚本：

- `scripts/build-release.sh`
- `scripts/release-production.sh`
- `scripts/restore-production-backup.sh`
- `systemd/pi-web-auth.service.example`

公开默认路径：

- source：`/opt/pi-web-auth/source`
- deploy root：`/opt/pi-web-auth`
- data home：`/var/lib/pi-web-auth`
- backups：`/var/backups/pi-web-auth`
- release env：`/etc/pi-web-auth/release.env`

可以通过 `PI_WEB_SOURCE_ROOT`、`PI_WEB_DEPLOY_ROOT`、`PI_WEB_BACKUP_ROOT`、`PI_WEB_PRODUCTION_HOME` 和 `PI_WEB_RELEASE_ENV` 覆盖。

`/etc/pi-web-auth/release.env` 应设置为 `0600`，至少包含：

```bash
PI_WEB_RELEASE_TOKEN=<random-hex-token>
REGISTER_KEYWORD=<registration-keyword>
PI_WEB_SUPER_ADMIN_USERNAME=admin
```

### 使用 systemctl 管理服务

示例 unit 适用于 `/opt/pi-web-auth/current` 下的 standalone release，并使用 `HOME=/var/lib/pi-web-auth` 在 `8000` 端口运行应用。

安装系统级 unit：

```bash
sudo cp systemd/pi-web-auth.service.example /etc/systemd/system/pi-web-auth.service
sudo systemctl daemon-reload
sudo systemctl enable pi-web-auth.service
```

启动、重启、停止和查看日志：

```bash
sudo systemctl start pi-web-auth.service
sudo systemctl status pi-web-auth.service --no-pager
sudo journalctl -u pi-web-auth.service -f
sudo systemctl restart pi-web-auth.service
sudo systemctl stop pi-web-auth.service
```

如果使用用户级 service，把 unit 复制到 `~/.config/systemd/user/pi-web-auth.service`，执行 `systemctl --user daemon-reload`，然后使用 `systemctl --user start|status|restart|stop pi-web-auth.service` 管理服务。如果安装路径和公开默认路径不同，需要同步修改 unit 里的 `WorkingDirectory`、`EnvironmentFile`、`HOME` 和 `ExecStart`。

release 脚本默认使用 `systemctl --user`。如果希望不改脚本直接使用 release 流程，建议安装为用户级 service：

```bash
mkdir -p ~/.config/systemd/user
cp systemd/pi-web-auth.service.example ~/.config/systemd/user/pi-web-auth.service
systemctl --user daemon-reload
systemctl --user enable pi-web-auth.service
```

如果希望用户退出登录后服务仍然运行，需要为该 Linux 用户开启 lingering：

```bash
sudo loginctl enable-linger "$USER"
```

### 第一次 standalone release

第一次 standalone release 需要先生成 managed release 目录，并让 `/opt/pi-web-auth/current` 指向它，service 才能从 `/opt/pi-web-auth/current` 启动：

```bash
cd /opt/pi-web-auth/source
set -a
source /etc/pi-web-auth/release.env
set +a
scripts/build-release.sh
```

`scripts/build-release.sh` 输出的最后一行是 release 目录。把 `current` 指向它：

```bash
RELEASE_DIR=/opt/pi-web-auth/releases/<release-id>
ln -sfn "$RELEASE_DIR" /opt/pi-web-auth/current
```

启动服务：

```bash
systemctl --user start pi-web-auth.service
systemctl --user status pi-web-auth.service --no-pager
```

后续从一个健康 standalone release 升级时，执行：

```bash
cd /opt/pi-web-auth/source
git pull --ff-only
scripts/release-production.sh
```

release 脚本会构建新 release、做 staging 验证、备份生产数据、drain 当前工作、切换 `current` symlink、启动新版本、检查 readiness。如果新版本 readiness 失败，会回滚到 `previous`。

### 健康检查

服务启动后检查 HTTP endpoint：

```bash
curl -fsS http://127.0.0.1:8000/api/health/live
curl -fsS http://127.0.0.1:8000/api/health/ready
```

然后用浏览器打开登录页：

```text
http://<server-ip>:8000/login
```

如果浏览器访问不到，检查端口和日志：

```bash
ss -ltnp | grep 8000
systemctl --user status pi-web-auth.service --no-pager
journalctl --user -u pi-web-auth.service -n 200 --no-pager
```

### 常见问题排查

| 现象 | 检查项 |
| --- | --- |
| 注册失败 | 确认 `/etc/pi-web-auth/release.env` 里的 `REGISTER_KEYWORD`，注册页填写同一个值。 |
| 第一个用户不是 super admin | 确认注册用户名和 `PI_WEB_SUPER_ADMIN_USERNAME` 完全一致。 |
| 模型列表为空 | 确认 service 的 `HOME`；使用示例 unit 时，模型文件必须在 `/var/lib/pi-web-auth/.pi/agent/models.json`。 |
| API key 报错 | 检查 `models.json` 里的 `apiKey`、`baseUrl`、`api` 和 provider 兼容性参数。 |
| systemd service 启动失败 | 检查 `WorkingDirectory`、`EnvironmentFile`、`HOME`、`ExecStart`，以及 `/opt/pi-web-auth/current/server.js` 是否存在。 |
| 上传失败 | 检查 `PI_WEB_UPLOAD_MAX_MB`、`PI_WEB_UPLOAD_MAX_COUNT`、工作区写权限和磁盘空间。 |
| release 脚本无法停止/启动服务 | 安装为用户级 service，或按环境设置 `PI_WEB_SYSTEMCTL_BIN` / `PI_WEB_SERVICE_NAME`。 |
| ready check 失败 | 查看 `journalctl --user -u pi-web-auth.service -n 200 --no-pager`，并确认 `/var/lib/pi-web-auth/.pi-web-auth`、`/var/lib/pi-web-auth/pi-users`、`/var/lib/pi-web-auth/.pi/agent` 可写。 |

## 项目结构

```text
app/api/                 Next.js API routes
components/              React UI components
hooks/                   Frontend state hooks
lib/                     Server/client shared logic
scripts/                 Release, backup, and verification scripts
systemd/                 Example service unit
__tests__/               Node and Vitest tests
```

## 公开仓库检查

发布 fork 或复制仓库前，确认仓库不包含：

- `.next/`
- `node_modules/`
- `.env*`
- `*.pem`
- `~/.pi-web-auth/*`
- `~/.pi/agent/auth.json`
- `~/.pi/agent/models.json`
- `~/.pi/agent/sessions/`
- `~/pi-users/`

发布前可以运行本地扫描：

```bash
rg -n -I 'sk-|api[_-]?key|secret|token|password|passwd|BEGIN .*PRIVATE KEY|PRIVATE KEY|Bearer|/home/|10\.|192\.168\.|\.pem|auth\.db|models\.json|auth\.json' .
```

需要人工 review 扫描结果。代码和文档可以合法提到 token/password 这类概念，但不能提交真实值。
