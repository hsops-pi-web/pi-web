# 文档上传功能 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 web 界面支持上传单个或多个 word/excel/pdf/ppt/text/markdown 文件，体验与现有图片上传/删除完全一致。

**架构：** 新增 `POST /api/upload` multipart 端点，把文件落盘到 `<cwd>/uploads/` 并返回相对路径；前端 ChatInput 镜像图片逻辑维护 `attachedFiles`（存 File 引用，不转 base64），发送时先上传、再把 `[附件]` 路径清单附加到消息文本，交给底层 agent 用自带工具/技能按需读取。图片仍走原 `images` 视觉通道，二者可共存。

**技术栈：** Next.js 16（App Router，Route Handler）、React 19、TypeScript。无单元测试框架（项目约定）；验证用 `tsc --noEmit` + `npm run lint` + curl 集成测试 + 浏览器 QA。

**分支：** `feat/file-upload`（当前分支），测试通过后合并回 `main`。

**规格：** `docs/superpowers/specs/2026-06-08-file-upload-design.md`

**项目约定（来自 AGENTS.md）：**
- Typecheck：`node_modules/.bin/tsc --noEmit`
- Lint：`npm run lint`
- Dev：`npm run dev`（端口 8000）
- **dev 期间禁止运行 `next build`**，会污染 `.next/`

---

## 文件结构

**新建：**
- `lib/upload.ts` — 共享常量与纯函数：接受类型白名单、默认上限、`AttachedFile` 类型、`extOf`/`isAcceptedDoc`/`formatBytes`/`ACCEPT_ATTR`。被前端和服务端 route 共用。无 fs / fetch 依赖，保持同构纯净。
- `app/api/upload/route.ts` — multipart 上传端点，Node fs 落盘。

**修改：**
- `lib/agent-client.ts` — 新增客户端 `uploadFiles(cwd, files)`，POST multipart 到 `/api/upload`。
- `components/ChatInput.tsx` — `attachedFiles` 状态、`processDocFiles`/`removeFile`/`clearFiles`、文件 chip、input `accept` 与 onChange 分流、`addFiles` 句柄、`canSend` 派生、发送时携带 files、本地错误行。
- `hooks/useAgentSession.ts` — `handleSend`/`handleSteer`/`handleFollowUp` 接收 files，先上传再把路径附加到消息。
- `hooks/useDragDrop.ts` — 拖放放行任意文件（不再仅 image）。
- `components/ChatWindow.tsx` — `onDrop` 改调 `addFiles`。

---

## 任务 1：共享上传模块 lib/upload.ts

**文件：**
- 创建：`lib/upload.ts`

- [ ] **步骤 1：创建 lib/upload.ts**

```ts
// 文档上传共享常量与纯函数。前端与服务端 route 共用。
// 不引入 fs / fetch，保持同构纯净。

export const DEFAULT_MAX_FILE_MB = 50;
export const DEFAULT_MAX_COUNT = 20;

// 接受的文档扩展名（小写，不含点）。图片走原有逻辑，不在此列。
export const ACCEPTED_DOC_EXTENSIONS = [
  "doc", "docx",
  "xls", "xlsx", "csv",
  "pdf",
  "ppt", "pptx",
  "txt",
  "md", "markdown",
] as const;

// input 元素的 accept 属性：图片 + 文档白名单。
export const ACCEPT_ATTR =
  "image/*," + ACCEPTED_DOC_EXTENSIONS.map((e) => `.${e}`).join(",");

// 前端待发送的文档附件：保留 File 引用，不转 base64（省内存）。
export interface AttachedFile {
  file: File;
  name: string;
  size: number;
}

export function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot + 1);
}

export function isAcceptedDoc(name: string): boolean {
  return (ACCEPTED_DOC_EXTENSIONS as readonly string[]).includes(extOf(name));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **步骤 2：typecheck**

运行：`node_modules/.bin/tsc --noEmit`
预期：PASS，无新增错误。

- [ ] **步骤 3：Commit**

```bash
git add lib/upload.ts
git commit -m "feat: add shared upload constants and helpers"
```

---

## 任务 2：上传 API 端点 app/api/upload/route.ts

**文件：**
- 创建：`app/api/upload/route.ts`
- 参考：`app/api/agent/new/route.ts`（cwd 校验与 `~` 展开模式）

- [ ] **步骤 1：创建 app/api/upload/route.ts**

```ts
import { NextResponse } from "next/server";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { DEFAULT_MAX_FILE_MB, DEFAULT_MAX_COUNT, isAcceptedDoc } from "@/lib/upload";

function expandHomePath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return `${homedir()}${p.slice(1)}`;
  return p;
}

function maxFileBytes(): number {
  const mb = Number(process.env.PI_WEB_UPLOAD_MAX_MB) || DEFAULT_MAX_FILE_MB;
  return mb * 1024 * 1024;
}

function maxCount(): number {
  return Number(process.env.PI_WEB_UPLOAD_MAX_COUNT) || DEFAULT_MAX_COUNT;
}

// 重名则在扩展名前加 (n)：report.pdf -> report(1).pdf
function uniquePath(dir: string, name: string): string {
  const base = path.basename(name);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = path.join(dir, base);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${stem}(${i})${ext}`);
    i += 1;
  }
  return candidate;
}

// POST /api/upload  multipart/form-data
// fields: cwd (string), files (one or more File)
// returns: { success: true, paths: string[] }  相对 cwd 的 uploads/ 路径
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const rawCwd = form.get("cwd");
    if (typeof rawCwd !== "string" || !rawCwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const cwd = expandHomePath(rawCwd);
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${rawCwd}` }, { status: 400 });
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (files.length > maxCount()) {
      return NextResponse.json({ error: `Too many files (max ${maxCount()})` }, { status: 400 });
    }

    const limit = maxFileBytes();
    for (const file of files) {
      if (!isAcceptedDoc(file.name)) {
        return NextResponse.json({ error: `Unsupported file type: ${file.name}` }, { status: 400 });
      }
      if (file.size > limit) {
        return NextResponse.json(
          { error: `File too large: ${file.name} (max ${maxFileBytes() / (1024 * 1024)} MB)` },
          { status: 400 },
        );
      }
    }

    const uploadsDir = path.join(cwd, "uploads");
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
    const uploadsResolved = path.resolve(uploadsDir);

    const paths: string[] = [];
    for (const file of files) {
      const dest = uniquePath(uploadsDir, file.name);
      // 目录穿越防护：写入路径必须落在 uploads/ 内
      if (!path.resolve(dest).startsWith(uploadsResolved + path.sep)) {
        return NextResponse.json({ error: `Invalid file name: ${file.name}` }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(dest, buf);
      paths.push(`uploads/${path.basename(dest)}`);
    }

    return NextResponse.json({ success: true, paths });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

- [ ] **步骤 2：typecheck**

运行：`node_modules/.bin/tsc --noEmit`
预期：PASS。

- [ ] **步骤 3：启动 dev 服务（后台）做集成测试**

运行：`npm run dev`（后台运行；端口 8000）
等待输出 `Ready` / 监听 8000。

- [ ] **步骤 4：curl 集成测试 — 正常上传**

```bash
# 准备临时 cwd 和测试文件
TMP=$(mktemp -d)
echo "hello pi" > /tmp/note.md
curl -sS -X POST http://localhost:8000/api/upload \
  -F "cwd=$TMP" \
  -F "files=@/tmp/note.md" | tee /tmp/up1.json
# 断言：返回 {"success":true,"paths":["uploads/note.md"]}
test -f "$TMP/uploads/note.md" && echo "OK: file landed" || echo "FAIL: not written"
grep -q '"uploads/note.md"' /tmp/up1.json && echo "OK: path returned" || echo "FAIL: bad path"
```
预期：`OK: file landed`、`OK: path returned`。

- [ ] **步骤 5：curl 集成测试 — 重名不覆盖**

```bash
curl -sS -X POST http://localhost:8000/api/upload \
  -F "cwd=$TMP" -F "files=@/tmp/note.md" | tee /tmp/up2.json
grep -q '"uploads/note(1).md"' /tmp/up2.json && echo "OK: renamed" || echo "FAIL: collision"
```
预期：`OK: renamed`，且 `$TMP/uploads/note(1).md` 存在。

- [ ] **步骤 6：curl 集成测试 — 拒绝非法类型**

```bash
echo "x" > /tmp/evil.sh
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/api/upload \
  -F "cwd=$TMP" -F "files=@/tmp/evil.sh"
```
预期：`400`。

- [ ] **步骤 7：curl 集成测试 — cwd 不存在**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8000/api/upload \
  -F "cwd=/no/such/dir" -F "files=@/tmp/note.md"
```
预期：`400`。

- [ ] **步骤 8：curl 集成测试 — 大文件路径打通（约 30MB，验证无需 next.config）**

此步是规格中"请求体上限"一节的对应验证：确认 App Router Route Handler 流式接收 multipart、不受 Pages 路由 4MB bodyParser 限制，因此无需改 `next.config.ts`。用 30MB（远超旧 4MB 限制）实测。

```bash
head -c 31457280 /dev/urandom > /tmp/big.pdf   # 30 MB
curl -sS -X POST http://localhost:8000/api/upload \
  -F "cwd=$TMP" -F "files=@/tmp/big.pdf" | tee /tmp/up3.json
grep -q '"success":true' /tmp/up3.json && echo "OK: large upload" || echo "FAIL: large upload"
test -f "$TMP/uploads/big.pdf" && echo "OK: 30MB landed" || echo "FAIL: not written"
```
预期：`OK: large upload`、`OK: 30MB landed`。
若此处返回 413/体积错误（实测被限），则规格允许的兜底是针对性加配置——记录现象并上报控制者，不要静默忽略。

- [ ] **步骤 9：停止 dev 服务，清理临时文件**

```bash
rm -rf "$TMP" /tmp/note.md /tmp/evil.sh /tmp/big.pdf /tmp/up1.json /tmp/up2.json /tmp/up3.json
# 停止后台 dev 进程
```

- [ ] **步骤 10：Commit**

```bash
git add app/api/upload/route.ts
git commit -m "feat: add multipart file upload endpoint"
```

---

## 任务 3：客户端上传函数 lib/agent-client.ts

**文件：**
- 修改：`lib/agent-client.ts`（在文件末尾追加导出函数）

- [ ] **步骤 1：在 lib/agent-client.ts 末尾追加 uploadFiles**

```ts
// 上传文档到 <cwd>/uploads/，返回相对路径数组（如 ["uploads/a.pdf"]）。
// 与图片不同：图片走 base64 内联，文档走 multipart 落盘。
export async function uploadFiles(cwd: string, files: File[]): Promise<string[]> {
  const form = new FormData();
  form.append("cwd", cwd);
  for (const file of files) form.append("files", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    paths?: string[];
    error?: string;
  };
  if (!res.ok || body.error || !body.paths) {
    throw new Error(body.error ?? `Upload failed: HTTP ${res.status}`);
  }
  return body.paths;
}
```

- [ ] **步骤 2：typecheck**

运行：`node_modules/.bin/tsc --noEmit`
预期：PASS。

- [ ] **步骤 3：Commit**

```bash
git add lib/agent-client.ts
git commit -m "feat: add client uploadFiles helper"
```

---

## 任务 4：ChatInput 文档附件 UI 与发送携带

**文件：**
- 修改：`components/ChatInput.tsx`

镜像现有图片逻辑：`attachedImages`→`attachedFiles`，`processImageFiles`→`processDocFiles`，`removeImage`→`removeFile`，`clearImages`→`clearFiles`，`addImages`→新增 `addFiles`。

- [ ] **步骤 1：导入共享模块并扩展 Props/Handle**

在文件顶部 import 区（第 3 行 React import 之后）新增：

```ts
import { getFileIcon } from "@/components/FileIcons";
import { AttachedFile, ACCEPT_ATTR, isAcceptedDoc, formatBytes, DEFAULT_MAX_FILE_MB, DEFAULT_MAX_COUNT } from "@/lib/upload";
```

把 Props 中三个回调签名加上可选 `files`（第 18、20、21 行）：

```ts
  onSend: (message: string, images?: AttachedImage[], files?: File[]) => void;
  onSteer?: (message: string, images?: AttachedImage[], files?: File[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[], files?: File[]) => void;
```

把 `ChatInputHandle`（第 42-46 行）加上 `addFiles`：

```ts
export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
  addFiles: (files: File[]) => void;
}
```

- [ ] **步骤 2：新增状态与派生（在第 74 行 attachedImages 状态之后）**

```ts
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
```

在状态声明区之后（textareaRef 等 ref 之前或之后均可，建议第 81 行 fileInputRef 之后）新增派生：

```ts
  const canSend = value.trim().length > 0 || attachedImages.length > 0 || attachedFiles.length > 0;
```

- [ ] **步骤 3：实现 processDocFiles / removeFile / clearFiles（紧接 clearImages 之后，第 159 行后）**

```ts
  const processDocFiles = useCallback((files: File[]) => {
    const docFiles = files.filter((f) => !f.type.startsWith("image/") && isAcceptedDoc(f.name));
    const rejected = files.filter((f) => !f.type.startsWith("image/") && !isAcceptedDoc(f.name));
    if (rejected.length) {
      setFileError(`不支持的文件类型：${rejected.map((f) => f.name).join("、")}`);
    }
    if (!docFiles.length) return;
    const maxBytes = DEFAULT_MAX_FILE_MB * 1024 * 1024;
    const tooBig = docFiles.filter((f) => f.size > maxBytes);
    if (tooBig.length) {
      setFileError(`文件超过 ${DEFAULT_MAX_FILE_MB}MB：${tooBig.map((f) => f.name).join("、")}`);
    }
    const accepted = docFiles.filter((f) => f.size <= maxBytes);
    setAttachedFiles((prev) => {
      const room = DEFAULT_MAX_COUNT - prev.length;
      if (accepted.length > room) {
        setFileError(`最多 ${DEFAULT_MAX_COUNT} 个文件`);
      }
      const next = accepted.slice(0, Math.max(0, room)).map((file) => ({ file, name: file.name, size: file.size }));
      return [...prev, ...next];
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clearFiles = useCallback(() => {
    setAttachedFiles([]);
    setFileError(null);
  }, []);
```

- [ ] **步骤 4：扩展 addImages 句柄为同时暴露 addFiles（第 118-120 行）**

把 useImperativeHandle 中的 `addImages` 块替换为：

```ts
    addImages(files: File[]) {
      processImageFiles(files);
    },
    addFiles(files: File[]) {
      const images = files.filter((f) => f.type.startsWith("image/"));
      const docs = files.filter((f) => !f.type.startsWith("image/"));
      if (images.length) processImageFiles(images);
      if (docs.length) processDocFiles(docs);
    },
```

- [ ] **步骤 5：发送时携带 files 并清空（第 161-184 行 handleSend / sendQueued）**

`handleSend` 改为：

```ts
  const handleSend = useCallback(() => {
    const msg = value.trim();
    if (!canSend) return;
    if (isStreaming) return;
    onSend(msg, attachedImages.length ? attachedImages : undefined, attachedFiles.length ? attachedFiles.map((a) => a.file) : undefined);
    setValue("");
    clearImages();
    clearFiles();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, canSend, attachedImages, attachedFiles, isStreaming, onSend, clearImages, clearFiles]);
```

`sendQueued` 改为：

```ts
  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    if (!canSend) return;
    const files = attachedFiles.length ? attachedFiles.map((a) => a.file) : undefined;
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined, files);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined, files);
    }
    setValue("");
    clearImages();
    clearFiles();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value, canSend, attachedImages, attachedFiles, onSteer, onFollowUp, clearImages, clearFiles]);
```

- [ ] **步骤 6：扩展 paste 不变；扩展文件选择框 accept 与 onChange 分流（第 275-286 行）**

把隐藏 input 替换为：

```tsx
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          const images = files.filter((f) => f.type.startsWith("image/"));
          const docs = files.filter((f) => !f.type.startsWith("image/"));
          if (images.length) processImageFiles(images);
          if (docs.length) processDocFiles(docs);
          e.target.value = "";
        }}
      />
```

- [ ] **步骤 7：新增文件 chip 区与错误行（紧接 image previews 块之后，第 331 行 `)}` 之后）**

```tsx
        {/* File attachments */}
        {attachedFiles.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedFiles.map((f, i) => (
              <div
                key={i}
                style={{
                  position: "relative", flexShrink: 0,
                  display: "flex", alignItems: "center", gap: 6,
                  maxWidth: 220, padding: "6px 10px",
                  background: "var(--bg-panel)", border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                {getFileIcon(f.name, 14)}
                <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{formatBytes(f.size)}</span>
                <button
                  onClick={() => removeFile(i)}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {fileError && (
          <div style={{ marginBottom: 6, fontSize: 12, color: "rgba(220,38,38,0.9)" }}>
            {fileError}
          </div>
        )}
```

- [ ] **步骤 8：把发送/Steer/Follow-up 按钮启用条件改用 canSend**

在 `components/ChatInput.tsx` 内做两组全量替换：

1. 三处 `disabled={!value.trim() && !attachedImages.length}` → `disabled={!canSend}`
2. 全部 `(value.trim() || attachedImages.length)` → `canSend`

并把附件按钮高亮（第 473、481、485 行）`attachedImages.length` → `(attachedImages.length || attachedFiles.length)`，按钮 title（第 467 行）`"Attach image"` → `"添加附件（图片或文档）"`。

- [ ] **步骤 9：typecheck + lint**

运行：`node_modules/.bin/tsc --noEmit && npm run lint`
预期：PASS（无新增类型/lint 错误）。

- [ ] **步骤 10：Commit**

```bash
git add components/ChatInput.tsx
git commit -m "feat: add document attachments to chat input"
```

---

## 任务 5：useAgentSession 上传并把路径附加到消息

**文件：**
- 修改：`hooks/useAgentSession.ts`

- [ ] **步骤 1：导入 uploadFiles**

在 `hooks/useAgentSession.ts` 顶部 import 区，把现有 `sendAgentCommand` 的 import 改为同时引入 `uploadFiles`：

```ts
import { sendAgentCommand, uploadFiles } from "@/lib/agent-client";
```
（若原文件用的是命名导入 `import { sendAgentCommand } from "@/lib/agent-client";`，直接加上 `, uploadFiles`。）

- [ ] **步骤 2：新增本地工具函数（在 handleSend 定义之前，第 341 行上方）**

```ts
  // 上传文档并把路径以 [附件] 清单附加到消息文本
  const buildMessageWithFiles = useCallback(async (message: string, cwd: string | undefined, files?: File[]): Promise<string> => {
    if (!files?.length) return message;
    if (!cwd) throw new Error("缺少工作目录，无法上传文件");
    const paths = await uploadFiles(cwd, files);
    const note = `[附件]\n${paths.map((p) => `- ${p}`).join("\n")}`;
    return message.trim() ? `${message}\n\n${note}` : note;
  }, []);
```

- [ ] **步骤 3：handleSend 接收 files 并先上传（替换第 341-410 行 handleSend）**

关键改动：签名加 `files?`；在加入 user 消息前先上传得到 `finalMessage`；上传失败则 setError 并 return（不进入 running 状态）；其余流程把 `message` 改为 `finalMessage`。

```ts
  const handleSend = useCallback(async (message: string, images?: AttachedImage[], files?: File[]) => {
    if (!message.trim() && !images?.length && !files?.length) return;
    if (agentRunning) return;

    const cwd = isNew ? newSessionCwd : session?.cwd;
    let finalMessage: string;
    try {
      finalMessage = await buildMessageWithFiles(message, cwd ?? undefined, files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(finalMessage.trim() ? [{ type: "text" as const, text: finalMessage }] : []), ...imageBlocks]
        : finalMessage,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setAgentRunning(true);
    setAgentPhase({ kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import("@/components/ToolPanel");
        const toolNames = toolPreset === "none" ? PRESET_NONE : toolPreset === "default" ? PRESET_DEFAULT : PRESET_FULL;
        const res = await fetch("/api/agent/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            type: "prompt",
            message: finalMessage,
            toolNames,
            ...(piImages?.length ? { images: piImages } : {}),
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
            ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
          }),
        });
        if (!res.ok) throw new Error(await readApiError(res));
        const result = await res.json() as { sessionId: string };
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        connectEvents(realId);
        onSessionCreated?.({
          id: realId,
          path: "",
          cwd: newSessionCwd,
          name: undefined,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          messageCount: 1,
          firstMessage: finalMessage,
        });
      } else if (session) {
        connectEvents(session.id);
        await sendAgentCommand(session.id, {
          type: "prompt",
          message: finalMessage,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      setError(e instanceof Error ? e.message : String(e));
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, toolPreset, thinkingLevel, session, agentRunning, connectEvents, onSessionCreated, buildMessageWithFiles]);
```

- [ ] **步骤 4：handleSteer 接收 files（替换第 490-504 行）**

```ts
  const handleSteer = useCallback(async (message: string, images?: AttachedImage[], files?: File[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    let finalMessage: string;
    try {
      finalMessage = await buildMessageWithFiles(message, session?.cwd, files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setMessages((prev) => [...prev, { role: "user", content: `[steer] ${finalMessage}`, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message: finalMessage,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, [session, buildMessageWithFiles]);
```

- [ ] **步骤 5：handleFollowUp 接收 files（替换第 506-520 行）**

```ts
  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[], files?: File[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    let finalMessage: string;
    try {
      finalMessage = await buildMessageWithFiles(message, session?.cwd, files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setMessages((prev) => [...prev, { role: "user", content: finalMessage, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message: finalMessage,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, [session, buildMessageWithFiles]);
```

注意：`useCallback` 依赖里 `setError`、`setMessages`、`sendAgentCommand` 为稳定引用，无需列入；`session` 与 `buildMessageWithFiles` 需列入（如上）。

- [ ] **步骤 6：typecheck**

运行：`node_modules/.bin/tsc --noEmit`
预期：PASS。

- [ ] **步骤 7：Commit**

```bash
git add hooks/useAgentSession.ts
git commit -m "feat: upload attached files and append paths to prompt"
```

---

## 任务 6：拖放放行文档

**文件：**
- 修改：`hooks/useDragDrop.ts`
- 修改：`components/ChatWindow.tsx`

- [ ] **步骤 1：useDragDrop 放行任意文件（替换 hooks/useDragDrop.ts 中 dragEnter/dragOver 的 image 判断）**

把 `handleDragEnter` 与 `handleDragOver` 里的：

```ts
    const hasImages = Array.from(e.dataTransfer.items).some((item) => item.type.startsWith("image/"));
    if (!hasImages) return;
```

两处都替换为（拖拽阶段只能拿到 MIME，文件名不可见，故按"是否为文件"判断，落地后再按类型分流）：

```ts
    const hasFiles = Array.from(e.dataTransfer.items).some((item) => item.kind === "file");
    if (!hasFiles) return;
```

- [ ] **步骤 2：ChatWindow onDrop 改调 addFiles（components/ChatWindow.tsx 第 151-153 行）**

```ts
  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addFiles(files);
  }, [chatInputRef]);
```

- [ ] **步骤 3：typecheck + lint**

运行：`node_modules/.bin/tsc --noEmit && npm run lint`
预期：PASS。

- [ ] **步骤 4：Commit**

```bash
git add hooks/useDragDrop.ts components/ChatWindow.tsx
git commit -m "feat: allow dragging documents into chat"
```

---

## 任务 7：浏览器端到端 QA（证据）

无单元测试框架，UI 用浏览器手动验证并截图留证。

**文件：** 无（仅验证）

- [ ] **步骤 1：启动 dev**

运行：`npm run dev`（端口 8000）。浏览器打开 `http://localhost:8000`。

- [ ] **步骤 2：附件 → chip 验证**

点附件按钮，选 1 个 pdf + 1 个 xlsx + 1 张图片。
预期：图片显示缩略图预览，pdf/xlsx 显示带类型图标 + 文件名 + 大小的 chip。
截图留证。

- [ ] **步骤 3：删除验证**

点某个文件 chip 的 ×。
预期：该 chip 移除，其余保留；不发任何网络请求（DevTools Network 确认）。

- [ ] **步骤 4：拖放验证**

把一个 .docx 拖入聊天区。
预期：出现拖放高亮遮罩；松手后变为 chip。

- [ ] **步骤 5：发送 + 落盘 + 路径验证**

输入"读取这些文件并总结"，附 1 个 md 文件，发送。
预期：
- Network 出现 `POST /api/upload` 返回 `{success:true, paths:[...]}`；
- 该会话 cwd 下出现 `uploads/<file>`；
- 发送的用户消息文本末尾含 `[附件]` 路径清单；
- 随后 agent 实际读取该文件并作出基于内容的回应。
截图留证（消息流 + uploads 目录）。

- [ ] **步骤 6：超限验证**

尝试选择一个 > 50MB 的文件。
预期：出现红色错误行"文件超过 50MB：…"，不入 chip 列表。

- [ ] **步骤 7：停止 dev，记录 QA 结论**

把步骤 2-6 的截图与结论整理为简短 QA 记录（贴在 PR 描述或本计划下方）。

---

## 任务 8：合并准备

- [ ] **步骤 1：全量 typecheck + lint**

运行：`node_modules/.bin/tsc --noEmit && npm run lint`
预期：PASS。

- [ ] **步骤 2：确认提交历史干净**

```bash
git log --oneline main..feat/file-upload
git status
```
预期：工作区干净，提交按任务分布。

- [ ] **步骤 3：合并回 main（测试通过后）**

```bash
git checkout main
git merge --no-ff feat/file-upload -m "feat: support document upload (word/excel/pdf/ppt/text/markdown)"
```

- [ ] **步骤 4：重新构建并重启正式服务（发布时必需）**

```bash
npm run build
systemctl --user restart pi-web.service
```

说明：正式服务使用 `next start` 读取 `.next/` 产物。合并到 `main` 后如果不重新 build，重启服务仍可能运行旧构建。

---

## 自检结论

- **规格覆盖度：** 端点（任务 2）、cwd/uploads 落盘（任务 2）、multipart 传输（任务 2/3）、ChatInput 镜像图片逻辑 + chip + 删除（任务 4）、发送时上传 + 路径附加（任务 5）、图片文档共存（任务 5 imageBlocks 保留）、类型白名单（任务 1）、50MB/20 个 env 可配（任务 1/2）、拖放（任务 6）、复用同一按钮 accept（任务 4）、错误处理（任务 4/5）、测试（任务 2 curl + 任务 7 QA）、分支合并（任务 8）。规格各项均有对应任务。
- **占位符扫描：** 无 TODO/待定；每个代码步骤含完整代码。
- **类型一致性：** `AttachedFile` 定义于 lib/upload.ts，ChatInput 与 useAgentSession 共用；`uploadFiles(cwd, files)` 签名在 agent-client 定义、useAgentSession 调用一致；`addFiles` 在 Handle 定义、ChatWindow 调用一致。
- **约定贴合：** 不引入测试框架（项目无），用 tsc + lint + curl + 浏览器 QA；chip 复用现有 `getFileIcon`；不改图片逻辑；不动 next.config（Route Handler 流式接收，Pages bodyParser 限制不适用）。
