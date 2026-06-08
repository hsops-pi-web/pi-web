# 文档上传功能设计

日期: 2026-06-08
分支: `feat/file-upload`（开发测试通过后合并回 `main`）

## 背景

当前 web 界面只支持图片上传。图片作为视觉块以 base64 内联发送给底层 pi agent。
需要新增对 word / excel / pdf / ppt / text / markdown 文件的单个或多个上传支持。

底层 `@earendil-works/pi-coding-agent` 的 `prompt` 只接受 `images`（视觉通道），
文档不能走视觉通道。但该 agent 是编码 agent，自带文件工具（read / bash）
和转换技能（markitdown / pdf / docx / xlsx / pptx），可按需读取磁盘文件。

## 目标

- web 界面支持选择、拖放单个或多个文档
- 用户体验与现有图片上传/删除完全一致：附件 → chip → 可删 → 直接对话
- agent 能读到上传的文档内容

## 非目标

- 不在服务端做文档转文本（交给 agent 的技能按需处理）
- 不支持文档粘贴（粘贴仍仅图片）
- 不修改图片上传的现有逻辑
- 不自动改 `.gitignore`（如需排除 uploads/ 由用户自行配置）

## 核心决策（已确认）

| 决策点 | 选择 |
|--------|------|
| 投递方式 | 存到 `cwd/uploads/` + 自动把路径附进消息 |
| 传输方式 | 新增 multipart 上传端点（非 base64 内联） |
| 存储位置 | cwd 下可见的 `uploads/` 目录 |
| 大小/数量 | 默认单文件 50MB、单次 20 个，env 可配，与模型上下文解耦 |
| UX 生命周期 | 与图片一致：发送前存浏览器内存，发送时上传，删除=移出列表 |
| 路径注入 | 消息末尾自动附加 `[附件]` 清单 |
| 附件按钮 | 复用现有按钮，`accept` 同时含图片+文档，按 MIME 分流 |
| 拖放 | 支持，与图片拖放一致 |

## 数据流

```
图片(现有): 选中 → base64存内存 → chip → 发送时内联JSON images → agent视觉
文档(新增): 选中 → File存内存  → chip → 发送时multipart上传uploads/ → 路径附进消息 → agent读文件
```

二者可在同一条消息共存：图片走 `images`，文档走路径清单。

## 架构组件

### A. 后端上传端点

`POST /api/upload`（multipart/form-data）

入参:
- `files`: 一个或多个文件
- `cwd`: 目标工作目录。前端在新会话（newSessionCwd）和已有会话（session.cwd）两种情况下都已知 cwd，统一直接传 cwd，端点不依赖 sessionId。

行为:
1. 解析 multipart
2. 服务端校验: 扩展名白名单、单文件 ≤ 上限、数量 ≤ 上限
3. 解析 cwd（支持 `~` 展开），校验存在
4. 确保 `<cwd>/uploads/` 存在（不存在则创建）
5. 对每个文件: basename 清洗防目录穿越；重名则加后缀 `name(1).ext`；写入 `<cwd>/uploads/`
6. 返回相对路径数组，如 `["uploads/a.pdf", "uploads/b.xlsx"]`

返回:
- 成功: `{ success: true, paths: string[] }`
- 失败: `{ error: string }` + 对应 HTTP 状态码（400 校验失败 / 500 写盘失败）

路径安全:
- 只取上传文件名的 basename，剥离任何路径分隔符
- 最终写入路径必须落在 `<cwd>/uploads/` 内，解析后校验前缀

`next.config.ts`: 调高 multipart/请求体大小上限至 ≥ 单文件上限 × 数量上限。

### B. 前端 ChatInput 改动（镜像图片逻辑）

新增类型:
```ts
interface AttachedFile {
  file: File;   // 保留 File 引用，不转 base64（省内存）
  name: string;
  size: number;
}
```

新增状态: `attachedFiles: AttachedFile[]`

新增/扩展函数（与图片同名逻辑对照）:
- `processDocFiles(files)`: 按扩展名白名单过滤；前端预校验大小/数量，超限即提示，不入列
- `removeFile(i)`: 从列表移除（对照 `removeImage`，无服务端调用）
- `clearFiles()`: 清空（对照 `clearImages`，发送后调用）
- `addFiles(files)`: 暴露给拖放的命令式句柄（对照 `addImages`）

chip 渲染:
- 复用 `getFileIcon(name)` 取图标 + 文件名 + 大小 + `×` 删除按钮
- 样式仿现有图片预览 chip（同一预览区，flex wrap）

文件选择框:
- 同一个隐藏 `<input type="file" multiple>`
- `accept` 扩展为图片 + 文档白名单
- onChange 分流: `f.type.startsWith("image/")` → `processImageFiles`，否则 → `processDocFiles`

附件按钮: 保持现有单按钮，触发同一文件框。

### C. 发送流程

`handleSend` 扩展签名携带 files。发送时:
1. 若有 `attachedFiles`: 先 `POST /api/upload`（带 cwd）→ 得到 `uploads/...` 路径数组
2. 在消息文本末尾自动附加:
   ```
   <用户输入>

   [附件]
   - uploads/a.pdf
   - uploads/b.xlsx
   ```
3. 走原 prompt 发送:
   - 新会话: `/api/agent/new`（cwd = newSessionCwd）
   - 已有会话: `sendAgentCommand`
4. 图片仍按原样内联 `images`，与文档清单共存
5. 发送成功后 `clearFiles()` + `clearImages()`

steer / followUp 同样携带文档（与图片对称）。

### D. 拖放扩展

`useDragDrop`: 放行判断从"仅 image/*"扩展为"image/* 或文档白名单"。
`ChatWindow` 的 `onDrop` 已接 `chatInputRef.addImages`，改为根据文件类型分发到
`addImages` / `addFiles`，或统一入口内部分流。

## 接受的文件类型

| 类别 | 扩展名 |
|------|--------|
| word | .doc .docx |
| excel | .xls .xlsx .csv |
| pdf | .pdf |
| ppt | .ppt .pptx |
| text | .txt |
| markdown | .md .markdown |

白名单同时用于前端 `accept`、前端预校验、服务端校验。三处共用一份常量。

## 限制与配置

- 默认单文件 50MB: `PI_WEB_UPLOAD_MAX_MB`（默认 50）
- 默认单次 20 个: `PI_WEB_UPLOAD_MAX_COUNT`（默认 20）
- 与模型上下文窗口解耦：上传只落盘，agent 读取时自行管理上下文

## 错误处理

- 前端预校验失败（类型/大小/数量）: 即时提示，不发请求
- 上传请求失败: 报错（复用现有 `setError` 通道），不发送 prompt，保留 chip 供重试
- 服务端校验失败: 返回明确错误信息（哪个文件、什么原因）
- 显式失败，不静默跳过

## 测试

上传端点:
- 单文件 / 多文件正常落盘
- 超大文件被拒（>上限）
- 超量被拒（>数量上限）
- 非白名单类型被拒
- 目录穿越文件名被清洗
- 重名文件加后缀不覆盖
- cwd 不存在返回 400

前端:
- 附件 → chip 显示（图标/名/大小）
- 删除 chip → 移出列表
- 发送 → 清空
- 图片与文档混合附件

端到端:
- 上传 pdf/xlsx 后，agent 能用技能读到文件内容并回应

## 涉及文件

- 新增: `app/api/upload/route.ts`
- 新增/共享常量: 文件类型白名单与上限（如 `lib/upload-config.ts`）
- 改: `components/ChatInput.tsx`（状态、chip、分流、发送）
- 改: `hooks/useAgentSession.ts`（handleSend/handleSteer/handleFollowUp 携带 files + 调上传 + 拼路径）
- 改: `hooks/useDragDrop.ts`（放行文档）
- 改: `components/ChatWindow.tsx`（onDrop 分发）
- 改: `next.config.ts`（请求体上限）
- 复用: `components/FileIcons.tsx`（getFileIcon）

## 分支与合并

1. 从 `main` 新建 `feat/file-upload`
2. 在该分支开发 + 测试
3. 测试通过后合并回 `main`
