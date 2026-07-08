import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(req: Request, { params }: Params) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { provider } = await params;
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const status = registry.getProviderAuthStatus(provider);
  const displayName = registry.getProviderDisplayName(provider);
  const models = registry.getAll().filter((m) => m.provider === provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const authStorage = AuthStorage.create();
    authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(req: Request, { params }: Params) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { provider } = await params;
  try {
    const authStorage = AuthStorage.create();
    authStorage.remove(provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
