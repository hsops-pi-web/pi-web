import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-"));
const userRoot = path.join(tmpRoot, "pi-users", "tester");

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(() => "tester"),
}));

vi.mock("@/lib/auth/paths", () => ({
  resolveExistingAndCheck: vi.fn((cwd: string, username: string) => path.resolve(cwd).startsWith(path.join(tmpRoot, "pi-users", username))),
}));

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.spyOn(os, "homedir").mockReturnValue(tmpRoot);
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(path.join(userRoot, "workspace"), { recursive: true });
  });

  it("uploads image files into the workspace uploads directory", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const image = new File([Buffer.from("png-data")], "shot.png", { type: "image/png" });
    const form = new FormData();
    form.set("cwd", path.join(userRoot, "workspace"));
    form.set("files", image);

    const req = {
      formData: async () => form,
    };

    const res = await POST(req);
    if (res.status !== 200) {
      throw new Error(await res.text());
    }

    const body = await res.json() as { success: boolean; paths: string[] };
    expect(body.success).toBe(true);
    expect(body.paths).toEqual(["uploads/shot.png"]);
    expect(readFileSync(path.join(userRoot, "workspace", "uploads", "shot.png"), "utf8")).toBe("png-data");
  });
});
