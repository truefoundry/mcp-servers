/**
 * HTTP transport — mounts one StreamableHTTPServerTransport per service at
 * `/mcp/<service>`. Each mount exposes only its service's tools (via the
 * server factory) but shares a single Express app, one /health endpoint, and
 * one gcp.json OAuth client config.
 *
 * Session management is per-mount: each mount has its own map of session IDs
 * → transport+server pairs, keyed off the `mcp-session-id` header.
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { log, getClientCreds } from '../auth-ctx.js';
import {
  SERVICE_KEYS,
  SERVICES,
  VERSION,
  createMcpServer,
  type ServiceKey,
} from '../server.js';

interface HttpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

interface MountState {
  sessions: Map<string, HttpSession>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

function makeMountState(): MountState {
  return { sessions: new Map(), timers: new Map() };
}

function resetSessionTimer(
  state: MountState,
  sid: string,
  idleTimeoutMs: number,
): void {
  const existing = state.timers.get(sid);
  if (existing) clearTimeout(existing);
  state.timers.set(
    sid,
    setTimeout(async () => {
      const session = state.sessions.get(sid);
      if (session) {
        log(`Session idle timeout: ${sid}`);
        await session.transport.close();
        await session.server.close();
        state.sessions.delete(sid);
      }
      state.timers.delete(sid);
    }, idleTimeoutMs),
  );
}

function clearSessionTimer(state: MountState, sid: string): void {
  const timer = state.timers.get(sid);
  if (timer) {
    clearTimeout(timer);
    state.timers.delete(sid);
  }
}

function mountServiceRoutes(
  app: express.Express,
  serviceKey: ServiceKey,
  idleTimeoutMs: number,
): MountState {
  const state = makeMountState();
  const path = `/mcp/${serviceKey}`;
  const service = SERVICES[serviceKey];

  app.post(path, bearerMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && state.sessions.has(sessionId)) {
        const session = state.sessions.get(sessionId)!;
        resetSessionTimer(state, sessionId, idleTimeoutMs);
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Bad Request: expected initialize request or valid session ID',
          },
          id: null,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const sessionServer = createMcpServer({ services: [serviceKey] });
      await sessionServer.connect(transport);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          clearSessionTimer(state, sid);
          state.sessions.delete(sid);
          log(`Session closed (${service.key}): ${sid}`);
        }
      };

      await transport.handleRequest(req, res, req.body);

      const sid = transport.sessionId;
      if (sid) {
        state.sessions.set(sid, { transport, server: sessionServer });
        resetSessionTimer(state, sid, idleTimeoutMs);
        log(`New session (${service.key}): ${sid}`);
      }
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

  app.get(path, bearerMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !state.sessions.has(sessionId)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Bad Request: missing or invalid session ID' },
          id: null,
        });
        return;
      }
      const session = state.sessions.get(sessionId)!;
      resetSessionTimer(state, sessionId, idleTimeoutMs);
      await session.transport.handleRequest(req, res);
    } catch (error) {
      log(`Error handling GET ${path}`, { error: (error as Error).message });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.delete(path, bearerMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !state.sessions.has(sessionId)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Bad Request: missing or invalid session ID' },
          id: null,
        });
        return;
      }
      const session = state.sessions.get(sessionId)!;
      await session.transport.close();
      await session.server.close();
      state.sessions.delete(sessionId);
      res.status(200).end();
    } catch (error) {
      log(`Error handling DELETE ${path}`, { error: (error as Error).message });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  return state;
}

export interface CreateHttpAppOptions {
  sessionIdleTimeoutMs?: number;
}

export interface CreatedHttpApp {
  app: express.Express;
  /** Per-service mount state, keyed by service key. */
  states: Record<ServiceKey, MountState>;
}

export function createHttpApp(options?: CreateHttpAppOptions): CreatedHttpApp {
  const idleTimeoutMs = options?.sessionIdleTimeoutMs ?? SESSION_IDLE_TIMEOUT_MS;
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

  const states = {} as Record<ServiceKey, MountState>;
  for (const key of SERVICE_KEYS) {
    states[key] = mountServiceRoutes(app, key, idleTimeoutMs);
  }

  return { app, states };
}

export interface StartHttpTransportArgs {
  httpHost: string;
  httpPort: number;
}

export async function startHttpTransport(args: StartHttpTransportArgs): Promise<void> {
  try {
    const { httpHost, httpPort } = args;
    console.error(
      `Starting Google Workspace MCP server (HTTP on ${httpHost}:${httpPort})...`,
    );
    console.error(
      `Mounted endpoints: ${SERVICE_KEYS.map((k) => `/mcp/${k}`).join(', ')}`,
    );

    // Pre-load OAuth client credentials so startup failure surfaces early.
    try {
      await getClientCreds();
    } catch (err) {
      console.error(
        'Warning: OAuth client credentials not loaded at startup; per-request auth will fail until they are available.',
        err,
      );
    }

    const { app, states } = createHttpApp();

    const httpServer = app.listen(httpPort, httpHost, () => {
      log(`HTTP server listening on ${httpHost}:${httpPort}`);
    });

    const shutdown = async () => {
      log('Shutting down HTTP server...');
      for (const key of SERVICE_KEYS) {
        const state = states[key];
        for (const [sid, session] of state.sessions) {
          await session.transport.close();
          await session.server.close();
          state.sessions.delete(sid);
        }
      }
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
