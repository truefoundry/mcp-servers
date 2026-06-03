/**
 * Microsoft 365 MCP server.
 *
 * Exposes Graph-backed search tools over the MCP Streamable HTTP transport.
 * Each request must carry an OAuth bearer token in the Authorization header;
 * that token is passed straight through to Microsoft Graph. The server is
 * stateless — a fresh McpServer + transport is built per request so tokens
 * never leak between callers.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index.js";

const PORT = Number(process.env.PORT) || 3000;

/** Pull the raw token out of an "Authorization: Bearer <token>" header. */
function extractBearer(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header || typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** JSON-RPC error envelope helper. */
function rpcError(res, status, code, message, id = null) {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id,
  });
}

const app = express();
// Base64 inflates payloads ~33%, so a 4 MB file (the simple-upload cap) needs
// headroom above 4 MB of JSON. Keep this above MAX_TRANSFER_BYTES * 1.34.
app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "8mb" }));

// Health check — no auth required.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "m365-mcp-server", time: new Date().toISOString() });
});

// Main MCP endpoint. Stateless: build server + transport per request.
app.post("/mcp", async (req, res) => {
  const token = extractBearer(req);
  if (!token) {
    return rpcError(
      res,
      401,
      -32001,
      "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
      req.body?.id ?? null,
    );
  }

  const server = new McpServer({
    name: "m365-mcp-server",
    version: "1.0.0",
  });
  registerTools(server, token);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      rpcError(res, 500, -32603, "Internal server error", req.body?.id ?? null);
    }
  }
});

// Streamable HTTP also defines GET (server->client stream) and DELETE
// (session teardown). In stateless mode we don't keep sessions, so reject.
const methodNotAllowed = (_req, res) => {
  rpcError(res, 405, -32000, "Method not allowed. Use POST /mcp.");
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const httpServer = app.listen(PORT, () => {
  console.log(`m365-mcp-server listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint:   POST http://localhost:${PORT}/mcp`);
  console.log(`  Health check:   GET  http://localhost:${PORT}/health`);
});

// Graceful shutdown for Kubernetes rollouts: stop accepting new connections and
// let in-flight requests drain, with a hard timeout as a safety net.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  httpServer.close((err) => {
    if (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
