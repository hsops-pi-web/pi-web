import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createModelPreferenceStore,
  resolveEffectiveDefault,
} from "../../../lib/auth/model-preference-store.ts";

let home = "";
let db: Database.Database;
let store: ReturnType<typeof createModelPreferenceStore>;

before(() => {
  home = mkdtempSync(join(tmpdir(), "pi-model-pref-"));
  db = new Database(join(home, "auth.db"));
  db.exec(`
    CREATE TABLE user_model_preferences (
      username TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  store = createModelPreferenceStore(db);
});

after(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

test("stores isolated preferences and upserts the latest model", () => {
  store.set("alice", "glm", "glm-5.2");
  store.set("bob", "qwen", "qwen3.6");
  store.set("alice", "opus", "claude-opus");

  assert.deepEqual(store.get("alice"), {
    provider: "opus",
    modelId: "claude-opus",
  });
  assert.deepEqual(store.get("bob"), {
    provider: "qwen",
    modelId: "qwen3.6",
  });
});

test("deletes only the selected user preference", () => {
  store.delete("alice");

  assert.equal(store.get("alice"), null);
  assert.deepEqual(store.get("bob"), {
    provider: "qwen",
    modelId: "qwen3.6",
  });
});

test("resolves user preference then global default then registry fallback", () => {
  const available = [
    { provider: "glm", id: "glm-5.2" },
    { provider: "qwen", id: "qwen3.6" },
  ];

  assert.deepEqual(
    resolveEffectiveDefault(
      available,
      { provider: "qwen", modelId: "qwen3.6" },
      { provider: "glm", modelId: "glm-5.2" }
    ),
    { provider: "qwen", modelId: "qwen3.6" }
  );
  assert.deepEqual(
    resolveEffectiveDefault(
      available,
      { provider: "gone", modelId: "gone" },
      { provider: "glm", modelId: "glm-5.2" }
    ),
    { provider: "glm", modelId: "glm-5.2" }
  );
  assert.deepEqual(
    resolveEffectiveDefault(
      available,
      null,
      { provider: "gone", modelId: "gone" }
    ),
    { provider: "glm", modelId: "glm-5.2" }
  );
  assert.equal(resolveEffectiveDefault([], null, null), null);
});
