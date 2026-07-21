# pi-web-auth-public

[中文文档](./README-zh.md)

Public multi-user fork of the Pi coding agent web UI. It adds login, per-user workspaces, session browsing, streaming chat, model switching, file upload/download, and an admin console on top of the Pi agent runtime.

## Upstream And Attribution

This project is based on [`agegr/pi-web`](https://github.com/agegr/pi-web), the local web UI for the Pi coding agent. The original project is licensed under the MIT License.

This fork keeps the upstream license and attribution, and adds a multi-user, authenticated, operations-oriented layer for private team deployments. The main product direction of this fork is user isolation, role-based administration, document upload/download workflows, and safer standalone production releases.

Development lineage: this public package comes from a private `pi-web` development line that was forked from upstream `agegr/pi-web` `main` at commit `722f7096a36dab68e00afdd4aa6f6698066cc364` (`chore: refresh npm lockfile metadata`, 2026-05-31). That private line added document upload/download, service deployment notes, local model configuration notes, HTTPS/service fixes, and recent workspace history before it was extended into this authenticated `pi-web-auth-public` fork. At the time this README was prepared, upstream `main` had continued past that baseline, so this fork should be treated as a feature fork rather than a drop-in mirror of the latest upstream release.

If you need the original single-user local `pi-web` experience, use [`agegr/pi-web`](https://github.com/agegr/pi-web). If you need login, per-user workspaces, admin controls, and production release tooling, use this fork.

## Features

- User login and registration with `user`, `admin`, and `super_admin` roles
- Per-user workspace isolation under `~/pi-users/<username>`
- Read-only session browsing from `~/.pi/agent/sessions`
- Streaming chat with reconnect support
- Model configuration and in-chat model switching
- Tool presets: `off`, `default`, and `full`
- File explorer, file preview, uploads, and generated-file downloads
- Admin console for user management and read-only observability
- Optional standalone release scripts for production deployments

## Additions Compared With `agegr/pi-web`

This project started from the public `agegr/pi-web` web UI and adds a multi-user, operations-oriented product layer. The main additions are:

- **Authentication and registration**: users must log in before accessing sessions, files, models, or chat. Registration can be protected with `REGISTER_KEYWORD`.
- **Role-based access control**: `user`, `admin`, and `super_admin` roles are enforced on both the UI and API routes.
- **Per-user workspace isolation**: ordinary users are scoped to `~/pi-users/<username>` and cannot browse arbitrary local projects owned by other users.
- **Admin console**: `/admin` adds user management, role changes, disable/delete flows, session visibility, workspace visibility, file read-only browsing, and audit/overview pages.
- **Session ownership index**: session metadata is indexed with ownership, archive/favorite/tag metadata, search support, orphan detection, and admin-visible observability.
- **User model preferences**: users can save personal default models without changing the global model registry.
- **Chat input hardening for internal multi-user use**: model selection, thinking level, tool preset, compact, attachment upload, and completion sound are kept in the chat surface with server-side authorization checks behind the APIs.
- **Document upload and download**: documents and spreadsheets can be uploaded into the current workspace `uploads/` directory, referenced automatically in the prompt, previewed from the file browser, and downloaded again from the web UI.
- **Release lifecycle APIs**: internal drain/resume and health endpoints support safer production transitions.
- **Standalone production release tooling**: scripts build immutable releases, stage-verify them, switch `current`/`previous` symlinks, keep release metadata, and roll back code on failed readiness.
- **Production backup and restore tooling**: release scripts take SQLite-aware data backups, keep verified backup manifests, support dry-run restore, and keep code rollback separate from data restore.
- **Expanded automated coverage**: auth, ownership, admin observability, session index, release, and UI smoke tests were added around the multi-user and production workflows.

Some upstream `agegr/pi-web` features are intentionally not the focus of this fork, including the npm `pi-web` CLI distribution flow, plugin/worktree-specific endpoints, and some Markdown/file-rendering enhancements. This fork prioritizes authenticated internal/team deployment, user isolation, and production operations.

## Requirements

- Node.js 22 or newer
- npm
- A working Pi agent runtime from `@earendil-works/pi-coding-agent`

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The app listens on `http://localhost:8000` by default. For isolated development, use a dedicated `HOME` and a non-production port:

```bash
HOME=/tmp/pi-web-auth-dev-home npm run dev -- -p 8144
```

Do not run `next build` during routine development. Use it only for production builds.

## Verification

```bash
npm run typecheck
npm run lint
npm run verify
```

`npm run verify` runs typecheck, lint, auth tests, release tests, and UI tests.

## Runtime Data

Runtime data is stored outside the source repository:

- `~/.pi-web-auth/auth.db`: users, roles, disabled state, and login sessions
- `~/pi-users/<username>/`: per-user workspaces
- `~/.pi/agent/sessions/`: Pi session `.jsonl` files
- `~/.pi/agent/models.json`: model/provider configuration
- `~/.pi/agent/settings.json`: default model settings
- `~/.pi/agent/auth.json`: provider auth/API key storage managed by Pi

Do not commit these files to a public repository.

## Important Environment Variables

- `REGISTER_KEYWORD`: invitation keyword required for registration
- `PI_WEB_SUPER_ADMIN_USERNAME`: username that should always be bootstrapped as `super_admin`; defaults to `admin`
- `PI_CODING_AGENT_DIR`: optional override for the Pi agent data directory
- `PI_WEB_UPLOAD_MAX_MB`: max uploaded document size, defaults to `50`
- `PI_WEB_UPLOAD_MAX_COUNT`: max documents per upload, defaults to `20`
- `PI_WEB_ALLOWED_DEV_ORIGINS`: comma-separated extra dev origins for Next.js, for example `192.168.1.10,devbox.local`

## Model Configuration

Admins can configure models from the **Models** panel. Configuration is stored in `~/.pi/agent/models.json`.

Minimal OpenAI-compatible provider example:

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

If your OpenAI-compatible server does not support developer messages or reasoning options, add compatibility settings:

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

Default model settings live in `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "local-openai",
  "defaultModel": "qwen2.5-coder:7b"
}
```

## Production Options

### Simple Next.js Production Mode

For a small private deployment:

```bash
npm ci
npm run build
REGISTER_KEYWORD=change-me PI_WEB_SUPER_ADMIN_USERNAME=admin npm run start
```

This starts `next start -p 8000`.

### Standalone Release Scripts

The repository also includes scripts for immutable standalone releases:

- `scripts/build-release.sh`
- `scripts/release-production.sh`
- `scripts/restore-production-backup.sh`
- `systemd/pi-web-auth.service.example`

The public defaults use generic paths:

- source: `/opt/pi-web-auth/source`
- deploy root: `/opt/pi-web-auth`
- data home: `/var/lib/pi-web-auth`
- backups: `/var/backups/pi-web-auth`
- release env: `/etc/pi-web-auth/release.env`

Override them with environment variables such as `PI_WEB_SOURCE_ROOT`, `PI_WEB_DEPLOY_ROOT`, `PI_WEB_BACKUP_ROOT`, `PI_WEB_PRODUCTION_HOME`, and `PI_WEB_RELEASE_ENV`.

`/etc/pi-web-auth/release.env` should be mode `0600` and contain at least:

```bash
PI_WEB_RELEASE_TOKEN=<random-hex-token>
REGISTER_KEYWORD=<registration-keyword>
PI_WEB_SUPER_ADMIN_USERNAME=admin
```

## Project Structure

```text
app/api/                 Next.js API routes
components/              React UI components
hooks/                   Frontend state hooks
lib/                     Server/client shared logic
scripts/                 Release, backup, and verification scripts
systemd/                 Example service unit
__tests__/               Node and Vitest tests
```

## Public Repository Hygiene

Before publishing a fork or copy, confirm the repository does not include:

- `.next/`
- `node_modules/`
- `.env*`
- `*.pem`
- `~/.pi-web-auth/*`
- `~/.pi/agent/auth.json`
- `~/.pi/agent/models.json`
- `~/.pi/agent/sessions/`
- `~/pi-users/`

Run a local scan before publishing:

```bash
rg -n -I 'sk-|api[_-]?key|secret|token|password|passwd|BEGIN .*PRIVATE KEY|PRIVATE KEY|Bearer|/home/|10\.|192\.168\.|\.pem|auth\.db|models\.json|auth\.json' .
```

Review matches manually. Code and documentation may legitimately mention tokens or passwords as concepts, but real values must not be committed.
