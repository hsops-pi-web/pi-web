#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const https = require("https");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const next = require("next");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

const { values: cliArgs } = parseArgs({
  options: {
    port:     { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
    "https-key":  { type: "string" },
    "https-cert": { type: "string" },
  },
  strict: false,
});

const port     = cliArgs.port     ?? process.env.PORT     ?? "8000";
const hostname = cliArgs.hostname ?? process.env.HOSTNAME ?? null;
const httpsKey = cliArgs["https-key"] ?? process.env.PI_WEB_HTTPS_KEY ?? null;
const httpsCert = cliArgs["https-cert"] ?? process.env.PI_WEB_HTTPS_CERT ?? null;
const dev = process.env.NODE_ENV !== "production";
const useHttps = Boolean(httpsKey && httpsCert);

if (!dev && !fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const url = `${useHttps ? "https" : "http"}://${hostname ?? "localhost"}:${port}`;
const app = next({ dev, dir: pkgDir, hostname: hostname ?? undefined, port: Number(port) });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const requestListener = (req, res) => {
    handle(req, res).catch((error) => {
      console.error(error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  };

  const server = useHttps
    ? https.createServer({ key: fs.readFileSync(httpsKey), cert: fs.readFileSync(httpsCert) }, requestListener)
    : http.createServer(requestListener);

  server.listen(Number(port), hostname ?? undefined, () => {
    console.log(`▲ Next.js ${dev ? "dev" : "production"}`);
    console.log(`- Local:         ${url}`);
    if (hostname) console.log(`- Network:       ${useHttps ? "https" : "http"}://${hostname}:${port}`);
    console.log("✓ Ready");
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
