import { NextResponse } from "next/server";
import {
  DEFAULT_FUNASR_MAX_AUDIO_MB,
  isAcceptedFunasrAudio,
} from "@/lib/funasr";

export const runtime = "nodejs";

const DEFAULT_FUNASR_BASE_URL = "http://10.16.49.27:18002";
const DEFAULT_FUNASR_MODEL = "paraformer-spk";

function funasrBaseUrl(): string {
  return (process.env.PI_WEB_FUNASR_URL || DEFAULT_FUNASR_BASE_URL).replace(/\/+$/, "");
}

function maxAudioBytes(): number {
  const mb = Number(process.env.PI_WEB_FUNASR_MAX_AUDIO_MB) || DEFAULT_FUNASR_MAX_AUDIO_MB;
  return mb * 1024 * 1024;
}

function optionalString(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (!raw || typeof raw !== "object") return "";

  const obj = raw as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text.trim();
  if (typeof obj.result === "string") return obj.result.trim();

  if (Array.isArray(obj.segments)) {
    return obj.segments
      .map((segment) => {
        if (!segment || typeof segment !== "object") return "";
        const text = (segment as Record<string, unknown>).text;
        return typeof text === "string" ? text.trim() : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (obj.data && typeof obj.data === "object") {
    return extractText(obj.data);
  }

  return "";
}

function numericField(raw: unknown, field: string): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>)[field];
  return typeof value === "number" ? value : undefined;
}

function stringField(raw: unknown, field: string): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

async function readFunasrResponse(res: Response): Promise<unknown> {
  const rawText = await res.text();
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Audio file is empty" }, { status: 400 });
    }
    if (file.size > maxAudioBytes()) {
      return NextResponse.json(
        { error: `Audio file too large (max ${maxAudioBytes() / (1024 * 1024)} MB)` },
        { status: 400 },
      );
    }
    if (!isAcceptedFunasrAudio(file.name, file.type)) {
      return NextResponse.json(
        { error: `Unsupported audio type: ${file.name || file.type || "unknown"}` },
        { status: 400 },
      );
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", file, file.name || "audio.wav");
    upstreamForm.append("model", optionalString(form.get("model")) ?? process.env.PI_WEB_FUNASR_MODEL ?? DEFAULT_FUNASR_MODEL);
    upstreamForm.append("response_format", "verbose_json");

    const language = optionalString(form.get("language")) ?? process.env.PI_WEB_FUNASR_LANGUAGE ?? null;
    if (language) upstreamForm.append("language", language);

    const hotword = optionalString(form.get("hotword")) ?? process.env.PI_WEB_FUNASR_HOTWORD ?? null;
    if (hotword) upstreamForm.append("hotword", hotword);

    const timeoutMs = Number(process.env.PI_WEB_FUNASR_TIMEOUT_MS) || 120_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let upstream: Response;
    try {
      upstream = await fetch(`${funasrBaseUrl()}/v1/audio/transcriptions`, {
        method: "POST",
        body: upstreamForm,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await readFunasrResponse(upstream);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `FunASR returned HTTP ${upstream.status}`, raw },
        { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
      );
    }

    return NextResponse.json({
      success: true,
      text: extractText(raw),
      raw,
      model: stringField(raw, "model"),
      language: stringField(raw, "language"),
      duration: numericField(raw, "duration"),
      processingTime: numericField(raw, "processing_time"),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "FunASR request timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
