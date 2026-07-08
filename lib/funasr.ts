import { authFetch } from "@/lib/client-auth-fetch";

export const FUNASR_AUDIO_ACCEPT_ATTR = [
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
].join(",");

export const DEFAULT_FUNASR_MAX_AUDIO_MB = 100;

const ACCEPTED_AUDIO_EXTENSIONS = new Set(["wav", "mp3", "m4a", "aac", "flac"]);

export interface FunasrTranscription {
  text: string;
  raw?: unknown;
  model?: string;
  language?: string;
  duration?: number;
  processingTime?: number;
}

export function isAcceptedFunasrAudio(name: string, type?: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot === -1 ? "" : lower.slice(dot + 1);
  if (ACCEPTED_AUDIO_EXTENSIONS.has(ext)) return true;
  return Boolean(type && ["audio/wav", "audio/mpeg", "audio/mp4", "audio/aac", "audio/flac"].includes(type));
}

export async function transcribeFunasrAudio(file: File): Promise<FunasrTranscription> {
  const form = new FormData();
  form.append("file", file);

  const res = await authFetch("/api/funasr/transcribe", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
  } & FunasrTranscription;

  if (!res.ok || body.error || body.success !== true) {
    throw new Error(body.error ?? `FunASR transcription failed: HTTP ${res.status}`);
  }

  return {
    text: body.text ?? "",
    raw: body.raw,
    model: body.model,
    language: body.language,
    duration: body.duration,
    processingTime: body.processingTime,
  };
}
