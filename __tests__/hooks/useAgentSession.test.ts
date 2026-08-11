import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { sendAgentCommand } from "@/lib/agent-client";
import { authFetch } from "@/lib/client-auth-fetch";
import type { SessionInfo } from "@/lib/types";

vi.mock("@/lib/agent-client");
vi.mock("@/lib/client-auth-fetch");

afterEach(cleanup);

const mockSendAgentCommand = vi.mocked(sendAgentCommand);
const mockAuthFetch = vi.mocked(authFetch);

const session: SessionInfo = {
  id: "session-1",
  path: "/sessions/session-1.jsonl",
  cwd: "/home/user/project",
  created: "2026-08-11T02:39:02.000Z",
  modified: "2026-08-11T02:50:57.000Z",
  messageCount: 0,
  firstMessage: "",
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The hook logs failures before surfacing them; keep test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockAuthFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/models")) {
      return jsonResponse({ models: {}, modelList: [] });
    }
    return jsonResponse({
      sessionId: session.id,
      filePath: session.path,
      tree: [],
      leafId: null,
      context: { messages: [], entryIds: [], thinkingLevel: "off", model: null },
    });
  });
});

describe("useAgentSession handleModelChange", () => {
  it("切换模型失败时应把错误暴露给界面", async () => {
    mockSendAgentCommand.mockRejectedValue(
      new Error("Model not found: opus-5-tsingmao/claude-opus-5")
    );

    const { result } = renderHook(() =>
      useAgentSession({ session, newSessionCwd: null })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleModelChange("opus-5-tsingmao", "claude-opus-5");
    });

    expect(result.current.modelError).toContain("Model not found");
    expect(result.current.currentModel).toBeNull();
  });

  it("切换模型失败不得清空会话视图", async () => {
    mockSendAgentCommand.mockRejectedValue(new Error("Model not found: ghost/ghost-1"));

    const { result } = renderHook(() =>
      useAgentSession({ session, newSessionCwd: null })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleModelChange("ghost", "ghost-1");
    });

    // ChatWindow renders a full-page error instead of the chat when `error` is set.
    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
  });

  it("切换模型成功时不应留下错误", async () => {
    mockSendAgentCommand.mockResolvedValue({ id: "claude-opus-5", provider: "opus-5-tsingmao" });

    const { result } = renderHook(() =>
      useAgentSession({ session, newSessionCwd: null })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleModelChange("opus-5-tsingmao", "claude-opus-5");
    });

    expect(result.current.modelError).toBeNull();
    expect(result.current.currentModel).toEqual({
      provider: "opus-5-tsingmao",
      modelId: "claude-opus-5",
    });
  });
});
