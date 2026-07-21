import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionSettingsManager } from "../../../lib/session-settings.ts";

test("session settings read file configuration without persisting mutations", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-session-settings-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(agentDir, { recursive: true });

  const globalPath = join(agentDir, "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");
  writeFileSync(globalPath, JSON.stringify({
    defaultProvider: "glm",
    defaultModel: "glm-5.2",
    defaultThinkingLevel: "xhigh",
    extensions: ["global-ext"],
  }, null, 2));
  writeFileSync(projectPath, JSON.stringify({
    extensions: ["project-ext"],
  }, null, 2));

  const beforeGlobal = readFileSync(globalPath, "utf8");
  const beforeProject = readFileSync(projectPath, "utf8");

  try {
    const settings = createSessionSettingsManager(cwd, agentDir);
    assert.deepEqual(settings.getExtensionPaths(), ["project-ext"]);

    settings.setDefaultModelAndProvider("qwen", "qwen3.6");
    settings.setDefaultThinkingLevel("low");
    await settings.flush();

    assert.equal(settings.getDefaultProvider(), "qwen");
    assert.equal(settings.getDefaultModel(), "qwen3.6");
    assert.equal(settings.getDefaultThinkingLevel(), "low");
    assert.equal(readFileSync(globalPath, "utf8"), beforeGlobal);
    assert.equal(readFileSync(projectPath, "utf8"), beforeProject);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
