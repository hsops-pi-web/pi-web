# P3 Models Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the P3A model-management portion only: a real settings page for provider/model/default/test management while preserving the existing chat model picker and existing off/default/full tool quick control.

**Architecture:** Reuse the current `ModelsConfig` implementation through an embedded mode. Do not add custom tool preset persistence or chat UI changes for tool defaults; P3B is explicitly deferred because the current off/default/full control is sufficient for internal use.

**Tech Stack:** Next.js App Router, React client components, existing model config APIs, TypeScript typecheck, ESLint, existing node/vitest tests.

---

## Scope Decision

P3B custom tool preset management is deferred. The branch must not ship:

- custom tool preset APIs,
- custom tool preset SQLite tables,
- custom tool preset UI,
- new-session default tool preset persistence,
- chat dropdown save-default actions for tools.

The existing chat tool selector remains the product behavior:

- `off`
- `default`
- `full`

## Files

- Create `app/settings/models-tools/page.tsx`: Settings route shell.
- Create `components/ModelsToolsSettings.tsx`: Page-level settings UI for models, defaults, and connection-test guidance.
- Modify `components/ModelsConfig.tsx`: Add `embedded` rendering mode so the current model editor can render inside a page without duplicating model-management logic.
- Modify `hooks/useAgentSession.ts`: Refresh `/api/models` when the page regains focus or visibility so model changes made in settings appear in the existing chat picker without a full reload.
- Keep `components/ChatInput.tsx` and `components/ChatWindow.tsx` aligned with `main` chat picker behavior.

## Verification

- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `npm test` before merging into the integration branch.
- On 8144, verify:
  - `/settings/models-tools` renders the embedded Models editor.
  - Adding `glm-5.2` with a real `models[]` entry makes it appear in the chat model picker.
  - Returning from settings to chat refreshes the model picker without restarting the app.
  - The existing chat tool selector still shows only `off/default/full`.

## Integration Plan

1. Clean `p3-models-tools` to this P3A-only scope.
2. Verify and commit the cleanup.
3. Merge the cleaned P3A branch into `feat/session-workspace-experience`.
4. Run integrated verification there.
5. Use the integrated branch for UAT before any `main` merge or production release.
