/**
 * Per-service MCP server factory. Each endpoint in the HTTP transport
 * instantiates a Server via `createMcpServer({ services: [key] })` so that
 * ListTools / CallTool only advertise the tools belonging to that service.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import type { drive_v3, calendar_v3 } from 'googleapis';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

import type { ServiceModule, ToolContext } from './types.js';
import { errorResponse } from './types.js';
import { escapeDriveQuery } from './utils.js';
import { log, resolveAuthClientForRequest } from './auth-ctx.js';

import driveService from './services/drive/index.js';
import docsService from './services/docs/index.js';
import sheetsService from './services/sheets/index.js';
import slidesService from './services/slides/index.js';
import calendarService from './services/calendar/index.js';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
export const VERSION = packageJson.version;

// ---------------------------------------------------------------------------
// Service registry
// ---------------------------------------------------------------------------
export const SERVICE_KEYS = ['drive', 'docs', 'sheets', 'slides', 'calendar'] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICES: Record<ServiceKey, ServiceModule> = {
  drive: driveService,
  docs: docsService,
  sheets: sheetsService,
  slides: slidesService,
  calendar: calendarService,
};

// ---------------------------------------------------------------------------
// Per-request ToolContext builder
// ---------------------------------------------------------------------------
export function buildToolContext(authClient: any): ToolContext {
  const getDrive = (): drive_v3.Drive => google.drive({ version: 'v3', auth: authClient });
  const getCalendar = (): calendar_v3.Calendar =>
    google.calendar({ version: 'v3', auth: authClient });

  async function resolvePath(pathStr: string): Promise<string> {
    if (!pathStr || pathStr === '/') return 'root';

    const parts = pathStr.replace(/^\/+|\/+$/g, '').split('/');
    let currentFolderId: string = 'root';

    for (const part of parts) {
      if (!part) continue;
      const escapedPart = escapeDriveQuery(part);
      const response = await getDrive().files.list({
        q: `'${currentFolderId}' in parents and name = '${escapedPart}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });

      if (!response.data.files?.length) {
        const folderMetadata = {
          name: part,
          mimeType: FOLDER_MIME_TYPE,
          parents: [currentFolderId],
        };
        const folder = await getDrive().files.create({
          requestBody: folderMetadata,
          fields: 'id',
          supportsAllDrives: true,
        });

        if (!folder.data.id) {
          throw new Error(`Failed to create intermediate folder: ${part}`);
        }

        currentFolderId = folder.data.id;
      } else {
        currentFolderId = response.data.files[0].id!;
      }
    }

    return currentFolderId;
  }

  async function resolveFolderId(input: string | undefined): Promise<string> {
    if (!input) return 'root';
    if (input.startsWith('/')) return resolvePath(input);
    return input;
  }

  function validateTextFileExtension(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (!['txt', 'md'].includes(ext)) {
      throw new Error('File name must end with .txt or .md for text files.');
    }
  }

  async function checkFileExists(
    name: string,
    parentFolderId: string = 'root',
  ): Promise<string | null> {
    try {
      const escapedName = escapeDriveQuery(name);
      const query = `name = '${escapedName}' and '${parentFolderId}' in parents and trashed = false`;

      const res = await getDrive().files.list({
        q: query,
        fields: 'files(id, name, mimeType)',
        pageSize: 1,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });

      if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id || null;
      }
      return null;
    } catch (error) {
      log('Error checking file existence:', error);
      return null;
    }
  }

  return {
    authClient,
    google,
    getDrive,
    getCalendar,
    log,
    resolvePath,
    resolveFolderId,
    checkFileExists,
    validateTextFileExtension,
  };
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export interface CreateMcpServerOptions {
  /** Service keys this server exposes. Pass a single key for the per-endpoint HTTP mounts. */
  services: ServiceKey[];
}

export function createMcpServer(options: CreateMcpServerOptions): Server {
  const activeServices = options.services.map((k) => SERVICES[k]);
  if (activeServices.length === 0) {
    throw new Error('createMcpServer: at least one service key is required');
  }

  const label =
    activeServices.length === 1
      ? `google-workspace-mcp.${activeServices[0].key}`
      : 'google-workspace-mcp';

  const s = new Server(
    {
      name: label,
      version: VERSION,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  // -------------------------------------------------------------------------
  // Resources: only exposed when the drive service is active.
  // -------------------------------------------------------------------------
  const driveActive = activeServices.some((svc) => svc.key === 'drive');

  if (driveActive) {
    s.setRequestHandler(ListResourcesRequestSchema, async (request, extra) => {
      const authClient = await resolveAuthClientForRequest(extra);
      log('Handling ListResources request', { params: request.params });
      const drive = google.drive({ version: 'v3', auth: authClient });

      const pageSize = 10;
      const params: {
        pageSize: number;
        fields: string;
        pageToken?: string;
        q: string;
        includeItemsFromAllDrives: boolean;
        supportsAllDrives: boolean;
      } = {
        pageSize,
        fields: 'nextPageToken, files(id, name, mimeType)',
        q: 'trashed = false',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      };

      if (request.params?.cursor) {
        params.pageToken = request.params.cursor as string;
      }

      const res = await drive.files.list(params);
      log('Listed files', { count: res.data.files?.length });
      const files = res.data.files || [];

      return {
        resources: files.map((file: drive_v3.Schema$File) => ({
          uri: `gdrive:///${file.id}`,
          mimeType: file.mimeType || 'application/octet-stream',
          name: file.name || 'Untitled',
        })),
        nextCursor: res.data.nextPageToken,
      };
    });

    s.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
      const authClient = await resolveAuthClientForRequest(extra);
      log('Handling ReadResource request', { uri: request.params.uri });
      const drive = google.drive({ version: 'v3', auth: authClient });

      const fileId = request.params.uri.replace('gdrive:///', '');

      const file = await drive.files.get({
        fileId,
        fields: 'mimeType',
        supportsAllDrives: true,
      });
      const mimeType = file.data.mimeType;

      if (!mimeType) {
        throw new Error('File has no MIME type.');
      }

      if (mimeType.startsWith('application/vnd.google-apps')) {
        let exportMimeType: string;
        switch (mimeType) {
          case 'application/vnd.google-apps.document':
            exportMimeType = 'text/markdown';
            break;
          case 'application/vnd.google-apps.spreadsheet':
            exportMimeType = 'text/csv';
            break;
          case 'application/vnd.google-apps.presentation':
            exportMimeType = 'text/plain';
            break;
          case 'application/vnd.google-apps.drawing':
            exportMimeType = 'image/png';
            break;
          default:
            exportMimeType = 'text/plain';
            break;
        }

        const res = await drive.files.export(
          { fileId, mimeType: exportMimeType },
          { responseType: 'text' },
        );

        log('Successfully read resource', { fileId, mimeType });
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: exportMimeType,
              text: res.data as string,
            },
          ],
        };
      }

      const res = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );
      const contentMime = mimeType || 'application/octet-stream';

      if (contentMime.startsWith('text/') || contentMime === 'application/json') {
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: contentMime,
              text: Buffer.from(res.data as ArrayBuffer).toString('utf-8'),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: contentMime,
            blob: Buffer.from(res.data as ArrayBuffer).toString('base64'),
          },
        ],
      };
    });
  }

  // -------------------------------------------------------------------------
  // Tools: only this server's active services contribute tool definitions.
  // -------------------------------------------------------------------------
  s.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: activeServices.flatMap((svc) => svc.toolDefinitions),
    };
  });

  s.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    log('Handling tool request', { tool: request.params.name });

    try {
      const authClient = await resolveAuthClientForRequest(extra);
      const ctx = buildToolContext(authClient);

      for (const svc of activeServices) {
        const result = await svc.handleTool(
          request.params.name,
          request.params.arguments ?? {},
          ctx,
        );
        if (result !== null) return result;
      }
      return errorResponse(
        `Tool '${request.params.name}' is not available on this endpoint`,
      );
    } catch (error) {
      log('Error in tool request handler', { error: (error as Error).message });
      return errorResponse((error as Error).message);
    }
  });

  return s;
}
