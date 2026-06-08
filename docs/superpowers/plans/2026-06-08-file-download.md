# 文件下载功能 实现计划

> 面向 AI 代理的工作者：按任务逐项实现，每项完成后做本地审查和提交。用户验证 OK 后再合并回 `main`，必须先 `npm run build` 重新生成 `.next/` 生产构建，再通过 `systemctl --user restart pi-web.service` 重启正式服务。

**目标：** 让用户可以从 Web 界面直接下载 agent 生成或修改后的文件，不再需要 agent 启动临时 HTTP 服务。

**规格：** `docs/superpowers/specs/2026-06-08-file-download-design.md`

**分支：** `feat/file-download`

**验证命令：**
- `node_modules/.bin/tsc --noEmit`
- 定向 lint 本次改动文件
- curl API 集成测试
- 用户浏览器验证

## 任务 1：下载 URL 工具

**文件：** `lib/file-paths.ts`

- [ ] 新增 `getFileDownloadUrl(filePath: string): string`
- [ ] 复用 `encodeFilePathForApi`
- [ ] typecheck
- [ ] commit

## 任务 2：API 下载模式

**文件：** `app/api/files/[...path]/route.ts`

- [ ] 新增安全的 `contentDispositionAttachment(name)` helper
- [ ] 新增 `type=download` 分支
- [ ] 复用 allowed roots、文件存在、普通文件校验
- [ ] stream 返回文件，设置 `Content-Disposition: attachment`
- [ ] curl 验证 200/404/403
- [ ] commit

## 任务 3：FileViewer 下载按钮

**文件：** `components/FileViewer.tsx`

- [ ] 顶部工具条新增下载按钮
- [ ] 文本、图片、音频 viewer 共用下载 URL
- [ ] 按钮使用浏览器原生下载行为
- [ ] typecheck + lint
- [ ] commit

## 任务 4：聊天消息路径下载入口

**文件：**
- `components/MessageView.tsx`
- `components/ChatWindow.tsx`

- [ ] 给 `MessageView` 增加 `cwd?: string`
- [ ] `ChatWindow` 传入当前 session/new cwd
- [ ] 在用户/助手文本中识别安全相对文件路径
- [ ] 将路径渲染为下载 chip/link
- [ ] 不识别绝对路径、URL、`..` 路径
- [ ] typecheck + lint
- [ ] commit

## 任务 5：最终验证与用户验收

- [ ] `node_modules/.bin/tsc --noEmit`
- [ ] 定向 lint 本次改动文件
- [ ] 启动 dev 服务
- [ ] 用户验证文件查看器下载按钮
- [ ] 用户验证聊天路径下载入口
- [ ] 用户确认 OK 后合并回 `main`
- [ ] `npm run build`
- [ ] `systemctl --user restart pi-web.service`
