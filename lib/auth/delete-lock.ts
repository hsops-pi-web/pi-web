import path from "path";

export type OperationEntry = { cwd: string; done: Promise<unknown> };

export type DeleteWindowAbortError = Error & { deleteWindowCleanup?: true };

export function createDeleteWindowAbortError(cleanupError: unknown): DeleteWindowAbortError {
  const failed = cleanupError !== null;
  const error = new Error(
    failed
      ? `删除窗口清理失败: ${String(cleanupError)}`
      : "用户目录删除中，已清理并放弃会话"
  ) as DeleteWindowAbortError;
  if (failed) error.deleteWindowCleanup = true;
  return error;
}

export function assertSessionCommandAllowed(
  alive: boolean,
  deleting: boolean,
  commandType: string
): void {
  if (!alive) throw new Error("AgentSession 已销毁");
  if (deleting && commandType !== "abort") {
    throw new Error("用户目录正在删除，拒绝会话操作");
  }
}

export interface DeleteLock {
  markRootDeleting(canonicalRoot: string): void;
  unmarkRootDeleting(canonicalRoot: string): void;
  isCwdUnderDeletingRoot(canonicalCwd: string): boolean;
  registerStart(key: string, canonicalCwd: string, done: Promise<unknown>): void;
  unregisterStart(key: string): void;
  waitForStartsUnderRoot(canonicalRoot: string): Promise<void>;
  withStartGuardCanonical<T>(canonicalCwd: string, body: () => Promise<T>): Promise<T>;
  nextKey(prefix: string): string;
}

export function createDeleteLock(): DeleteLock {
  const deletingRoots = new Map<string, number>();
  const operations = new Map<string, OperationEntry>();
  let sequence = 0;

  const under = (root: string, cwd: string) => cwd === root || cwd.startsWith(root + path.sep);
  const isCwdUnderDeletingRoot = (cwd: string) => {
    for (const root of deletingRoots.keys()) {
      if (under(root, cwd)) return true;
    }
    return false;
  };

  const waitForStartsUnderRoot = async (root: string) => {
    const pending: Promise<unknown>[] = [];
    for (const { cwd, done } of operations.values()) {
      if (!under(root, cwd)) continue;
      pending.push(done.catch((error: unknown) => {
        if ((error as DeleteWindowAbortError | null)?.deleteWindowCleanup) throw error;
        return undefined;
      }));
    }
    await Promise.all(pending);
  };

  return {
    markRootDeleting: (root) => {
      deletingRoots.set(root, (deletingRoots.get(root) ?? 0) + 1);
    },
    unmarkRootDeleting: (root) => {
      const count = (deletingRoots.get(root) ?? 0) - 1;
      if (count <= 0) deletingRoots.delete(root);
      else deletingRoots.set(root, count);
    },
    isCwdUnderDeletingRoot,
    registerStart: (key, cwd, done) => operations.set(key, { cwd, done }),
    unregisterStart: (key) => operations.delete(key),
    waitForStartsUnderRoot,
    withStartGuardCanonical: async (cwd, body) => {
      if (isCwdUnderDeletingRoot(cwd)) {
        throw new Error("用户目录正在删除，拒绝创建会话");
      }
      const key = `__guard__${++sequence}`;
      const done = (async () => {
        if (isCwdUnderDeletingRoot(cwd)) {
          throw new Error("用户目录正在删除，拒绝创建会话");
        }
        return body();
      })();
      operations.set(key, { cwd, done });
      try {
        return await done;
      } finally {
        operations.delete(key);
      }
    },
    nextKey: (prefix) => `${prefix}${++sequence}`,
  };
}
