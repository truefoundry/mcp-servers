#!/usr/bin/env node
/**
 * Google Workspace MCP Server — CLI entry point.
 *
 * A single Node process that exposes Drive, Docs, Sheets, Slides, and Calendar
 * over HTTP, with one MCP server mounted per service at `/mcp/<service>`.
 *
 * Authentication is multi-tenant: the per-user Google access token must arrive
 * on the Authorization header (forwarded by the TFY LLM Gateway). There is no
 * local interactive OAuth flow — credentials are managed by the gateway.
 */

import { startHttpTransport } from './transports/http.js';
import { VERSION } from './server.js';

interface CliArgs {
  command: string | undefined;
  httpPort: number;
  httpHost: string;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let command: string | undefined;
  let httpPort: string | undefined;
  let httpHost: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--version' || arg === '-v' || arg === '--help' || arg === '-h') {
      command = arg;
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
    httpPort: resolvedPort,
    httpHost: httpHost || process.env.MCP_HTTP_HOST || process.env.HOST || '0.0.0.0',
  };
}

function showHelp(): void {
  console.log(`
Google Workspace MCP Server v${VERSION}

Usage:
  google-workspace-mcp [command] [options]

Commands:
  start    Start the HTTP MCP server (default)
  version  Show version information
  help     Show this help message

Options:
  --port <number>            HTTP listen port (default: 3000)
  --host <address>           HTTP bind address (default: 0.0.0.0)

HTTP endpoints:
  /health           Liveness/readiness probe
  /mcp/drive        Google Drive tools
  /mcp/docs         Google Docs tools
  /mcp/sheets       Google Sheets tools
  /mcp/slides       Google Slides tools
  /mcp/calendar     Google Calendar tools

Authentication:
  Each request must carry an Authorization: Bearer <google-access-token>
  header. The TrueFoundry LLM Gateway handles the OAuth flow with Google
  and forwards the per-user token to this server.

Environment Variables:
  GOOGLE_DRIVE_OAUTH_CREDENTIALS   Path to OAuth client JSON (default: /app/gcp.json)
  MCP_HTTP_PORT / PORT             HTTP listen port
  MCP_HTTP_HOST / HOST             HTTP bind address
`);
}

function showVersion(): void {
  console.log(`Google Workspace MCP Server v${VERSION}`);
}

async function main() {
  const args = parseCliArgs();

  switch (args.command) {
    case 'start':
    case undefined:
      await startHttpTransport({
        httpHost: args.httpHost,
        httpPort: args.httpPort,
      });
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
export { createMcpServer, SERVICES, SERVICE_KEYS } from './server.js';
export { createHttpApp } from './transports/http.js';

if (!process.env.MCP_TESTING) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
