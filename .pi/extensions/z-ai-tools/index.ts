import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type McpClientEntry = {
  client: Client;
  transport: { close: () => Promise<void> };
};

const LOCAL_TOOL_PREFIX = "zai_";
const DEFAULT_REMOTE_BASE = "https://open.bigmodel.cn/api/mcp";

function readSettingsApiKey(path: string): string {
  if (!existsSync(path)) return "";
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    for (const key of ["zAiCodingApiKey", "zAiMcpApiKey", "zaiCodingApiKey", "zaiMcpApiKey"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return "";
  }
  return "";
}

function getApiKey(cwd: string): string {
  return process.env.Z_AI_CODING_API_KEY
    || process.env.Z_AI_MCP_API_KEY
    || process.env.Z_AI_API_KEY
    || readSettingsApiKey(join(cwd, ".pi", "settings.json"))
    || readSettingsApiKey(join(homedir(), ".pi", "agent", "settings.json"));
}

function normalizeToolName(serverName: string, toolName: string): string {
  return `${LOCAL_TOOL_PREFIX}${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stringifyResult(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (!item || typeof item !== "object") return String(item ?? "");
      const block = item as Record<string, unknown>;
      if (block.type === "text") return String(block.text ?? "");
      if (block.type === "image") return `[image:${block.mimeType ?? "unknown"}] ${String(block.data ?? "").slice(0, 120)}...`;
      if (block.type === "resource") return JSON.stringify(block.resource ?? block, null, 2);
      return JSON.stringify(block, null, 2);
    }).join("\n\n");
  }
  return JSON.stringify(result, null, 2);
}

async function connectStdio(name: string, command: string, args: string[], env: Record<string, string>): Promise<McpClientEntry> {
  const client = new Client({ name: `pi-web-${name}`, version: "0.1.0" });
  const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } as Record<string, string>, stderr: "pipe" });
  await client.connect(transport);
  return { client, transport };
}

async function connectRemote(name: string, path: string, apiKey: string): Promise<McpClientEntry> {
  const base = (process.env.Z_AI_MCP_BASE_URL || DEFAULT_REMOTE_BASE).replace(/\/$/, "");
  const bearer = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  const headers = { Authorization: bearer };
  const client = new Client({ name: `pi-web-${name}`, version: "0.1.0" });
  const httpUrl = new URL(`${base}/${path}/mcp`);
  httpUrl.searchParams.set("Authorization", apiKey);
  const transport = new StreamableHTTPClientTransport(httpUrl, { requestInit: { headers } });
  try {
    await client.connect(transport);
    return { client, transport };
  } catch {
    await transport.close().catch(() => {});
    const sseClient = new Client({ name: `pi-web-${name}`, version: "0.1.0" });
    const sseUrl = new URL(`${base}/${path}/sse`);
    sseUrl.searchParams.set("Authorization", apiKey);
    const sseTransport = new SSEClientTransport(sseUrl, { requestInit: { headers } });
    await sseClient.connect(sseTransport);
    return { client: sseClient, transport: sseTransport };
  }
}

export default async function zAiTools(pi: ExtensionAPI) {
  let apiKey = "";
  const clients: McpClientEntry[] = [];
  const loadErrors: string[] = [];
  const registeredTools = new Set<string>();

  async function registerMcpServer(serverName: string, entry: McpClientEntry) {
    clients.push(entry);
    const { tools } = await entry.client.listTools();
    for (const tool of tools) {
      const localName = normalizeToolName(serverName, tool.name);
      if (registeredTools.has(localName)) continue;
      registeredTools.add(localName);
      pi.registerTool({
        name: localName,
        label: localName,
        description: `[Z.AI ${serverName}] ${tool.description || tool.name}`,
        promptSnippet: `Call Z.AI ${serverName} MCP tool ${tool.name}`,
        promptGuidelines: [
          `Use ${localName} when the user asks for ${serverName} capability related to ${tool.name}.`,
          `For ${localName}, pass arguments matching the MCP tool schema shown in the tool description when possible.`,
        ],
        parameters: Type.Object({
          arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Arguments forwarded to the underlying MCP tool." })),
        }),
        async execute(_toolCallId, params) {
          const result = await entry.client.callTool({ name: tool.name, arguments: params.arguments ?? {} });
          return {
            content: [{ type: "text", text: stringifyResult(result) }],
            details: { server: serverName, tool: tool.name, result },
          };
        },
      });
    }
  }

  async function tryRegister(name: string, connect: () => Promise<McpClientEntry>) {
    try {
      await registerMcpServer(name, await connect());
    } catch (error) {
      loadErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function registerRemoteProxyTool(serverName: string, path: string, toolName: string, description: string) {
    const localName = normalizeToolName(serverName, toolName);
    if (registeredTools.has(localName)) return;
    registeredTools.add(localName);
    pi.registerTool({
      name: localName,
      label: localName,
      description: `[Z.AI ${serverName}] ${description}`,
      promptSnippet: `Call Z.AI ${serverName} MCP tool ${toolName}`,
      promptGuidelines: [
        `Use ${localName} when the user asks for ${description}.`,
        `For ${localName}, put the underlying MCP tool parameters in the arguments object.`,
      ],
      parameters: Type.Object({
        arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Arguments forwarded to the underlying MCP tool." })),
      }),
      async execute(_toolCallId, params) {
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Z.AI MCP API key is missing. Set Z_AI_API_KEY, ZHIPU_API_KEY, or BIGMODEL_API_KEY before starting pi-web." }],
            details: { server: serverName, tool: toolName, error: "missing_api_key" },
          };
        }

        const entry = await connectRemote(serverName, path, apiKey);
        try {
          const result = await entry.client.callTool({ name: toolName, arguments: params?.arguments ?? {} });
          return {
            content: [{ type: "text", text: stringifyResult(result) }],
            details: { server: serverName, tool: toolName, result },
          };
        } finally {
          await entry.transport.close().catch(() => {});
        }
      },
    });
  }

  function registerStdioProxyTool(serverName: string, toolName: string, description: string) {
    const localName = normalizeToolName(serverName, toolName);
    if (registeredTools.has(localName)) return;
    registeredTools.add(localName);
    pi.registerTool({
      name: localName,
      label: localName,
      description: `[Z.AI ${serverName}] ${description}`,
      promptSnippet: `Call Z.AI ${serverName} MCP tool ${toolName}`,
      promptGuidelines: [
        `Use ${localName} when the user asks for ${description}.`,
        `For ${localName}, put the underlying MCP tool parameters in the arguments object.`,
      ],
      parameters: Type.Object({
        arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Arguments forwarded to the underlying MCP tool." })),
      }),
      async execute(_toolCallId, params) {
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Z.AI Coding Plan API key is missing. Set Z_AI_CODING_API_KEY or zAiCodingApiKey before starting pi-web." }],
            details: { server: serverName, tool: toolName, error: "missing_api_key" },
          };
        }

        const entry = await connectStdio(serverName, "npx", ["-y", "@z_ai/mcp-server"], {
          Z_AI_API_KEY: apiKey,
          Z_AI_MODE: process.env.Z_AI_MODE || "ZHIPU",
        });
        try {
          const result = await entry.client.callTool({ name: toolName, arguments: params?.arguments ?? {} });
          return {
            content: [{ type: "text", text: stringifyResult(result) }],
            details: { server: serverName, tool: toolName, result },
          };
        } finally {
          await entry.transport.close().catch(() => {});
        }
      },
    });
  }

  registerStdioProxyTool("vision", "ui_to_artifact", "convert UI screenshots into frontend code, prompts, design specs, or descriptions");
  registerStdioProxyTool("vision", "extract_text_from_screenshot", "extract text, code, logs, or documentation from screenshots");
  registerStdioProxyTool("vision", "diagnose_error_screenshot", "diagnose error screenshots and suggest fixes");
  registerStdioProxyTool("vision", "understand_technical_diagram", "understand architecture diagrams, flowcharts, UML, ER, and sequence diagrams");
  registerStdioProxyTool("vision", "analyze_data_visualization", "analyze charts and data visualizations");
  registerStdioProxyTool("vision", "ui_diff_check", "compare expected and actual UI screenshots for visual regressions");
  registerStdioProxyTool("vision", "analyze_image", "analyze general images");
  registerStdioProxyTool("vision", "analyze_video", "analyze video content");

  registerRemoteProxyTool("search", "web_search_prime", "webSearchPrime", "search the web for current information");
  registerRemoteProxyTool("reader", "web_reader", "webReader", "read and extract content from a web page URL");
  registerRemoteProxyTool("zread", "zread", "search_doc", "search GitHub repository knowledge and documents");
  registerRemoteProxyTool("zread", "zread", "get_repo_structure", "get a GitHub repository directory structure");
  registerRemoteProxyTool("zread", "zread", "read_file", "read a file from a GitHub repository");

  pi.on("session_start", async (_event, ctx) => {
    apiKey = getApiKey(ctx.cwd);
  });

  apiKey = getApiKey(process.cwd());

  if (apiKey) {
    await tryRegister("search", () => connectRemote("search", "web_search_prime", apiKey));
    await tryRegister("reader", () => connectRemote("reader", "web_reader", apiKey));
    await tryRegister("zread", () => connectRemote("zread", "zread", apiKey));
  }

  pi.registerCommand("z-ai-tools", {
    description: "Show Z.AI MCP-backed tool status",
    handler: async (_args, ctx) => {
      const status = apiKey
        ? `Z.AI tools loaded. Registered MCP clients: ${clients.length}. Tool prefix: ${LOCAL_TOOL_PREFIX}${loadErrors.length ? ` Failed: ${loadErrors.join("; ")}` : ""}`
        : "Z.AI tools not loaded: set Z_AI_API_KEY, ZHIPU_API_KEY, or BIGMODEL_API_KEY before starting pi-web.";
      ctx.ui.notify(status, apiKey ? "info" : "warning");
    },
  });

  pi.on("session_shutdown", async () => {
    await Promise.all(clients.map((entry) => entry.transport.close().catch(() => {})));
  });
}
