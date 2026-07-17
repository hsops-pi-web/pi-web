import crypto from "crypto";
import type Database from "better-sqlite3";
import type { NormalizedToolPresetInput, ToolPresetDefinition } from "../tool-presets.ts";

interface ToolPresetRow {
  id: string;
  username: string;
  name: string;
  description: string | null;
  tool_names_json: string;
  created_at: string;
  updated_at: string;
}

export interface ToolPresetList {
  custom: ToolPresetDefinition[];
  defaultPresetId: string | null;
}

function rowToPreset(row: ToolPresetRow): ToolPresetDefinition {
  return {
    id: row.id,
    scope: "custom",
    name: row.name,
    description: row.description,
    toolNames: JSON.parse(row.tool_names_json) as string[],
  };
}

export function createToolPresetStore(db: Database.Database) {
  const listStatement = db.prepare(
    "SELECT id, username, name, description, tool_names_json, created_at, updated_at FROM user_tool_presets WHERE username=? ORDER BY name COLLATE NOCASE, created_at"
  );
  const getStatement = db.prepare(
    "SELECT id, username, name, description, tool_names_json, created_at, updated_at FROM user_tool_presets WHERE username=? AND id=?"
  );
  const insertStatement = db.prepare(`
    INSERT INTO user_tool_presets(id, username, name, description, tool_names_json, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatement = db.prepare(`
    UPDATE user_tool_presets
    SET name=?, description=?, tool_names_json=?, updated_at=?
    WHERE username=? AND id=?
  `);
  const deleteStatement = db.prepare("DELETE FROM user_tool_presets WHERE username=? AND id=?");
  const getDefaultStatement = db.prepare("SELECT preset_id FROM user_tool_preset_defaults WHERE username=?");
  const setDefaultStatement = db.prepare(`
    INSERT INTO user_tool_preset_defaults(username, preset_id, updated_at)
    VALUES(?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      preset_id=excluded.preset_id,
      updated_at=excluded.updated_at
  `);

  return {
    list(username: string): ToolPresetList {
      const custom = (listStatement.all(username) as ToolPresetRow[]).map(rowToPreset);
      return { custom, defaultPresetId: this.getDefault(username) };
    },
    get(username: string, id: string): ToolPresetDefinition | null {
      const row = getStatement.get(username, id) as ToolPresetRow | undefined;
      return row ? rowToPreset(row) : null;
    },
    create(username: string, input: NormalizedToolPresetInput): ToolPresetDefinition {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      insertStatement.run(id, username, input.name, input.description, JSON.stringify(input.toolNames), now, now);
      return {
        id,
        scope: "custom",
        name: input.name,
        description: input.description,
        toolNames: [...input.toolNames],
      };
    },
    update(username: string, id: string, input: NormalizedToolPresetInput): ToolPresetDefinition | null {
      const result = updateStatement.run(input.name, input.description, JSON.stringify(input.toolNames), new Date().toISOString(), username, id);
      if (result.changes === 0) return null;
      return this.get(username, id);
    },
    delete(username: string, id: string): boolean {
      const result = deleteStatement.run(username, id);
      return result.changes > 0;
    },
    getDefault(username: string): string | null {
      const row = getDefaultStatement.get(username) as { preset_id: string } | undefined;
      return row?.preset_id ?? null;
    },
    setDefault(username: string, presetId: string): void {
      setDefaultStatement.run(username, presetId, new Date().toISOString());
    },
  };
}
