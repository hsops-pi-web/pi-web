import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
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

  it("shows explicit rename actions and keeps editing visible on save failure", async () => {
    mockAuthFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (value === "/api/sessions/s1" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ error: "rename failed" }), { status: 500 });
      }
      if (value.startsWith("/api/sessions/search")) return new Response(JSON.stringify({ results: [], indexStatus: "ready", pagination: { total: 0, page: 1, pageSize: 20 } }), { status: 200 });
      if (value.startsWith("/api/sessions")) return new Response(JSON.stringify({ sessions: [{ id: "s1", path: "/tmp/s1", cwd: "/p", created: "2026-07-15T00:00:00.000Z", modified: "2026-07-15T00:00:00.000Z", messageCount: 1, firstMessage: "hello", favorite: false, archived: false }], indexStatus: "ready", pagination: { total: 1, page: 1, pageSize: 100 } }), { status: 200 });
      if (value.startsWith("/api/workspaces")) return new Response(JSON.stringify({ workspaces: [] }), { status: 200 });
      if (value.startsWith("/api/tags")) return new Response(JSON.stringify({ tags: [] }), { status: 200 });
      if (value.startsWith("/api/home")) return new Response(JSON.stringify({ home: "/home/hsops" }), { status: 200 });
      if (value.startsWith("/api/default-cwd")) return new Response(JSON.stringify({ cwd: "/p" }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<SessionSidebar selectedSessionId={null} onSelectSession={vi.fn()} />);
    const rowTitle = await screen.findByText(/hello/);
    fireEvent.mouseEnter(rowTitle.closest("div")!.parentElement!.parentElement!);
    fireEvent.click(screen.getByTitle("Rename"));

    const input = screen.getByLabelText("Session name");
    expect(screen.getByTitle("Save rename")).toBeTruthy();
    expect(screen.getByTitle("Cancel rename")).toBeTruthy();

    fireEvent.change(input, { target: { value: "new name" } });
    fireEvent.click(screen.getByTitle("Save rename"));

    await waitFor(() => expect(screen.getByText("rename failed")).toBeTruthy());
    expect(screen.getByDisplayValue("new name")).toBeTruthy();
  });

  it("saves rename with an explicit action and refreshes sessions", async () => {
    render(<SessionSidebar selectedSessionId={null} onSelectSession={vi.fn()} />);
    const rowTitle = await screen.findByText(/hello/);
    fireEvent.mouseEnter(rowTitle.closest("div")!.parentElement!.parentElement!);
    fireEvent.click(screen.getByTitle("Rename"));

    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "renamed session" } });
    fireEvent.click(screen.getByTitle("Save rename"));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledWith(
      "/api/sessions/s1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "renamed session" }),
      }),
    ));
    await waitFor(() => expect(mockAuthFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/sessions")).length).toBeGreaterThan(1));
  });
});
