import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ModelsConfig } from "@/components/ModelsConfig";
import { authFetch } from "@/lib/client-auth-fetch";

vi.mock("@/lib/client-auth-fetch");

afterEach(cleanup);

const mockAuthFetch = vi.mocked(authFetch);

const STALE_WARNING =
  "默认模型 gpt-5.5-tsingmao/openai/gpt-5.5 已不在配置中，请重新设置默认模型";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function mockApi(putResponse: unknown) {
  mockAuthFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/models-config" && init?.method === "PUT") {
      return jsonResponse(putResponse);
    }
    if (url === "/api/models-config") {
      return jsonResponse({ providers: { "opus-5-tsingmao": { models: [{ id: "claude-opus-5" }] } } });
    }
    if (url === "/api/models") {
      return jsonResponse({ modelList: [], globalDefaultModel: null });
    }
    return jsonResponse({ providers: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelsConfig 保存后的失效默认模型提示", () => {
  it("保存返回 warning 时应展示给管理员", async () => {
    mockApi({ success: true, warning: STALE_WARNING });
    render(<ModelsConfig />);

    const saveButton = await screen.findByRole("button", { name: /Save/ });
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText(STALE_WARNING)).toBeTruthy());
  });

  it("保存无 warning 时不展示提示", async () => {
    mockApi({ success: true });
    render(<ModelsConfig />);

    const saveButton = await screen.findByRole("button", { name: /Save/ });
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(screen.queryByText(/已不在配置中/)).toBeNull();
  });
});
