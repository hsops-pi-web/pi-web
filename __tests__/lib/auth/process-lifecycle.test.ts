import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abortAndShutdownSession,
  ProcessDrainingError,
  ProcessLifecycle,
  SessionDisposeError,
  shutdownAgentSession,
  type DrainableSession,
  type LifecycleClock,
} from "../../../lib/process-lifecycle.ts";

function clock() {
  let now = 0;
  const value: LifecycleClock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  return { value, get now() { return now; } };
}

function session(
  id: string,
  streaming = false,
): DrainableSession & {
  streaming: boolean;
  aborted: number;
  shutdowns: number;
} {
  return {
    sessionId: id,
    streaming,
    aborted: 0,
    shutdowns: 0,
    isStreaming() { return this.streaming; },
    async abortForShutdown() {
      this.aborted++;
      this.streaming = false;
    },
    async shutdown() { this.shutdowns++; },
  };
}

test("agent shutdown emits quit once, then disposes once", async () => {
  const calls: string[] = [];
  await shutdownAgentSession({
    extensionRunner: {
      hasHandlers: () => true,
      emit: async (event: { type: string; reason: string }) => {
        calls.push(`${event.type}:${event.reason}`);
      },
    },
    dispose: () => calls.push("dispose"),
  });
  assert.deepEqual(calls, ["session_shutdown:quit", "dispose"]);
});

test("dispose still runs when an extension shutdown handler fails", async () => {
  let disposed = 0;
  await assert.rejects(() => shutdownAgentSession({
    extensionRunner: {
      hasHandlers: () => true,
      emit: async () => { throw new Error("extension failed"); },
    },
    dispose: () => { disposed += 1; },
  }));
  assert.equal(disposed, 1);
});

test("abort failure still shuts the session down", async () => {
  const managed = session("abort-failure", true);
  managed.abortForShutdown = async () => {
    throw new Error("abort failed");
  };

  await assert.rejects(() => abortAndShutdownSession(managed), /abort failed/);
  assert.equal(managed.shutdowns, 1);
});

test("admission rejects while draining", async () => {
  const lifecycle = new ProcessLifecycle(clock().value);
  assert.deepEqual(lifecycle.agentAdmission(), { allowed: true });
  const drain = lifecycle.drain({ graceMs: 0 });
  assert.deepEqual(lifecycle.agentAdmission(), {
    allowed: false,
    status: 503,
    retryAfter: "5",
    error: "服务正在发布，请稍后重试",
  });
  assert.throws(() => lifecycle.beginSessionStart(), ProcessDrainingError);
  await drain;
});

test("natural completion is not aborted", async () => {
  const c = clock();
  const lifecycle = new ProcessLifecycle(c.value);
  const natural = session("natural", true);
  lifecycle.register(natural);
  c.value.sleep = async () => {
    natural.streaming = false;
    await Promise.resolve();
  };

  const result = await lifecycle.drain({ graceMs: 30_000, pollMs: 100 });
  assert.equal(natural.aborted, 0);
  assert.equal(result.naturallyCompleted, 1);
  assert.equal(natural.shutdowns, 1);
});

test("timeout aborts streaming sessions", async () => {
  const lifecycle = new ProcessLifecycle(clock().value);
  const slow = session("slow", true);
  lifecycle.register(slow);

  const result = await lifecycle.drain({ graceMs: 30_000, pollMs: 100 });
  assert.equal(slow.aborted, 1);
  assert.equal(slow.shutdowns, 1);
  assert.equal(result.aborted, 1);
  assert.equal(result.elapsedMs, 30_000);
});

test("shutdown failures are isolated and sanitized", async () => {
  const lifecycle = new ProcessLifecycle(clock().value);
  const bad = session("bad");
  bad.shutdown = async () => { throw new Error("secret"); };
  const good = session("good");
  lifecycle.register(bad);
  lifecycle.register(good);

  const result = await lifecycle.drain({ graceMs: 0 });
  assert.equal(good.shutdowns, 1);
  assert.deepEqual(result.errors, [{ sessionId: "bad", phase: "session_shutdown" }]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("drain is strictly idempotent", async () => {
  const lifecycle = new ProcessLifecycle(clock().value);
  const managed = session("once");
  lifecycle.register(managed);
  const first = lifecycle.drain({ graceMs: 0 });
  const second = lifecycle.drain({ graceMs: 0 });
  assert.strictEqual(first, second);
  await first;
  assert.strictEqual(lifecycle.drain(), first);
  assert.equal(managed.shutdowns, 1);
});

test("unregister uses the session id captured before a fork mutates it", async () => {
  const lifecycle = new ProcessLifecycle(clock().value);
  const managed = session("before-fork");
  const unregister = lifecycle.register(managed);

  managed.sessionId = "after-fork";
  unregister();

  const result = await lifecycle.drain({ graceMs: 0 });
  assert.equal(result.sessionCount, 0);
  assert.equal(managed.shutdowns, 0);
});

test("pending starts can register before the barrier closes", async () => {
  const c = clock();
  const lifecycle = new ProcessLifecycle(c.value);
  const finish = lifecycle.beginSessionStart();
  const late = session("late");
  let added = false;
  c.value.sleep = async () => {
    if (!added) {
      added = true;
      lifecycle.register(late);
      finish();
    }
  };

  const result = await lifecycle.drain({ graceMs: 30_000, pollMs: 100 });
  assert.equal(result.sessionCount, 1);
  assert.equal(late.shutdowns, 1);
});

test("resume is rejected while drain runs and succeeds after drain completes", async () => {
  const lifecycle = new ProcessLifecycle(clock().value);
  const drain = lifecycle.drain({ graceMs: 0 });
  assert.equal(lifecycle.resume(), false);
  await drain;
  assert.equal(lifecycle.resume(), true);
  assert.equal(lifecycle.state, "running");
});

test("dispose errors use the dispose phase", async () => {
  const lifecycle = new ProcessLifecycle(clock().value);
  const dispose = session("dispose");
  dispose.shutdown = async () => { throw new SessionDisposeError(); };
  lifecycle.register(dispose);

  const result = await lifecycle.drain({ graceMs: 0 });
  assert.deepEqual(result.errors, [{ sessionId: "dispose", phase: "dispose" }]);
});
