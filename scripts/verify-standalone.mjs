import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

const [releaseDir, home, portText, expectedReleaseId, expectedCommit] = process.argv.slice(2);
if (!releaseDir || !home || !portText || !expectedReleaseId || !expectedCommit) {
  throw new Error("usage: verify-standalone.mjs <release-dir> <home> <port> <release-id> <commit>");
}
const port = Number(portText);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid staging port");

const agentDir = join(home, ".pi", "agent");
const cwd = join(home, "pi-users", "releasecheck");
mkdirSync(join(home, ".pi-web-auth"), { recursive: true });
mkdirSync(agentDir, { recursive: true });
mkdirSync(cwd, { recursive: true });

const modelFixture = {
  providers: {
    "release-test": {
      name: "Release Test",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "release-test-key",
      api: "openai-completions",
      models: [{
        id: "release-test-model",
        name: "Release Test Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      }],
    },
  },
};
const modelsPath = join(agentDir, "models.json");
writeFileSync(modelsPath, `${JSON.stringify(modelFixture, null, 2)}\n`, { mode: 0o600 });

const server = spawn(process.execPath, [join(releaseDir, "server.js")], {
  cwd: releaseDir,
  env: {
    ...process.env,
    HOME: home,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    REGISTER_KEYWORD: "release-check",
    PI_WEB_RELEASE_TOKEN: "staging-release-token",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverError = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => { serverError = `${serverError}${chunk}`.slice(-4096); });

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function jsonRequest(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json().catch(() => null);
  return { status: response.status, body, cookie: response.headers.get("set-cookie") };
}

async function waitForReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await jsonRequest("/api/health/ready");
      if (result.status === 200 && result.body?.releaseId === expectedReleaseId && result.body?.commit === expectedCommit) return;
    } catch {
      // Server is still starting.
    }
    await sleep(250);
  }
  throw new Error("staging ready check failed");
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  const exited = once(server, "exit").then(() => true);
  const timedOut = sleep(5_000).then(() => false);
  if (!(await Promise.race([exited, timedOut]))) {
    server.kill("SIGKILL");
    await once(server, "exit");
    throw new Error("staging server required SIGKILL");
  }
}

let session;
try {
  await waitForReady();
  const registration = await jsonRequest("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword: "release-check", username: "releasecheck", password: "ReleasePass1" }),
  });
  if (registration.status !== 200) throw new Error("staging registration failed");
  const login = await jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "releasecheck", password: "ReleasePass1" }),
  });
  if (login.status !== 200 || !login.cookie) throw new Error("staging login failed");

  const piEntry = join(releaseDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");
  const {
    AuthStorage,
    ModelRegistry,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    createAgentSession,
  } = await import(pathToFileURL(piEntry).href);
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const model = modelRegistry.find("release-test", "release-test-model");
  if (!model || modelRegistry.getError()) throw new Error("staging model registry failed");
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const extensionPath = join(releaseDir, ".pi", "extensions", "z-ai-tools", "index.ts");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionPath],
  });
  await resourceLoader.reload();
  ({ session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    model,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "builtin",
  }));
  if (!session.extensionRunner.getAllRegisteredTools().some((tool) => tool.definition.name.startsWith("zai_"))) {
    throw new Error("staging dynamic extension failed");
  }
  if (session.extensionRunner.hasHandlers("session_shutdown")) {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  }
  session.dispose();
  session = undefined;
} catch (error) {
  const check = error instanceof Error ? error.message : "staging verification failed";
  process.stderr.write(`${check}\n`);
  process.exitCode = 1;
} finally {
  if (session) session.dispose();
  try {
    await stopServer();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "staging shutdown failed"}\n`);
    process.exitCode = 1;
  }
  if (server.exitCode && server.exitCode !== 0 && process.exitCode !== 1) {
    process.stderr.write(`staging server exited unexpectedly (${server.exitCode}); ${serverError ? "stderr captured" : "no stderr"}\n`);
    process.exitCode = 1;
  }
}
