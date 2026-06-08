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
