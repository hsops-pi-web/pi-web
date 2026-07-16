import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminShell } from "@/components/admin/AdminShell";

describe("AdminShell", () => {
  it("renders admin observability navigation", () => {
    render(<AdminShell current="overview"><div>Overview body</div></AdminShell>);
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Sessions")).toBeTruthy();
    expect(screen.getByText("Workspaces")).toBeTruthy();
    expect(screen.getByText("Index Health")).toBeTruthy();
    expect(screen.getByText("Audit")).toBeTruthy();
    expect(screen.getByText("Overview body")).toBeTruthy();
  });
});
