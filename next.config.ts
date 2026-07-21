import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/*": [
      ".pi/extensions/**/*",
      "node_modules/ajv/**/*",
      "node_modules/ajv-formats/**/*",
      "node_modules/@modelcontextprotocol/sdk/**/*",
      "node_modules/@z_ai/mcp-server/**/*",
      "node_modules/typebox/**/*",
      "node_modules/zod/**/*",
    ],
  },
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "better-sqlite3",
  ],
  allowedDevOrigins: process.env.PI_WEB_ALLOWED_DEV_ORIGINS
    ? process.env.PI_WEB_ALLOWED_DEV_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
