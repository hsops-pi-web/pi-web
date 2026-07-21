import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("session index service uses static imports for bundled runtime", () => {
  const source = readFileSync("lib/session-index/service.ts", "utf8");
  assert.doesNotMatch(source, /eval\("require"\)|require\(/);
  assert.match(source, /import \{ getSessionIndexDbPath \} from "\.\.\/auth\/data-dir"/);
});

test("session index service has a cold-start scanner path", () => {
  const source = readFileSync("lib/session-index/service.ts", "utf8");
  assert.match(source, /export function syncSessionIndex/);
  assert.match(source, /scanSessionFiles\(getSessionsDir\(\)\)/);
  assert.match(source, /markMissingSessionPath/);
});
