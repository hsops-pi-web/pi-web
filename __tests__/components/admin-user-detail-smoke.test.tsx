import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import AdminUserDetailPage from "@/app/admin/users/[username]/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ username: "alice" }),
}));

vi.mock("@/components/FileExplorer", () => ({
  FileExplorer: ({ cwd, urlBase }: { cwd: string; urlBase?: string }) => (
    <div data-testid="admin-file-explorer">{cwd}::{urlBase}</div>
  ),
}));

vi.mock("@/components/FileViewer", () => ({
  FileViewer: ({ filePath, urlBase }: { filePath: string; urlBase?: string }) => (
    <div data-testid="admin-file-viewer">{filePath}::{urlBase}</div>
  ),
}));

const userDetail = {
  user: {
    username: "alice",
    summary: {
      sessionCount: 1,
      workspaceCount: 1,
      missingCount: 0,
      orphanedCount: 0,
      indexErrorCount: 0,
      lastActiveAt: "2026-07-16T00:10:00.000Z",
    },
    recentSessions: [
      {
        id: "s1",
        cwd: "/home/hsops/pi-users/alice/project",
        title: "Alice session",
        firstMessage: "hello",
        modifiedAt: "2026-07-16T00:10:00.000Z",
      },
    ],
    recentWorkspaces: [
      {
        cwd: "/home/hsops/pi-users/alice/project",
        sessionCount: 1,
        lastActiveAt: "2026-07-16T00:10:00.000Z",
      },
    ],
    issues: [],
  },
};

const sessionDetail = {
  cwd: "/home/hsops/pi-users/alice/project",
  modified: "2026-07-16T00:10:00.000Z",
  context: {
    messages: [
      { role: "user", content: "Hello from Alice" },
      { role: "assistant", content: [{ type: "text", text: "Admin can read this." }], model: "m", provider: "p" },
    ],
    entryIds: ["u1", "a1"],
    thinkingLevel: "medium",
    model: { provider: "p", modelId: "m" },
  },
};

let mockFetch: ReturnType<typeof vi.fn>;

describe("AdminUserDetailPage", () => {
  beforeEach(() => {
    mockFetch = vi.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value === "/api/admin/users/alice/observability") {
        return new Response(JSON.stringify(userDetail), { status: 200 });
      }
      if (value === "/api/admin/users/alice/sessions/s1") {
        return new Response(JSON.stringify(sessionDetail), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("exposes per-user session detail and read-only file access", async () => {
    render(<AdminUserDetailPage />);

    await waitFor(() => expect(screen.getByText("Alice session")).toBeTruthy());
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByTestId("admin-file-explorer").textContent).toContain("/api/admin/files/alice");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(screen.getByText("Hello from Alice")).toBeTruthy());
    expect(screen.getByText("Admin can read this.")).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users/alice/sessions/s1", undefined);
  });
});
