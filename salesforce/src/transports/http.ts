/**
 * HTTP transport - mounts a single StreamableHTTPServerTransport at `/mcp`.
 *
 * Per request:
 *   1. Extract the bearer token from `Authorization`.
 *   2. Resolve the user's Salesforce instance URL (LRU-cached userinfo lookup,
 *      or honor the `SF_INSTANCE_URL_HEADER` if set).
 *   3. Enter an AsyncLocalStorage scope holding `{accessToken, instanceUrl}`
 *      so the SOQL tool handler can build a `jsforce.Connection` without
 *      threading those values through tool signatures.
 *
 * Session management mirrors the Google Workspace MCP: each `mcp-session-id`
 * gets its own `{transport, server}` pair, GC'd after 30 min idle.
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  log,
  requestContext,
  extractBearerToken,
  type RequestAuthContext,
} from '../auth-ctx.js';
import { resolveInstanceUrl } from '../auth/instance-url.js';
import { createMcpServer, VERSION } from '../server.js';

interface HttpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

interface MountState {
  sessions: Map<string, HttpSession>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const INSTANCE_URL_HEADER = (
  process.env.SF_INSTANCE_URL_HEADER ?? 'x-salesforce-instance-url'
).toLowerCase();

function makeMountState(): MountState {
  return { sessions: new Map(), timers: new Map() };
}

function resetSessionTimer(state: MountState, sid: string, idleTimeoutMs: number): void {
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

/**
 * Build the per-request auth context (bearer + instance URL) and run `fn`
 * inside the AsyncLocalStorage scope so downstream handlers can read it.
 *
 * Returns `null` and writes a JSON-RPC error response if the bearer is
 * missing or the instance URL can't be resolved.
 */
async function withAuthContext(
  req: express.Request,
  res: express.Response,
  fn: () => Promise<void>,
): Promise<void> {
  const token = extractBearerToken(req.headers['authorization']);
  if (!token) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message:
          'Missing Authorization: Bearer header. The TFY LLM Gateway must forward the user Salesforce access token.',
      },
      id: null,
    });
    return;
  }

  const headerOverride = req.headers[INSTANCE_URL_HEADER];
  const headerVal = Array.isArray(headerOverride) ? headerOverride[0] : headerOverride;

  let ctx: RequestAuthContext;
  try {
    const instanceUrl = await resolveInstanceUrl(token, headerVal ?? null);
    ctx = { accessToken: token, instanceUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log('Failed to resolve Salesforce instance URL', { error: message });
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: `Auth resolution failed: ${message}` },
      id: null,
    });
    return;
  }

  await requestContext.run(ctx, fn);
}

function mountMcpRoutes(app: express.Express, idleTimeoutMs: number): MountState {
  const state = makeMountState();
  const path = '/mcp';

  app.post(path, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && state.sessions.has(sessionId)) {
        const session = state.sessions.get(sessionId)!;
        resetSessionTimer(state, sessionId, idleTimeoutMs);
        await withAuthContext(req, res, () =>
          session.transport.handleRequest(req, res, req.body),
        );
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
      const sessionServer = createMcpServer();
      await sessionServer.connect(transport);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          clearSessionTimer(state, sid);
          state.sessions.delete(sid);
          log(`Session closed: ${sid}`);
        }
      };

      await withAuthContext(req, res, () =>
        transport.handleRequest(req, res, req.body),
      );

      const sid = transport.sessionId;
      if (sid) {
        state.sessions.set(sid, { transport, server: sessionServer });
        resetSessionTimer(state, sid, idleTimeoutMs);
        log(`New session: ${sid}`);
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

  app.get(path, async (req, res) => {
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
      await withAuthContext(req, res, () =>
        session.transport.handleRequest(req, res),
      );
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

  app.delete(path, async (req, res) => {
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
  state: MountState;
}

export function createHttpApp(options?: CreateHttpAppOptions): CreatedHttpApp {
  const idleTimeoutMs = options?.sessionIdleTimeoutMs ?? SESSION_IDLE_TIMEOUT_MS;
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'healthy',
      server: 'salesforce-mcp',
      version: VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  const state = mountMcpRoutes(app, idleTimeoutMs);
  return { app, state };
}

export interface StartHttpTransportArgs {
  httpHost: string;
  httpPort: number;
}

export async function startHttpTransport(args: StartHttpTransportArgs): Promise<void> {
  try {
    const { httpHost, httpPort } = args;
    console.error(`Starting Salesforce MCP server (HTTP on ${httpHost}:${httpPort})...`);
    console.error('Mounted endpoint: /mcp');

    const { app, state } = createHttpApp();

    const httpServer = app.listen(httpPort, httpHost, () => {
      log(`HTTP server listening on ${httpHost}:${httpPort}`);
    });

    const shutdown = async () => {
      log('Shutting down HTTP server...');
      for (const [sid, session] of state.sessions) {
        await session.transport.close();
        await session.server.close();
        state.sessions.delete(sid);
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
