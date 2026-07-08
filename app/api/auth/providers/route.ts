import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const username = getSessionUser(req);
  if (!username) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const authStorage = AuthStorage.create();
  const providers = authStorage.getOAuthProviders();

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        const loggedIn = authStorage.has(p.id);
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: p.usesCallbackServer ?? false,
          loggedIn,
        };
      })
  );

  return Response.json({ providers: result });
}
