import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("session index service exposes a stats sync path without changing the void sync wrapper", () => {
  const source = readFileSync("lib/session-index/service.ts", "utf8");

  assert.match(source, /export interface SessionIndexSyncStats/);
  assert.match(source, /scanned: number/);
  assert.match(source, /indexed: number/);
  assert.match(source, /unchanged: number/);
  assert.match(source, /markedMissing: number/);
  assert.match(source, /errors: Array<\{ path: string; error: string \}>/);
  assert.match(source, /export function syncSessionIndexWithStats/);
  assert.match(source, /options\.throttle \?\? true/);
  assert.match(source, /options\.sessionsDir \? scanSessionFiles\(options\.sessionsDir\) : scanSessionFiles\(getSessionsDir\(\)\)/);
  assert.match(source, /stats\.unchanged \+= 1/);
  assert.match(source, /stats\.indexed \+= 1/);
  assert.match(source, /stats\.markedMissing \+= 1/);
  assert.match(source, /stats\.errors\.push/);
  assert.match(source, /export function syncSessionIndex\(/);
  assert.match(source, /syncSessionIndexWithStats\(db, \{ force, throttle: true \}\);/);
});
