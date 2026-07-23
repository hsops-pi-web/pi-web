import { describe, expect, it } from "vitest";
import { isAcceptedDoc, isAcceptedUpload } from "@/lib/upload";

describe("isAcceptedUpload", () => {
  it("accepts images and supported documents", () => {
    expect(isAcceptedUpload(new File(["x"], "shot.png", { type: "image/png" }))).toBe(true);
    expect(isAcceptedUpload(new File(["x"], "report.pdf", { type: "application/pdf" }))).toBe(true);
  });

  it("rejects unsupported files while keeping doc rules intact", () => {
    expect(isAcceptedUpload(new File(["x"], "archive.zip", { type: "application/zip" }))).toBe(false);
    expect(isAcceptedDoc("report.pdf")).toBe(true);
  });
});
