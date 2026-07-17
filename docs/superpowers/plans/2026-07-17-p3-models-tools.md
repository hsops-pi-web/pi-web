# P3 Models And Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build P3 as a scoped models/tools experience: a real `/settings/models-tools` management page, persisted tool presets, explicit defaults, and slim chat quick controls.

**Architecture:** Reuse the existing `ModelsConfig` implementation instead of rebuilding model provider/model editing. Add a focused tool preset domain/store/API, then introduce a settings page that hosts model management and tool preset management. Chat remains a quick-switch surface and calls APIs for saving current model/tool choices as defaults.

**Tech Stack:** Next.js App Router, React client components, SQLite via existing auth DB helpers, node test runner for server/domain code, TypeScript typecheck, ESLint.

---

## File Structure

- Create `lib/tool-presets.ts`: Pure domain definitions, built-in presets, validation, default resolution, and serialization helpers.
- Create `lib/auth/tool-preset-store.ts`: SQLite-backed user preset/default storage using the existing auth DB connection.
- Create `__tests__/lib/auth/tool-presets.test.ts`: Domain tests for built-ins, validation, and default resolution.
- Create `__tests__/lib/auth/tool-preset-store.test.ts`: Storage tests for custom presets and per-user defaults.
- Create `app/api/tool-presets/route.ts`: `GET` and `POST` presets for the current user.
- Create `app/api/tool-presets/[id]/route.ts`: `PATCH` and `DELETE` custom presets for the current user.
- Create `app/api/tool-presets/default/route.ts`: `POST` default preset selection for the current user.
- Create `app/settings/models-tools/page.tsx`: Settings route shell.
- Create `components/ModelsToolsSettings.tsx`: Page-level settings UI with Models, Tool presets, Defaults, and Connection test tabs.
- Create `components/ToolPresetManager.tsx`: Tool preset management UI.
- Modify `components/ModelsConfig.tsx`: Support embedded mode so the current model editor can render inside the settings page without a modal wrapper.
- Modify `components/AppShell.tsx`: Add navigation into `/settings/models-tools` from existing app shell/sidebar area if needed.
- Modify `components/ChatInput.tsx`: Keep quick controls compact; add save-as-default and settings shortcuts near model/tool menus.
- Modify `hooks/useAgentSession.ts`: Load persisted tool default for new sessions and expose saving current model/tool as defaults if this hook owns those operations.
- Modify `app/api/agent/new/route.ts`: Apply user default tool preset when `toolNames` is not explicitly provided.
- Modify `lib/auth/db.ts`: Add tool preset tables to the auth DB schema.

## Task 1: Tool Preset Domain

**Files:**
- Create: `lib/tool-presets.ts`
- Test: `__tests__/lib/auth/tool-presets.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `__tests__/lib/auth/tool-presets.test.ts` with tests that assert:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_TOOL_PRESETS,
  normalizeToolPresetInput,
  resolveToolPresetDefault,
} from "../../../lib/tool-presets";

test("built-in tool presets expose stable ids and tool names", () => {
  assert.deepEqual(BUILTIN_TOOL_PRESETS.map((preset) => preset.id), ["none", "default", "full"]);
  assert.deepEqual(BUILTIN_TOOL_PRESETS[0].toolNames, []);
  assert.deepEqual(BUILTIN_TOOL_PRESETS[1].toolNames, ["read", "bash", "edit", "write"]);
  assert.deepEqual(BUILTIN_TOOL_PRESETS[2].toolNames, ["bash", "read", "edit", "write", "grep", "find", "ls"]);
});

test("normalizeToolPresetInput trims, deduplicates, and rejects unknown tool names", () => {
  assert.deepEqual(
    normalizeToolPresetInput({ name: " Coding ", toolNames: ["read", "bash", "read"] }, ["read", "bash"]),
    { name: "Coding", description: null, toolNames: ["read", "bash"] }
  );
  assert.throws(
    () => normalizeToolPresetInput({ name: "Bad", toolNames: ["read", "unknown"] }, ["read"]),
    /Unknown tool name: unknown/
  );
});

test("resolveToolPresetDefault prefers user default then built-in default", () => {
  assert.equal(resolveToolPresetDefault("custom-1")?.id, "custom-1");
  assert.equal(resolveToolPresetDefault(null)?.id, "default");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test __tests__/lib/auth/tool-presets.test.ts`

Expected: FAIL because `lib/tool-presets.ts` does not exist.

- [ ] **Step 3: Implement domain module**

Create `lib/tool-presets.ts` exporting:

```ts
export type ToolPresetScope = "builtin" | "custom";

export interface ToolPresetDefinition {
  id: string;
  scope: ToolPresetScope;
  name: string;
  description: string | null;
  toolNames: string[];
  readonly?: boolean;
}

export const BUILTIN_TOOL_PRESETS: ToolPresetDefinition[] = [
  { id: "none", scope: "builtin", name: "No tools", description: "Pure chat without tool access", toolNames: [], readonly: true },
  { id: "default", scope: "builtin", name: "Default", description: "Read, bash, edit, write, and extensions", toolNames: ["read", "bash", "edit", "write"], readonly: true },
  { id: "full", scope: "builtin", name: "Full", description: "All built-in tools and extensions", toolNames: ["bash", "read", "edit", "write", "grep", "find", "ls"], readonly: true },
];

export function normalizeToolPresetInput(input: { name?: unknown; description?: unknown; toolNames?: unknown }, availableToolNames: string[]) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Preset name is required");
  if (!Array.isArray(input.toolNames)) throw new Error("toolNames must be an array");
  const available = new Set(availableToolNames);
  const toolNames: string[] = [];
  for (const raw of input.toolNames) {
    if (typeof raw !== "string") throw new Error("toolNames must contain strings");
    const toolName = raw.trim();
    if (!toolName) continue;
    if (!available.has(toolName)) throw new Error(`Unknown tool name: ${toolName}`);
    if (!toolNames.includes(toolName)) toolNames.push(toolName);
  }
  const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;
  return { name, description, toolNames };
}

export function resolveToolPresetDefault(defaultPresetId: string | null): { id: string } {
  return { id: defaultPresetId || "default" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test __tests__/lib/auth/tool-presets.test.ts`

Expected: PASS.

## Task 2: Tool Preset Storage

**Files:**
- Modify: `lib/auth/db.ts`
- Create: `lib/auth/tool-preset-store.ts`
- Test: `__tests__/lib/auth/tool-preset-store.test.ts`

- [ ] **Step 1: Inspect auth DB test helpers**

Read `__tests__/lib/auth/model-preferences.test.ts` and `lib/auth/db.ts` to follow existing test isolation and schema style.

- [ ] **Step 2: Write failing storage tests**

Create tests that reset the auth DB to a temp path using the same pattern as existing auth tests, then assert:

```ts
test("stores custom tool presets per user", () => {
  const store = createToolPresetStore();
  const preset = store.create("alice", { name: "Read only", description: "Inspect only", toolNames: ["read", "grep"] });
  assert.equal(preset.scope, "custom");
  assert.equal(preset.name, "Read only");
  assert.deepEqual(store.list("alice").custom.map((item) => item.name), ["Read only"]);
  assert.deepEqual(store.list("bob").custom, []);
});

test("stores user default preset without affecting other users", () => {
  const store = createToolPresetStore();
  const preset = store.create("alice", { name: "No shell", description: null, toolNames: ["read"] });
  store.setDefault("alice", preset.id);
  assert.equal(store.getDefault("alice"), preset.id);
  assert.equal(store.getDefault("bob"), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-strip-types --test __tests__/lib/auth/tool-preset-store.test.ts`

Expected: FAIL because storage module/schema does not exist.

- [ ] **Step 4: Add SQLite schema**

In `lib/auth/db.ts`, add tables:

```sql
CREATE TABLE IF NOT EXISTS user_tool_presets (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tool_names_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_tool_presets_username ON user_tool_presets(username);
CREATE TABLE IF NOT EXISTS user_tool_preset_defaults (
  username TEXT PRIMARY KEY,
  preset_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 5: Implement store**

Create `lib/auth/tool-preset-store.ts` with `createToolPresetStore()` exposing `list(username)`, `create(username, input)`, `update(username, id, input)`, `delete(username, id)`, `getDefault(username)`, and `setDefault(username, presetId)`.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --experimental-strip-types --test __tests__/lib/auth/tool-preset-store.test.ts`

Expected: PASS.

## Task 3: Tool Preset APIs

**Files:**
- Create: `app/api/tool-presets/route.ts`
- Create: `app/api/tool-presets/[id]/route.ts`
- Create: `app/api/tool-presets/default/route.ts`

- [ ] **Step 1: Implement authenticated routes**

Use `getSessionUser(req)` like existing model APIs. `GET /api/tool-presets` returns `{ builtins, custom, defaultPresetId }`. `POST /api/tool-presets` creates a custom preset. `PATCH /api/tool-presets/[id]` updates a custom preset. `DELETE /api/tool-presets/[id]` deletes a custom preset. `POST /api/tool-presets/default` stores a builtin or custom preset id as the user's default.

- [ ] **Step 2: Validate default ids**

Allow `none`, `default`, `full`, or a custom preset owned by the current user. Return `400` for unknown ids and `401` for unauthenticated requests.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Task 4: Apply Tool Defaults To New Sessions

**Files:**
- Modify: `app/api/agent/new/route.ts`
- Modify: `lib/tool-presets.ts`

- [ ] **Step 1: Add resolver helper**

Add `resolveToolNamesForPreset(presetId, customPresets)` to `lib/tool-presets.ts`, returning the tool names for a builtin or custom preset.

- [ ] **Step 2: Apply default only when request omits toolNames**

In `app/api/agent/new/route.ts`, if `toolNames` is `undefined`, load the user's default preset id and custom presets, resolve tool names, and pass those names into `startRpcSession`. If `toolNames` is present, preserve the current explicit behavior.

- [ ] **Step 3: Run focused tests/typecheck**

Run: `node --experimental-strip-types --test __tests__/lib/auth/tool-presets.test.ts __tests__/lib/auth/tool-preset-store.test.ts && npm run typecheck`

Expected: PASS.

## Task 5: Settings Page And Embedded Model Management

**Files:**
- Create: `app/settings/models-tools/page.tsx`
- Create: `components/ModelsToolsSettings.tsx`
- Modify: `components/ModelsConfig.tsx`

- [ ] **Step 1: Add embedded mode to ModelsConfig**

Change `ModelsConfig` props to accept `embedded?: boolean`. When `embedded` is false or omitted, keep the existing modal overlay. When true, render the current body inside a page container without the fixed backdrop, modal close button, or footer Cancel button.

- [ ] **Step 2: Create settings route**

Create `app/settings/models-tools/page.tsx` that renders `ModelsToolsSettings`.

- [ ] **Step 3: Create page shell**

Create `components/ModelsToolsSettings.tsx` with tabs: `Models`, `Tool presets`, `Defaults`, and `Connection tests`. The Models tab embeds `ModelsConfig embedded`. The Tool presets tab renders `ToolPresetManager`. Defaults summarizes current personal defaults and links to the relevant controls. Connection tests can reuse model testing from the embedded model editor and should not duplicate connection logic in this task.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Task 6: Tool Preset Management UI

**Files:**
- Create: `components/ToolPresetManager.tsx`

- [ ] **Step 1: Implement manager UI**

Fetch `/api/tool-presets`, display built-ins read-only, display custom presets editable, allow creating a custom preset from selected tool checkboxes, allow deleting custom presets, and allow setting any preset as personal default.

- [ ] **Step 2: Keep unknown tools out of custom input**

For available tools, use the union of built-in known tools and active session tools when available; if no session tool list exists on the settings page, start with the known built-ins and explain extension tools are included by the agent runtime when active.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Task 7: Chat Quick Controls

**Files:**
- Modify: `components/ChatInput.tsx`
- Modify: `hooks/useAgentSession.ts` if needed

- [ ] **Step 1: Add quick settings links**

In model and tool dropdowns, add a compact row linking to `/settings/models-tools`.

- [ ] **Step 2: Add save default actions**

Add model dropdown action "Save model as default" using the existing model preference/default API path if available. Add tool dropdown action "Save tools as default" using `/api/tool-presets/default` with the current preset id.

- [ ] **Step 3: Preserve current fast-switch behavior**

Do not add full preset editing into chat. Chat remains current model, current preset, quick switch, save default, settings link.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Task 8: Verification

**Files:**
- No new files unless fixing verification failures.

- [ ] **Step 1: Run focused tests**

Run: `node --experimental-strip-types --test __tests__/lib/auth/tool-presets.test.ts __tests__/lib/auth/tool-preset-store.test.ts`

Expected: PASS.

- [ ] **Step 2: Run project verification commands except build**

Run: `npm run typecheck`, `npm run lint`, `npm test`.

Expected: PASS.

- [ ] **Step 3: Start non-8000 dev server**

Run: `HOME=/home/hsops/.pi-feature-dev-home npm run dev -- -p 8144`.

Expected: server starts on port 8144. Do not run `next build`.

- [ ] **Step 4: Manual UI smoke**

Open `http://localhost:8144/settings/models-tools`, confirm Models tab renders, Tool presets tab renders built-ins and create form, and chat quick dropdowns still open without layout overlap.

