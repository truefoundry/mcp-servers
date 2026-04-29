#!/usr/bin/env node
/**
 * Salesforce MCP Server - CLI entry point.
 *
 * Single-process Node service exposing one MCP endpoint at `/mcp`. Per-user
 * OAuth: every request must carry the user's Salesforce access token in
 * `Authorization: Bearer ...`, forwarded by the TFY LLM Gateway.
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
    if (arg === '--transport' && i + 1 < args.length) {
      i++;
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
Salesforce MCP Server v${VERSION}

Usage:
  salesforce-mcp [command] [options]

Commands:
  start    Start the HTTP MCP server (default)
  version  Show version information
  help     Show this help message

Options:
  --port <number>            HTTP listen port (default: 3000)
  --host <address>           HTTP bind address (default: 0.0.0.0)
  --transport <name>         Reserved for future use (only "http" supported today)

HTTP endpoints:
  /health           Liveness/readiness probe
  /mcp              MCP endpoint (POST initialize, GET stream, DELETE close)

Authentication:
  Every request must carry an Authorization: Bearer <salesforce-access-token>
  header. The TrueFoundry LLM Gateway runs the Salesforce OAuth dance
  (Web Server Flow) against your Connected App and forwards the user's
  per-request access token to this server.

Environment Variables:
  SF_LOGIN_URL              Login URL for instance discovery (default: https://login.salesforce.com).
                            Use https://test.salesforce.com for sandboxes or your My Domain URL.
  SF_INSTANCE_URL_HEADER    Optional: header name the gateway uses to forward the
                            user's instance_url. Skips userinfo discovery when present.
                            Default: x-salesforce-instance-url.
  MCP_HTTP_PORT / PORT      HTTP listen port.
  MCP_HTTP_HOST / HOST      HTTP bind address.
`);
}

function showVersion(): void {
  console.log(`Salesforce MCP Server v${VERSION}`);
}

async function main() {
  const args = parseCliArgs();

  switch (args.command) {
    case 'start':
    case undefined:
      await startHttpTransport({ httpHost: args.httpHost, httpPort: args.httpPort });
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
export { createMcpServer } from './server.js';
export { createHttpApp } from './transports/http.js';

if (!process.env.MCP_TESTING) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
