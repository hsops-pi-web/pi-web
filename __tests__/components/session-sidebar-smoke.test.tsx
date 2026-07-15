import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionSidebar } from "@/components/SessionSidebar";

vi.mock("@/lib/client-auth-fetch", () => ({ authFetch: vi.fn() }));
import { authFetch } from "@/lib/client-auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);

beforeEach(() => {
  mockAuthFetch.mockImplementation(async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.startsWith("/api/sessions/search")) return new Response(JSON.stringify({ results: [], indexStatus: "ready", pagination: { total: 0, page: 1, pageSize: 20 } }), { status: 200 });
    if (value.startsWith("/api/sessions")) return new Response(JSON.stringify({ sessions: [{ id: "s1", path: "/tmp/s1", cwd: "/p", created: "2026-07-15T00:00:00.000Z", modified: "2026-07-15T00:00:00.000Z", messageCount: 1, firstMessage: "hello", favorite: false, archived: false }], indexStatus: "ready", pagination: { total: 1, page: 1, pageSize: 100 } }), { status: 200 });
    if (value.startsWith("/api/workspaces")) return new Response(JSON.stringify({ workspaces: [{ cwd: "/p", displayName: null, sessionCount: 1, lastActiveAt: "2026-07-15T00:00:00.000Z", pinned: false, lastOpenedAt: null }] }), { status: 200 });
    if (value.startsWith("/api/tags")) return new Response(JSON.stringify({ tags: [] }), { status: 200 });
    if (value.startsWith("/api/home")) return new Response(JSON.stringify({ home: "/home/hsops" }), { status: 200 });
    if (value.startsWith("/api/default-cwd")) return new Response(JSON.stringify({ cwd: "/p" }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

describe("SessionSidebar advanced controls", () => {
  it("renders search, filters, workspace and session row", async () => {
    render(<SessionSidebar selectedSessionId={null} onSelectSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/hello/)).toBeTruthy());
    expect(screen.getByPlaceholderText(/Search sessions/)).toBeTruthy();
    expect(screen.getByTitle(/Favorite/)).toBeTruthy();
    fireEvent.click(screen.getByTitle(/Favorite/));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledWith(expect.stringContaining("/api/sessions/s1"), expect.objectContaining({ method: "PATCH" })));
  });
});
