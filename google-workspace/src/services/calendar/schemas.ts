/**
 * Zod input schemas + auxiliary types for the calendar service tools.
 * Originally split across schemas/inputs.ts + schemas/types.ts; consolidated
 * here for consistency with the other services.
 */
import { z } from 'zod';

const iso8601WithOrWithoutTz = (val: string) => {
  const withTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(val);
  const withoutTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(val);
  return withTz || withoutTz;
};
const iso8601Error = "Must be ISO 8601 format: '2026-01-01T00:00:00'";

const attendeeSchema = z.object({
  email: z.string().email().describe(
    'Email address of the attendee (required when adding an attendee)',
  ),
  additionalGuests: z.number().int().min(0).optional().describe(
    'Number of additional guests. Optional. The default is 0.',
  ),
  comment: z.string().optional().describe("The attendee's response comment. Optional."),
  displayName: z.string().optional().describe("The attendee's name, if available. Optional."),
  id: z.string().optional().describe("The attendee's Profile ID, if available. Optional."),
  optional: z.boolean().optional().describe(
    'Whether this is an optional attendee. Optional. The default is False.',
  ),
  resource: z.boolean().optional().describe(
    'Whether the attendee is a resource. Can only be set when the attendee is added to the event for the first time. Optional. The default is False.',
  ),
  responseStatus: z
    .enum(['needsAction', 'declined', 'tentative', 'accepted'])
    .optional()
    .describe(
      "The attendee's response status. Optional. Possible values: 'needsAction', 'declined', 'tentative', 'accepted'.",
    ),
});

const remindersSchema = z.object({
  useDefault: z.boolean().describe('Whether to use the default reminders'),
  overrides: z
    .array(
      z
        .object({
          method: z.enum(['email', 'popup']).default('popup').describe('Reminder method'),
          minutes: z.number().describe('Minutes before the event to trigger the reminder'),
        })
        .partial({ method: true }),
    )
    .optional()
    .describe('Custom reminders'),
});

export const ToolSchemas = {
  'list-calendars': z.object({}),

  'list-events': z.object({
    calendarId: z.string().describe(
      "ID of the calendar(s) to list events from. Accepts either a single calendar ID string or an array of calendar IDs (passed as JSON string like '[\"cal1\", \"cal2\"]')",
    ),
    timeMin: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "Start time boundary. Preferred: '2024-01-01T00:00:00' (uses timeZone parameter or calendar timezone). Also accepts: '2024-01-01T00:00:00Z' or '2024-01-01T00:00:00-08:00'.",
    ),
    timeMax: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "End time boundary. Preferred: '2024-01-01T23:59:59' (uses timeZone parameter or calendar timezone). Also accepts: '2024-01-01T23:59:59Z' or '2024-01-01T23:59:59-08:00'.",
    ),
    timeZone: z.string().optional().describe(
      "Timezone as IANA Time Zone Database name (e.g., America/Los_Angeles). Takes priority over calendar's default timezone. Only used for timezone-naive datetime strings.",
    ),
  }),

  'search-events': z.object({
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    query: z.string().describe(
      'Free text search query (searches summary, description, location, attendees, etc.)',
    ),
    timeMin: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "Start time boundary. Preferred: '2024-01-01T00:00:00' (uses timeZone parameter or calendar timezone). Also accepts: '2024-01-01T00:00:00Z' or '2024-01-01T00:00:00-08:00'.",
    ),
    timeMax: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "End time boundary. Preferred: '2024-01-01T23:59:59' (uses timeZone parameter or calendar timezone). Also accepts: '2024-01-01T23:59:59Z' or '2024-01-01T23:59:59-08:00'.",
    ),
    timeZone: z.string().optional().describe(
      "Timezone as IANA Time Zone Database name (e.g., America/Los_Angeles). Takes priority over calendar's default timezone. Only used for timezone-naive datetime strings.",
    ),
  }),

  'list-colors': z.object({}),

  'create-event': z.object({
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    summary: z.string().describe('Title of the event'),
    description: z.string().optional().describe('Description/notes for the event'),
    start: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "Event start time: '2024-01-01T10:00:00'",
    ),
    end: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "Event end time: '2024-01-01T11:00:00'",
    ),
    timeZone: z.string().optional().describe(
      "Timezone as IANA Time Zone Database name (e.g., America/Los_Angeles). Takes priority over calendar's default timezone. Only used for timezone-naive datetime strings.",
    ),
    location: z.string().optional().describe('Location of the event'),
    attendees: z.array(attendeeSchema).optional().describe(
      'List of attendees for the event. See the Events with attendees guide for more information on scheduling events with other calendar users.',
    ),
    colorId: z.string().optional().describe(
      'Color ID for the event (use list-colors to see available IDs)',
    ),
    reminders: remindersSchema.optional().describe('Reminder settings for the event'),
    recurrence: z
      .array(z.string())
      .optional()
      .describe('Recurrence rules in RFC5545 format (e.g., ["RRULE:FREQ=WEEKLY;COUNT=5"])'),
  }),

  'update-event': z
    .object({
      calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
      eventId: z.string().describe('ID of the event to update'),
      summary: z.string().optional().describe('Updated title of the event'),
      description: z.string().optional().describe('Updated description/notes'),
      start: z
        .string()
        .refine(iso8601WithOrWithoutTz, iso8601Error)
        .describe("Updated start time: '2024-01-01T10:00:00'")
        .optional(),
      end: z
        .string()
        .refine(iso8601WithOrWithoutTz, iso8601Error)
        .describe("Updated end time: '2024-01-01T11:00:00'")
        .optional(),
      timeZone: z.string().optional().describe(
        "Updated timezone as IANA Time Zone Database name. If not provided, uses the calendar's default timezone.",
      ),
      location: z.string().optional().describe('Updated location'),
      attendees: z.array(attendeeSchema).optional().describe(
        'Updated attendee list. See the Events with attendees guide for more information on scheduling events with other calendar users.',
      ),
      colorId: z.string().optional().describe('Updated color ID'),
      reminders: remindersSchema.optional().describe('Reminder settings for the event'),
      recurrence: z.array(z.string()).optional().describe('Updated recurrence rules'),
      sendUpdates: z
        .enum(['all', 'externalOnly', 'none'])
        .default('all')
        .describe('Whether to send update notifications'),
      modificationScope: z
        .enum(['thisAndFollowing', 'all', 'thisEventOnly'])
        .optional()
        .describe('Scope for recurring event modifications'),
      originalStartTime: z
        .string()
        .refine(iso8601WithOrWithoutTz, iso8601Error)
        .describe("Original start time in the ISO 8601 format '2024-01-01T10:00:00'")
        .optional(),
      futureStartDate: z
        .string()
        .refine(iso8601WithOrWithoutTz, iso8601Error)
        .describe("Start date for future instances in the ISO 8601 format '2024-01-01T10:00:00'")
        .optional(),
    })
    .refine(
      (data) =>
        !(data.modificationScope === 'thisEventOnly' && !data.originalStartTime),
      {
        message: "originalStartTime is required when modificationScope is 'thisEventOnly'",
        path: ['originalStartTime'],
      },
    )
    .refine(
      (data) =>
        !(data.modificationScope === 'thisAndFollowing' && !data.futureStartDate),
      {
        message: "futureStartDate is required when modificationScope is 'thisAndFollowing'",
        path: ['futureStartDate'],
      },
    )
    .refine(
      (data) => {
        if (data.futureStartDate) {
          return new Date(data.futureStartDate) > new Date();
        }
        return true;
      },
      { message: 'futureStartDate must be in the future', path: ['futureStartDate'] },
    ),

  'delete-event': z.object({
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    eventId: z.string().describe('ID of the event to delete'),
    sendUpdates: z
      .enum(['all', 'externalOnly', 'none'])
      .default('all')
      .describe('Whether to send cancellation notifications'),
  }),

  'get-freebusy': z.object({
    items: z
      .array(
        z.object({
          id: z.string().describe(
            "ID of the calendar or group. Can be a calendar ID (e.g., 'primary', '<email@example.com>') or a group ID. Required.",
          ),
        }),
      )
      .describe(
        "List of calendars and/or groups to query for free/busy information. Each item must have an 'id' field that is a calendar or group ID. This field maps directly to the Google Calendar API's 'items' property. At least one item is required.",
      ),
    timeMin: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "Start time boundary for the query. Must be ISO 8601 format with timezone (e.g., '2024-01-01T00:00:00+05:30'). Required.",
    ),
    timeMax: z.string().refine(iso8601WithOrWithoutTz, iso8601Error).describe(
      "End time boundary for the query. Must be ISO 8601 format with timezone (e.g., '2024-01-01T23:59:59+05:30'). Required.",
    ),
    timeZone: z.string().optional().describe(
      "IANA time zone name (e.g., 'Asia/Kolkata', 'America/Los_Angeles'). Used only if timeMin/timeMax do not include a timezone. Optional.",
    ),
    groupExpansionMax: z.number().int().max(100).optional().describe(
      'Maximum number of calendars to expand per group (max 100). Optional.',
    ),
    calendarExpansionMax: z.number().int().max(50).optional().describe(
      'Maximum number of calendars to expand (max 50). Optional.',
    ),
  }),

  'get-current-time': z.object({
    timeZone: z.string().optional().describe(
      "Optional IANA timezone (e.g., 'America/Los_Angeles', 'Europe/London', 'UTC'). If not provided, returns UTC time and system timezone for reference.",
    ),
  }),
} as const;

export type ToolInputs = {
  [K in keyof typeof ToolSchemas]: z.infer<(typeof ToolSchemas)[K]>;
};

export type ListCalendarsInput = ToolInputs['list-calendars'];
export type ListEventsInput = ToolInputs['list-events'];
export type SearchEventsInput = ToolInputs['search-events'];
export type ListColorsInput = ToolInputs['list-colors'];
export type CreateEventInput = ToolInputs['create-event'];
export type UpdateEventInput = ToolInputs['update-event'];
export type DeleteEventInput = ToolInputs['delete-event'];
export type GetFreeBusyInput = ToolInputs['get-freebusy'];
export type GetCurrentTimeInput = ToolInputs['get-current-time'];

// Type-safe response based on Google Calendar FreeBusy API.
export interface FreeBusyResponse {
  kind: 'calendar#freeBusy';
  timeMin: string;
  timeMax: string;
  groups?: {
    [key: string]: {
      errors?: { domain: string; reason: string }[];
      calendars?: string[];
    };
  };
  calendars: {
    [key: string]: {
      errors?: { domain: string; reason: string }[];
      busy: {
        start: string;
        end: string;
      }[];
    };
  };
}
