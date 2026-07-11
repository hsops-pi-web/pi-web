import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const guard = requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const { provider } = await params;
  const authStorage = AuthStorage.create();
  const providers = authStorage.getOAuthProviders();
  if (!providers.find((p) => p.id === provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  authStorage.logout(provider);
  return Response.json({ ok: true });
}
