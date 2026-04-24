#!/usr/bin/env node
/**
 * Google Workspace MCP Server — CLI entry point.
 *
 * This is a single Node process that exposes Drive, Docs, Sheets, Slides, and
 * Calendar. HTTP transport mounts one MCP server per service at
 * `/mcp/<service>`; stdio transport exposes all services on one MCP server
 * (local dev).
 */

import { AuthServer, initializeOAuth2Client } from './auth.js';
import { startHttpTransport } from './transports/http.js';
import { startStdioTransport } from './transports/stdio.js';
import { VERSION } from './server.js';

// -----------------------------------------------------------------------------
// CLI ARG PARSING
// -----------------------------------------------------------------------------

interface CliArgs {
  command: string | undefined;
  transport: 'stdio' | 'http';
  httpPort: number;
  httpHost: string;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let command: string | undefined;
  let transport: string | undefined;
  let httpPort: string | undefined;
  let httpHost: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--version' || arg === '-v' || arg === '--help' || arg === '-h') {
      command = arg;
      continue;
    }

    if (arg === '--transport' && i + 1 < args.length) {
      transport = args[++i];
      continue;
    }
    if (arg === '--port' && i + 1 < args.length) {
      httpPort = args[++i];
      continue;
    }
    if (arg === '--host' && i + 1 < args.length) {
      httpHost = args[++i];
      continue;
    }

    if (!command && !arg.startsWith('--')) {
      command = arg;
      continue;
    }
  }

  const resolvedTransport =
    transport || process.env.MCP_TRANSPORT || process.env.TRANSPORT || 'stdio';
  if (resolvedTransport !== 'stdio' && resolvedTransport !== 'http') {
    console.error(
      `Invalid transport: ${resolvedTransport}. Must be "stdio" or "http".`,
    );
    process.exit(1);
  }

  const resolvedPort = parseInt(
    httpPort || process.env.MCP_HTTP_PORT || process.env.PORT || '3000',
    10,
  );
  if (isNaN(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) {
    console.error(
      `Invalid port: ${httpPort || process.env.MCP_HTTP_PORT || process.env.PORT}. Must be 1-65535.`,
    );
    process.exit(1);
  }

  return {
    command,
    transport: resolvedTransport,
    httpPort: resolvedPort,
    httpHost:
      httpHost || process.env.MCP_HTTP_HOST || process.env.HOST || '127.0.0.1',
  };
}

// -----------------------------------------------------------------------------
// HELP / VERSION
// -----------------------------------------------------------------------------

function showHelp(): void {
  console.log(`
Google Workspace MCP Server v${VERSION}

Usage:
  google-workspace-mcp [command] [options]

Commands:
  auth     Run the authentication flow (stdio local dev only)
  start    Start the MCP server (default)
  version  Show version information
  help     Show this help message

Transport Options:
  --transport <stdio|http>   Transport mode (default: stdio)
  --port <number>            HTTP listen port (default: 3000)
  --host <address>           HTTP bind address (default: 127.0.0.1)

HTTP endpoints (when --transport http):
  /health           Liveness/readiness probe
  /mcp/drive        Google Drive tools
  /mcp/docs         Google Docs tools
  /mcp/sheets       Google Sheets tools
  /mcp/slides       Google Slides tools
  /mcp/calendar     Google Calendar tools

Environment Variables:
  GOOGLE_DRIVE_OAUTH_CREDENTIALS        Path to OAuth client JSON (default: /app/gcp.json)
  MCP_TRANSPORT                         Transport mode: stdio or http
  MCP_HTTP_PORT / PORT                  HTTP listen port
  MCP_HTTP_HOST / HOST                  HTTP bind address
`);
}

function showVersion(): void {
  console.log(`Google Workspace MCP Server v${VERSION}`);
}

async function runAuthServer(): Promise<void> {
  try {
    const oauth2Client = await initializeOAuth2Client();
    const authServerInstance = new AuthServer(oauth2Client);
    const success = await authServerInstance.start(true);

    if (!success && !authServerInstance.authCompletedSuccessfully) {
      const { start, end } = authServerInstance.portRange;
      console.error(
        `Authentication failed. Could not start server or validate existing tokens. Check port availability (${start}-${end}) and try again.`,
      );
      process.exit(1);
    } else if (authServerInstance.authCompletedSuccessfully) {
      console.log('Authentication successful.');
      process.exit(0);
    }

    console.log(
      'Authentication server started. Please complete the authentication in your browser...',
    );

    const intervalId = setInterval(async () => {
      if (authServerInstance.authCompletedSuccessfully) {
        clearInterval(intervalId);
        await authServerInstance.stop();
        console.log('Authentication completed successfully!');
        process.exit(0);
      }
    }, 1000);
  } catch (error) {
    console.error('Authentication failed:', error);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs();

  switch (args.command) {
    case 'auth':
      await runAuthServer();
      break;
    case 'start':
    case undefined:
      if (args.transport === 'http') {
        await startHttpTransport({
          httpHost: args.httpHost,
          httpPort: args.httpPort,
        });
      } else {
        await startStdioTransport();
      }
      break;
    case 'version':
    case '--version':
    case '-v':
      showVersion();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      showHelp();
      process.exit(1);
  }
}

export { main };
export { _setAuthClientForTesting } from './auth-ctx.js';
export { createMcpServer, SERVICES, SERVICE_KEYS } from './server.js';
export { createHttpApp } from './transports/http.js';

// Run the CLI (skip when imported by tests)
if (!process.env.MCP_TESTING) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
