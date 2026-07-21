import { describe, expect, it } from "vitest";
import { buildSessionTree, shortenCwd } from "@/components/session-sidebar/utils";
import type { SessionInfo } from "@/lib/types";

function session(id: string, parentSessionId?: string): SessionInfo {
  return {
    id,
    parentSessionId,
    path: `/tmp/${id}.jsonl`,
    cwd: "/p",
    created: "2026-07-15T00:00:00.000Z",
    modified: `2026-07-15T00:00:0${id.length}.000Z`,
    messageCount: 1,
    firstMessage: id,
  };
}

describe("session sidebar utils", () => {
  it("shortens cwd relative to home", () => {
    expect(shortenCwd("/home/tester/pi-users/alice/project", "/home/tester")).toBe(".../alice/project".replace("...", "…"));
  });

  it("shortens non-home cwd using the last two path segments", () => {
    expect(shortenCwd("/srv/apps/pi-web-auth", "/home/tester")).toBe("…/pi-web-auth");
  });

  it("builds tree through nearest existing ancestor", () => {
    const tree = buildSessionTree([session("root"), session("child", "root")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].session.id).toBe("child");
  });
});
