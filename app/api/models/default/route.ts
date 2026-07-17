import { NextResponse } from "next/server";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getSessionUser } from "@/lib/auth/session";
import { setUserModelPreference } from "@/lib/auth/model-preferences";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json() as { provider?: unknown; modelId?: unknown };
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  if (!provider || !modelId) return NextResponse.json({ error: "provider and modelId are required" }, { status: 400 });

  const model = ModelRegistry.create(AuthStorage.create()).find(provider, modelId);
  if (!model) return NextResponse.json({ error: "Model not found" }, { status: 400 });

  setUserModelPreference(username, provider, modelId);
  return NextResponse.json({ defaultModel: { provider, modelId } });
}
