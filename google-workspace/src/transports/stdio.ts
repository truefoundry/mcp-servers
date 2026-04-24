/**
 * Stdio transport — used for local development. Exposes ALL services on one
 * MCP server instance, mirroring the single-process CLI workflow.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { log } from '../auth-ctx.js';
import { SERVICE_KEYS, createMcpServer } from '../server.js';

export async function startStdioTransport(): Promise<void> {
  try {
    console.error('Starting Google Workspace MCP server (stdio, all services)...');
    const server = createMcpServer({ services: [...SERVICE_KEYS] });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('Server started successfully');

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}
