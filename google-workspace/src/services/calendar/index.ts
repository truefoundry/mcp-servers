/**
 * Calendar service — adapts the richer google-calendar-mcp handler set
 * (class-based BaseToolHandler) to this repo's functional ToolContext /
 * handleTool / toolDefinitions pattern.
 */
import type { OAuth2Client } from 'google-auth-library';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type {
  ServiceModule,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from '../../types.js';
import { errorResponse } from '../../types.js';
import { annotateAll } from '../../annotations.js';

import { ToolSchemas } from './schemas/inputs.js';
import { BaseToolHandler } from './handlers/core/BaseToolHandler.js';
import { ListCalendarsHandler } from './handlers/core/ListCalendarsHandler.js';
import { ListEventsHandler } from './handlers/core/ListEventsHandler.js';
import { SearchEventsHandler } from './handlers/core/SearchEventsHandler.js';
import { ListColorsHandler } from './handlers/core/ListColorsHandler.js';
import { CreateEventHandler } from './handlers/core/CreateEventHandler.js';
import { UpdateEventHandler } from './handlers/core/UpdateEventHandler.js';
import { DeleteEventHandler } from './handlers/core/DeleteEventHandler.js';
import { FreeBusyEventHandler } from './handlers/core/FreeBusyEventHandler.js';
import { GetCurrentTimeHandler } from './handlers/core/GetCurrentTimeHandler.js';

type HandlerCtor = new () => BaseToolHandler;

interface CalendarToolEntry {
  name: keyof typeof ToolSchemas;
  description: string;
  handler: HandlerCtor;
  /**
   * Optional pre-processor. Mirrors the `handlerFunction` hook in the upstream
   * registry (used by list-events to parse stringified calendar-id arrays).
   */
  preprocess?: (args: any) => Promise<any>;
}

// -----------------------------------------------------------------------------
// list-events calendar-id preprocessor (ported verbatim from upstream registry)
// -----------------------------------------------------------------------------
async function preprocessListEvents(args: any): Promise<any> {
  let processedCalendarId: string | string[] = args.calendarId;

  if (
    typeof args.calendarId === 'string' &&
    args.calendarId.trim().startsWith('[') &&
    args.calendarId.trim().endsWith(']')
  ) {
    try {
      const parsed = JSON.parse(args.calendarId);
      if (
        Array.isArray(parsed) &&
        parsed.every((id) => typeof id === 'string' && id.length > 0)
      ) {
        if (parsed.length === 0) throw new Error('At least one calendar ID is required');
        if (parsed.length > 50) throw new Error('Maximum 50 calendars allowed per request');
        if (new Set(parsed).size !== parsed.length) {
          throw new Error('Duplicate calendar IDs are not allowed');
        }
        processedCalendarId = parsed;
      } else {
        throw new Error('JSON string must contain an array of non-empty strings');
      }
    } catch (error) {
      throw new Error(
        `Invalid JSON format for calendarId: ${
          error instanceof Error ? error.message : 'Unknown parsing error'
        }`,
      );
    }
  }

  if (Array.isArray(processedCalendarId)) {
    if (processedCalendarId.length === 0) {
      throw new Error('At least one calendar ID is required');
    }
    if (processedCalendarId.length > 50) {
      throw new Error('Maximum 50 calendars allowed per request');
    }
    if (!processedCalendarId.every((id) => typeof id === 'string' && id.length > 0)) {
      throw new Error('All calendar IDs must be non-empty strings');
    }
    if (new Set(processedCalendarId).size !== processedCalendarId.length) {
      throw new Error('Duplicate calendar IDs are not allowed');
    }
  }

  return {
    calendarId: processedCalendarId,
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    timeZone: args.timeZone,
  };
}

// -----------------------------------------------------------------------------
// Tool registry
// -----------------------------------------------------------------------------
const CALENDAR_TOOLS: CalendarToolEntry[] = [
  {
    name: 'list-calendars',
    description: 'List all available calendars',
    handler: ListCalendarsHandler,
  },
  {
    name: 'list-events',
    description: 'List events from one or more calendars.',
    handler: ListEventsHandler,
    preprocess: preprocessListEvents,
  },
  {
    name: 'search-events',
    description: 'Search for events in a calendar by text query.',
    handler: SearchEventsHandler,
  },
  {
    name: 'list-colors',
    description: 'List available color IDs and their meanings for calendar events',
    handler: ListColorsHandler,
  },
  {
    name: 'create-event',
    description: 'Create a new calendar event.',
    handler: CreateEventHandler,
  },
  {
    name: 'update-event',
    description:
      'Update an existing calendar event with recurring event modification scope support.',
    handler: UpdateEventHandler,
  },
  {
    name: 'delete-event',
    description: 'Delete a calendar event.',
    handler: DeleteEventHandler,
  },
  {
    name: 'get-freebusy',
    description:
      "Returns free/busy information for a set of calendars or groups using the Google Calendar API's POST /calendar/v3/freeBusy endpoint. The request body must include an 'items' array of calendar/group IDs, and the time range between timeMin and timeMax must not exceed 3 months.",
    handler: FreeBusyEventHandler,
  },
  {
    name: 'get-current-time',
    description: 'Get current system time and timezone information.',
    handler: GetCurrentTimeHandler,
  },
];

// Build tool definitions (JSON Schema inputSchemas via zod-to-json-schema).
// The ToolSchemas map has a heterogeneous union type (ZodObject | ZodEffects |
// ZodEffects<ZodObject>). TypeScript can't unify the narrow generics through
// zodToJsonSchema's signature, so widen to `any` at the call site.
const rawToolDefinitions: ToolDefinition[] = CALENDAR_TOOLS.map((t) => {
  const schema = ToolSchemas[t.name] as any;
  const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    inputSchema: jsonSchema,
  };
});

// Apply destructive/read-only annotations. Calendar tool names use hyphens, so
// the classifier's startsWith check still works (list-events, delete-event, etc.)
const toolDefinitions = annotateAll(rawToolDefinitions);

// -----------------------------------------------------------------------------
// Dispatcher
// -----------------------------------------------------------------------------
function findTool(name: string): CalendarToolEntry | undefined {
  return CALENDAR_TOOLS.find((t) => t.name === name);
}

async function handleTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  const entry = findTool(name);
  if (!entry) return null;

  try {
    const schema = ToolSchemas[entry.name] as any;
    // Validate against the Zod schema before dispatching to the handler.
    const validated = schema.parse(args);
    const finalArgs = entry.preprocess ? await entry.preprocess(validated) : validated;

    const handlerInstance = new entry.handler();
    const oauth2Client = ctx.authClient as OAuth2Client;
    const result = await handlerInstance.runTool(finalArgs, oauth2Client);

    // BaseToolHandler returns CallToolResult ({ content: [{type:'text', text:...}], ... }).
    // Our ToolResult is structurally compatible — narrow the content type.
    return {
      content: (result.content as any[]).map((c) =>
        typeof c.text === 'string'
          ? { type: c.type ?? 'text', text: c.text }
          : { type: 'text', text: JSON.stringify(c) },
      ),
      isError: (result as any).isError,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown calendar tool error';
    ctx.log(`Calendar tool ${entry.name} failed`, { error: message });
    return errorResponse(message);
  }
}

const calendarService: ServiceModule = {
  key: 'calendar',
  displayName: 'Google Calendar',
  toolDefinitions,
  handleTool,
};

export default calendarService;
