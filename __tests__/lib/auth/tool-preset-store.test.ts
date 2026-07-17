import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolPresetStore } from "../../../lib/auth/tool-preset-store.ts";

let home = "";
let db: Database.Database;
let store: ReturnType<typeof createToolPresetStore>;

before(() => {
  home = mkdtempSync(join(tmpdir(), "pi-tool-preset-"));
  db = new Database(join(home, "auth.db"));
  db.exec(`
    CREATE TABLE user_tool_presets (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      tool_names_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_user_tool_presets_username ON user_tool_presets(username);
    CREATE TABLE user_tool_preset_defaults (
      username TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  store = createToolPresetStore(db);
});

after(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("stores custom tool presets per user", () => {
  const preset = store.create("alice", { name: "Read only", description: "Inspect only", toolNames: ["read", "grep"] });
  assert.equal(preset.scope, "custom");
  assert.equal(preset.name, "Read only");
  assert.deepEqual(preset.toolNames, ["read", "grep"]);
  assert.deepEqual(store.list("alice").custom.map((item) => item.name), ["Read only"]);
  assert.deepEqual(store.list("bob").custom, []);
});

test("updates and deletes only presets owned by the user", () => {
  const preset = store.create("alice", { name: "Shell", description: null, toolNames: ["bash"] });
  assert.equal(store.update("bob", preset.id, { name: "Nope", description: null, toolNames: [] }), null);

  const updated = store.update("alice", preset.id, { name: "Shell safe", description: "Use bash", toolNames: ["bash", "read"] });
  assert.equal(updated?.name, "Shell safe");
  assert.deepEqual(updated?.toolNames, ["bash", "read"]);

  assert.equal(store.delete("bob", preset.id), false);
  assert.equal(store.delete("alice", preset.id), true);
  assert.equal(store.get("alice", preset.id), null);
});

test("stores user default preset without affecting other users", () => {
  const preset = store.create("alice", { name: "No shell", description: null, toolNames: ["read"] });
  store.setDefault("alice", preset.id);
  assert.equal(store.getDefault("alice"), preset.id);
  assert.equal(store.getDefault("bob"), null);
});
