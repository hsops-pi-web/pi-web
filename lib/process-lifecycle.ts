export type ProcessState = "running" | "draining" | "shutting_down";
export type DrainErrorPhase = "pending_start" | "abort" | "session_shutdown" | "dispose";

export interface DrainResult {
  state: "shutting_down";
  sessionCount: number;
  initiallyStreaming: number;
  naturallyCompleted: number;
  aborted: number;
  errors: Array<{ sessionId: string; phase: DrainErrorPhase }>;
  elapsedMs: number;
}

export interface DrainableSession {
  sessionId: string;
  isStreaming(): boolean;
  abortForShutdown(): Promise<void>;
  shutdown(reason: "quit"): Promise<void>;
}

export interface LifecycleClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

interface ShutdownSession {
  extensionRunner: {
    hasHandlers(eventType: string): boolean;
    emit(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown>;
  };
  dispose(): void;
}

export class ProcessDrainingError extends Error {
  constructor() {
    super("服务正在发布，请稍后重试");
    this.name = "ProcessDrainingError";
  }
}

export class SessionDisposeError extends Error {
  constructor() {
    super("AgentSession dispose failed");
    this.name = "SessionDisposeError";
  }
}

export async function shutdownAgentSession(inner: ShutdownSession): Promise<void> {
  let shutdownError: unknown = null;
  try {
    if (inner.extensionRunner.hasHandlers("session_shutdown")) {
      await inner.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    }
  } catch (error) {
    shutdownError = error;
  }

  try {
    inner.dispose();
  } catch {
    throw new SessionDisposeError();
  }

  if (shutdownError) throw shutdownError;
}

export async function abortAndShutdownSession(session: DrainableSession): Promise<void> {
  let abortError: unknown = null;
  try {
    await session.abortForShutdown();
  } catch (error) {
    abortError = error;
  }

  await session.shutdown("quit");
  if (abortError) throw abortError;
}

const defaultClock: LifecycleClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class ProcessLifecycle {
  state: ProcessState = "running";
  private readonly sessions = new Map<string, DrainableSession>();
  private pendingStarts = 0;
  private drainPromise: Promise<DrainResult> | null = null;
  private lastResult: DrainResult | null = null;
  private readonly clock: LifecycleClock;

  constructor(clock: LifecycleClock = defaultClock) {
    this.clock = clock;
  }

  agentAdmission():
    | { allowed: true }
    | { allowed: false; status: 503; retryAfter: "5"; error: string } {
    return this.state === "running"
      ? { allowed: true }
      : { allowed: false, status: 503, retryAfter: "5", error: "服务正在发布，请稍后重试" };
  }

  assertAcceptingAgentCommands(): void {
    if (this.state !== "running") throw new ProcessDrainingError();
  }

  beginSessionStart(): () => void {
    this.assertAcceptingAgentCommands();
    this.pendingStarts += 1;
    let finished = false;
    return () => {
      if (!finished) {
        finished = true;
        this.pendingStarts -= 1;
      }
    };
  }

  register(session: DrainableSession): () => void {
    const sessionId = session.sessionId;
    this.sessions.set(sessionId, session);
    return () => {
      if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
    };
  }

  drain(options: { graceMs?: number; pollMs?: number } = {}): Promise<DrainResult> {
    if (this.drainPromise) return this.drainPromise;
    const graceMs = options.graceMs ?? 30_000;
    const pollMs = options.pollMs ?? 100;
    this.state = "draining";
    this.drainPromise = Promise.resolve().then(() => this.runDrain(graceMs, pollMs));
    return this.drainPromise;
  }

  private async runDrain(graceMs: number, pollMs: number): Promise<DrainResult> {
    const startedAt = this.clock.now();
    const deadline = startedAt + graceMs;
    const errors: DrainResult["errors"] = [];
    while (this.pendingStarts > 0 && this.clock.now() < deadline) {
      await this.clock.sleep(Math.min(pollMs, deadline - this.clock.now()));
    }
    if (this.pendingStarts > 0) errors.push({ sessionId: "pending-starts", phase: "pending_start" });

    const sessions = [...this.sessions.values()];
    const initiallyStreaming = sessions.filter((session) => session.isStreaming()).length;
    while (sessions.some((session) => session.isStreaming()) && this.clock.now() < deadline) {
      await this.clock.sleep(Math.min(pollMs, deadline - this.clock.now()));
    }
    const stillStreaming = sessions.filter((session) => session.isStreaming());
    let aborted = 0;
    for (const session of stillStreaming) {
      try { await session.abortForShutdown(); aborted += 1; }
      catch { errors.push({ sessionId: session.sessionId, phase: "abort" }); }
    }
    for (const session of sessions) {
      try { await session.shutdown("quit"); }
      catch (error) {
        errors.push({ sessionId: session.sessionId, phase: error instanceof SessionDisposeError ? "dispose" : "session_shutdown" });
      }
    }
    this.state = "shutting_down";
    const result: DrainResult = {
      state: "shutting_down", sessionCount: sessions.length, initiallyStreaming,
      naturallyCompleted: initiallyStreaming - stillStreaming.length, aborted, errors,
      elapsedMs: Math.round(this.clock.now() - startedAt),
    };
    this.lastResult = result;
    return result;
  }

  resume(): boolean {
    if (this.state === "running") return true;
    if (!this.lastResult) return false;
    this.state = "running";
    this.drainPromise = null;
    this.lastResult = null;
    return true;
  }
}

declare global {
  var __piProcessLifecycle: ProcessLifecycle | undefined;
  var __piProcessSignalsInstalled: boolean | undefined;
}

export function getProcessLifecycle(): ProcessLifecycle {
  return (globalThis.__piProcessLifecycle ??= new ProcessLifecycle());
}

export function installProcessSignalHandlers(exit: (code: number) => never = process.exit): void {
  if (globalThis.__piProcessSignalsInstalled) return;
  globalThis.__piProcessSignalsInstalled = true;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    if (stopping) return;
    stopping = getProcessLifecycle().drain().then(() => exit(0), () => exit(1));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
