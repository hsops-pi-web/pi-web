// Shared document-upload constants and pure helpers for frontend and API routes.
// Keep this module isomorphic: no fs, path, or fetch dependencies.

export const DEFAULT_MAX_FILE_MB = 50;
export const DEFAULT_MAX_COUNT = 20;

// Accepted document extensions, lowercase without dots. Images use the existing image flow.
export const ACCEPTED_DOC_EXTENSIONS = [
  "doc", "docx",
  "xls", "xlsx", "csv",
  "pdf",
  "ppt", "pptx",
  "txt",
  "md", "markdown",
] as const;

export const ACCEPT_ATTR =
  "image/*," + ACCEPTED_DOC_EXTENSIONS.map((ext) => `.${ext}`).join(",");

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

export function isAcceptedUpload(file: File): boolean {
  return file.type.startsWith("image/") || isAcceptedDoc(file.name);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
