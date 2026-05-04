import type { drive_v3, calendar_v3, gmail_v1 } from 'googleapis';
import type { google as GoogleApisType } from 'googleapis';

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * MCP tool behavior annotations (see MCP spec 2025-06-18 server/tools).
 * All hints are best-effort signals to clients; they are NOT enforced by the server.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

export interface ToolContext {
  authClient: any;
  google: typeof GoogleApisType;
  getDrive: () => drive_v3.Drive;
  getCalendar: () => calendar_v3.Calendar;
  getGmail: () => gmail_v1.Gmail;
  log: (message: string, data?: any) => void;
  resolvePath: (pathStr: string) => Promise<string>;
  resolveFolderId: (input: string | undefined) => Promise<string>;
  checkFileExists: (name: string, parentFolderId?: string) => Promise<string | null>;
  validateTextFileExtension: (name: string) => void;
}

export function errorResponse(message: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * A domain module is a cohesive slice of tools for one Google Workspace service.
 * Each MCP endpoint (e.g. /mcp/drive) advertises the toolDefinitions of exactly
 * one ServiceModule.
 */
export interface ServiceModule {
  /** Unique service key (matches the URL segment, e.g. 'drive'). */
  key: string;
  /** Human-readable service name for logs. */
  displayName: string;
  /** Tools this service exposes, with annotations applied. */
  toolDefinitions: ToolDefinition[];
  /** Dispatches a tool call. Returns null if `name` is not in this service. */
  handleTool: (
    name: string,
    args: Record<string, any>,
    ctx: ToolContext,
  ) => Promise<ToolResult | null>;
}
