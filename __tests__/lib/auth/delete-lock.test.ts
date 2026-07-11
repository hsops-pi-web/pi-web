import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDeleteLock,
  createDeleteWindowAbortError,
  assertSessionCommandAllowed,
} from "../../../lib/auth/delete-lock.ts";

const ROOT = "/home/hsops/pi-users/alice";

test("delete root locks are reference counted", () => {
  const lock = createDeleteLock();
  lock.markRootDeleting(ROOT);
  lock.markRootDeleting(ROOT);
  assert.equal(lock.isCwdUnderDeletingRoot(`${ROOT}/proj`), true);
  lock.unmarkRootDeleting(ROOT);
  assert.equal(lock.isCwdUnderDeletingRoot(`${ROOT}/proj`), true);
  lock.unmarkRootDeleting(ROOT);
  assert.equal(lock.isCwdUnderDeletingRoot(`${ROOT}/proj`), false);
});

test("delete root checks path boundaries", () => {
  const lock = createDeleteLock();
  lock.markRootDeleting(ROOT);
  assert.equal(lock.isCwdUnderDeletingRoot(ROOT), true);
  assert.equal(lock.isCwdUnderDeletingRoot(`${ROOT}/proj`), true);
  assert.equal(lock.isCwdUnderDeletingRoot(`${ROOT}2/proj`), false);
});

test("wait holds until matching operation settles", async () => {
  const lock = createDeleteLock();
  let release!: () => void;
  const operation = new Promise<void>((resolve) => { release = resolve; });
  lock.registerStart("matching", `${ROOT}/p1`, operation);
  lock.registerStart("other", "/home/hsops/pi-users/bob/p", Promise.resolve());
  let done = false;
  const waiting = lock.waitForStartsUnderRoot(ROOT).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  release();
  lock.unregisterStart("matching");
  await waiting;
  assert.equal(done, true);
});

test("ordinary operation failure does not block deletion", async () => {
  const lock = createDeleteLock();
  lock.registerStart("failed", `${ROOT}/p1`, Promise.reject(new Error("start failed")));
  await assert.doesNotReject(lock.waitForStartsUnderRoot(ROOT));
});

test("delete-window cleanup failure propagates", async () => {
  const lock = createDeleteLock();
  const error = Object.assign(new Error("cleanup failed"), { deleteWindowCleanup: true });
  lock.registerStart("failed-cleanup", `${ROOT}/p1`, Promise.reject(error));
  await assert.rejects(lock.waitForStartsUnderRoot(ROOT), /cleanup failed/);
});

test("delete-window error only marks cleanup failures", () => {
  const cleaned = createDeleteWindowAbortError(null);
  assert.equal(cleaned.deleteWindowCleanup, undefined);
  assert.match(cleaned.message, /已清理并放弃/);
  const failed = createDeleteWindowAbortError(new Error("rm failed"));
  assert.equal(failed.deleteWindowCleanup, true);
  assert.match(failed.message, /清理失败/);
});

test("guarded operation is awaited by deletion", async () => {
  const lock = createDeleteLock();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let bodyDone = false;
  const guarded = lock.withStartGuardCanonical(`${ROOT}/proj`, async () => {
    await gate;
    bodyDone = true;
    return "ok";
  });
  await Promise.resolve();
  lock.markRootDeleting(ROOT);
  let waitDone = false;
  const waiting = lock.waitForStartsUnderRoot(ROOT).then(() => { waitDone = true; });
  await Promise.resolve();
  assert.equal(waitDone, false);
  assert.equal(bodyDone, false);
  release();
  assert.equal(await guarded, "ok");
  await waiting;
  assert.equal(waitDone, true);
});

test("guard rejects operations after deletion is marked", async () => {
  const lock = createDeleteLock();
  lock.markRootDeleting(ROOT);
  await assert.rejects(lock.withStartGuardCanonical(`${ROOT}/proj`, async () => "late"), /正在删除/);
  lock.unmarkRootDeleting(ROOT);
  assert.equal(await lock.withStartGuardCanonical(`${ROOT}/proj`, async () => "ok"), "ok");
});

test("cleanup failure inside guard reaches deletion waiter", async () => {
  const lock = createDeleteLock();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const error = Object.assign(new Error("window cleanup failed"), { deleteWindowCleanup: true });
  const guarded = lock.withStartGuardCanonical(`${ROOT}/proj`, async () => {
    await gate;
    throw error;
  }).catch(() => undefined);
  await Promise.resolve();
  lock.markRootDeleting(ROOT);
  const waiting = assert.rejects(lock.waitForStartsUnderRoot(ROOT), /window cleanup failed/);
  release();
  await guarded;
  await waiting;
});

test("existing-session command guard covers wait and late rejection", async () => {
  const lock = createDeleteLock();
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const command = lock.withStartGuardCanonical(`${ROOT}/proj`, async () => {
    entered();
    await gate;
    return "sent";
  });
  await enteredPromise;
  lock.markRootDeleting(ROOT);
  let waitDone = false;
  const waiting = lock.waitForStartsUnderRoot(ROOT).then(() => { waitDone = true; });
  await Promise.resolve();
  assert.equal(waitDone, false);
  await assert.rejects(lock.withStartGuardCanonical(`${ROOT}/proj`, async () => "late"), /正在删除/);
  release();
  assert.equal(await command, "sent");
  await waiting;
});

test("session command rule rejects destroyed and allows abort during deletion", () => {
  assert.throws(() => assertSessionCommandAllowed(false, false, "prompt"), /已销毁/);
  assert.throws(() => assertSessionCommandAllowed(true, true, "prompt"), /正在删除/);
  assert.doesNotThrow(() => assertSessionCommandAllowed(true, true, "abort"));
  assert.doesNotThrow(() => assertSessionCommandAllowed(true, false, "prompt"));
});
