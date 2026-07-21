import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSessionFiles } from "../../../lib/session-index/scanner.ts";

test("scans jsonl files by readdir and stat without parsing content", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-scan-"));
  try {
    const cwdDir = encodeURIComponent("/tmp/project");
    mkdirSync(join(dir, cwdDir), { recursive: true });
    writeFileSync(join(dir, cwdDir, "bad.jsonl"), "not json");
    writeFileSync(join(dir, cwdDir, "ignore.txt"), "ignored");

    const files = scanSessionFiles(dir);

    assert.equal(files.length, 1);
    assert.equal(files[0].path.endsWith("bad.jsonl"), true);
    assert.ok(files[0].mtimeMs > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
