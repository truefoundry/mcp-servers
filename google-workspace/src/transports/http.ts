/**
 * HTTP transport — mounts one stateless MCP endpoint per service at
 * `/mcp/<service>`. Each POST request gets a fresh
 * StreamableHTTPServerTransport (sessionIdGenerator: undefined) and MCP
 * Server instance so any pod replica can handle any request without sticky
 * sessions or in-memory session state.
 *
 * Per-request Bearer tokens are forwarded by the TFY LLM Gateway.
 */

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { log } from '../auth-ctx.js';
import {
  SERVICE_KEYS,
  VERSION,
  createMcpServer,
  type ServiceKey,
} from '../server.js';

/**
 * Pull `Authorization: Bearer <token>` (if present) into `req.auth` so the
 * MCP SDK forwards it to handlers as `extra.authInfo`. The TrueFoundry LLM
 * Gateway populates this header with the end-user's Google access token.
 */
function attachBearerAuth(req: express.Request): void {
  const headerVal = req.headers['authorization'];
  if (!headerVal) return;
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!raw) return;
  let token = raw.trim();
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  }
  if (!token) return;
  (req as any).auth = { access_token: token, token };
}

function bearerMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
  attachBearerAuth(req);
  next();
}

/**
 * Handle one MCP request with a fresh transport + server. The MCP SDK requires
 * a new stateless transport per request to avoid JSON-RPC message ID collisions.
 */
async function handleStatelessMcpRequest(
  req: express.Request,
  res: express.Response,
  serviceKey: ServiceKey,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createMcpServer({ services: [serviceKey] });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await transport.close().catch((err) => {
      log('Error closing transport', { error: (err as Error).message });
    });
    await server.close().catch((err) => {
      log('Error closing server', { error: (err as Error).message });
    });
  }
}

function mountServiceRoutes(app: express.Express, serviceKey: ServiceKey): void {
  const path = `/mcp/${serviceKey}`;

  app.post(path, bearerMiddleware, async (req, res) => {
    try {
      await handleStatelessMcpRequest(req, res, serviceKey);
    } catch (error) {
      log(`Error handling POST ${path}`, { error: (error as Error).message });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });
}

export interface CreatedHttpApp {
  app: express.Express;
}

export function createHttpApp(): CreatedHttpApp {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'healthy',
      server: 'google-workspace-mcp',
      version: VERSION,
      services: SERVICE_KEYS,
      timestamp: new Date().toISOString(),
    });
  });

  for (const key of SERVICE_KEYS) {
    mountServiceRoutes(app, key);
  }

  return { app };
}

export interface StartHttpTransportArgs {
  httpHost: string;
  httpPort: number;
}

export async function startHttpTransport(args: StartHttpTransportArgs): Promise<void> {
  try {
    const { httpHost, httpPort } = args;
    console.error(
      `Starting Google Workspace MCP server (stateless HTTP on ${httpHost}:${httpPort})...`,
    );
    console.error(
      `Mounted endpoints: ${SERVICE_KEYS.map((k) => `/mcp/${k}`).join(', ')}`,
    );

    const { app } = createHttpApp();

    const httpServer = app.listen(httpPort, httpHost, () => {
      log(`HTTP server listening on ${httpHost}:${httpPort}`);
    });

    const shutdown = async () => {
      log('Shutting down HTTP server...');
      httpServer.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start HTTP server:', error);
    process.exit(1);
  }
}
