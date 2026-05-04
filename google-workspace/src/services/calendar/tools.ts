/**
 * Calendar tool registry and dispatcher. Per-request OAuth comes from the
 * shared auth-ctx layer; this module dispatches against `ctx.getCalendar()`
 * and (for batch operations) `ctx.authClient`.
 *
 * Originally a tree of class-based BaseToolHandler subclasses; flattened here
 * for consistency with the other services in this monorepo.
 */
import type { OAuth2Client } from 'google-auth-library';
import type { calendar_v3 } from 'googleapis';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type {
  ToolAnnotations,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from '../../types.js';
import { errorResponse } from '../../types.js';

import {
  ToolSchemas,
  type CreateEventInput,
  type DeleteEventInput,
  type GetCurrentTimeInput,
  type GetFreeBusyInput,
  type SearchEventsInput,
  type UpdateEventInput,
  type FreeBusyResponse,
} from './schemas.js';
import { formatEventWithDetails } from './helpers/format.js';
import { convertToRFC3339, createTimeObject } from './helpers/datetime.js';
import { handleGoogleApiError, getCalendarTimezone } from './helpers/api.js';
import { BatchRequestHandler } from './helpers/batch.js';
import {
  RecurringEventHelpers,
  RecurringEventError,
  RECURRING_EVENT_ERRORS,
} from './helpers/recurring.js';

// ---------------------------------------------------------------------------
// Tool registry — annotations are hardcoded next to each tool's name/schema.
// ---------------------------------------------------------------------------

interface CalendarToolEntry {
  name: keyof typeof ToolSchemas;
  description: string;
  annotations: ToolAnnotations;
}

const CALENDAR_TOOLS: CalendarToolEntry[] = [
  {
    name: 'list-calendars',
    description: 'List all available calendars',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list-events',
    description: 'List events from one or more calendars.',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search-events',
    description: 'Search for events in a calendar by text query.',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list-colors',
    description: 'List available color IDs and their meanings for calendar events',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create-event',
    description: 'Create a new calendar event.',
    annotations: { destructiveHint: false },
  },
  {
    name: 'update-event',
    description:
      'Update an existing calendar event with recurring event modification scope support.',
    annotations: { destructiveHint: true },
  },
  {
    name: 'delete-event',
    description: 'Delete a calendar event.',
    annotations: { destructiveHint: true },
  },
  {
    name: 'get-freebusy',
    description:
      "Returns free/busy information for a set of calendars or groups using the Google Calendar API's POST /calendar/v3/freeBusy endpoint. The request body must include an 'items' array of calendar/group IDs, and the time range between timeMin and timeMax must not exceed 3 months.",
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get-current-time',
    description: 'Get current system time and timezone information.',
    annotations: { readOnlyHint: true },
  },
];

export const toolDefinitions: ToolDefinition[] = CALENDAR_TOOLS.map((t) => {
  const schema = ToolSchemas[t.name] as ZodTypeAny;
  return {
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(schema as any) as Record<string, unknown>,
    annotations: t.annotations,
  };
});

const TOOL_NAMES = new Set(CALENDAR_TOOLS.map((t) => t.name as string));

// ---------------------------------------------------------------------------
// list-events: normalize calendarId (single string or JSON-stringified array).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function sanitizeString(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\uFFFE\uFFFF]/g, '')
    .substring(0, 500)
    .trim();
}

function formatCalendarList(
  calendars: calendar_v3.Schema$CalendarListEntry[],
): string {
  return calendars
    .map((cal) => {
      const name = sanitizeString(cal.summaryOverride || cal.summary || 'Untitled');
      const id = sanitizeString(cal.id || 'no-id');
      const timezone = sanitizeString(cal.timeZone || 'Unknown');
      const kind = sanitizeString(cal.kind || 'Unknown');
      const accessRole = sanitizeString(cal.accessRole || 'Unknown');
      const isPrimary = cal.primary ? ' (PRIMARY)' : '';
      const isSelected = cal.selected !== false ? 'Yes' : 'No';
      const isHidden = cal.hidden ? 'Yes' : 'No';
      const backgroundColor = sanitizeString(cal.backgroundColor || 'Default');

      let description = '';
      if (cal.description) {
        const sanitizedDesc = sanitizeString(cal.description);
        description =
          sanitizedDesc.length > 100
            ? `\n  Description: ${sanitizedDesc.substring(0, 100)}...`
            : `\n  Description: ${sanitizedDesc}`;
      }

      let defaultReminders = 'None';
      if (cal.defaultReminders && cal.defaultReminders.length > 0) {
        defaultReminders = cal.defaultReminders
          .map((reminder) => {
            const method = sanitizeString(reminder.method || 'unknown');
            const minutes = reminder.minutes || 0;
            return `${method} (${minutes}min before)`;
          })
          .join(', ');
      }

      return `${name}${isPrimary} (${id})
  Timezone: ${timezone}
  Kind: ${kind}
  Access Role: ${accessRole}
  Selected: ${isSelected}
  Hidden: ${isHidden}
  Background Color: ${backgroundColor}
  Default Reminders: ${defaultReminders}${description}`;
    })
    .join('\n\n');
}

function formatColorList(colors: calendar_v3.Schema$Colors): string {
  const eventColors = colors.event || {};
  return Object.entries(eventColors)
    .map(
      ([id, colorInfo]) =>
        `Color ID: ${id} - ${colorInfo.background} (background) / ${colorInfo.foreground} (foreground)`,
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Tool runners (one per tool — mirrors the upstream handler classes)
// ---------------------------------------------------------------------------

async function runListCalendars(calendar: calendar_v3.Calendar): Promise<ToolResult> {
  try {
    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];
    return textResult(formatCalendarList(calendars));
  } catch (error) {
    handleGoogleApiError(error);
  }
}

interface ListEventsArgs {
  calendarId: string | string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
}

interface ExtendedEvent extends calendar_v3.Schema$Event {
  calendarId: string;
}

async function buildEventsPath(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  options: { timeMin?: string; timeMax?: string; timeZone?: string },
): Promise<string> {
  let timeMin = options.timeMin;
  let timeMax = options.timeMax;

  if (timeMin || timeMax) {
    const timezone = options.timeZone || (await getCalendarTimezone(calendar, calendarId));
    timeMin = timeMin ? convertToRFC3339(timeMin, timezone) : undefined;
    timeMax = timeMax ? convertToRFC3339(timeMax, timezone) : undefined;
  }

  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    ...(timeMin && { timeMin }),
    ...(timeMax && { timeMax }),
  });

  return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
}

function processBatchEventResponses(
  responses: any[],
  calendarIds: string[],
): { events: ExtendedEvent[]; errors: Array<{ calendarId: string; error: string }> } {
  const events: ExtendedEvent[] = [];
  const errors: Array<{ calendarId: string; error: string }> = [];

  responses.forEach((response, index) => {
    const calendarId = calendarIds[index];
    if (response.statusCode === 200 && response.body?.items) {
      const calendarEvents: ExtendedEvent[] = response.body.items.map(
        (event: any) => ({ ...event, calendarId }),
      );
      events.push(...calendarEvents);
    } else {
      const errorMessage =
        response.body?.error?.message ||
        response.body?.message ||
        `HTTP ${response.statusCode}`;
      errors.push({ calendarId, error: errorMessage });
    }
  });

  return { events, errors };
}

function sortEventsByStartTime(events: ExtendedEvent[]): ExtendedEvent[] {
  return events.sort((a, b) => {
    const aStart = a.start?.dateTime || a.start?.date || '';
    const bStart = b.start?.dateTime || b.start?.date || '';
    return aStart.localeCompare(bStart);
  });
}

function groupEventsByCalendar(
  events: ExtendedEvent[],
): Record<string, ExtendedEvent[]> {
  return events.reduce((acc, event) => {
    const calId = event.calendarId;
    if (!acc[calId]) acc[calId] = [];
    acc[calId].push(event);
    return acc;
  }, {} as Record<string, ExtendedEvent[]>);
}

async function fetchSingleCalendarEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  options: { timeMin?: string; timeMax?: string; timeZone?: string },
): Promise<ExtendedEvent[]> {
  try {
    let timeMin = options.timeMin;
    let timeMax = options.timeMax;

    if (timeMin || timeMax) {
      const timezone =
        options.timeZone || (await getCalendarTimezone(calendar, calendarId));
      timeMin = timeMin ? convertToRFC3339(timeMin, timezone) : undefined;
      timeMax = timeMax ? convertToRFC3339(timeMax, timezone) : undefined;
    }

    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (response.data.items || []).map((event) => ({ ...event, calendarId }));
  } catch (error) {
    handleGoogleApiError(error);
  }
}

async function fetchMultipleCalendarEvents(
  calendar: calendar_v3.Calendar,
  oauth2Client: OAuth2Client,
  calendarIds: string[],
  options: { timeMin?: string; timeMax?: string; timeZone?: string },
): Promise<ExtendedEvent[]> {
  const batchHandler = new BatchRequestHandler(oauth2Client);

  const requests = await Promise.all(
    calendarIds.map(async (calendarId) => ({
      method: 'GET' as const,
      path: await buildEventsPath(calendar, calendarId, options),
    })),
  );

  const responses = await batchHandler.executeBatch(requests);
  const { events, errors } = processBatchEventResponses(responses, calendarIds);

  if (errors.length > 0) {
    process.stderr.write(
      `Some calendars had errors: ${errors
        .map((e) => `${e.calendarId}: ${e.error}`)
        .join(', ')}\n`,
    );
  }

  return sortEventsByStartTime(events);
}

async function runListEvents(
  calendar: calendar_v3.Calendar,
  oauth2Client: OAuth2Client,
  args: ListEventsArgs,
): Promise<ToolResult> {
  const calendarIds = Array.isArray(args.calendarId) ? args.calendarId : [args.calendarId];
  const options = { timeMin: args.timeMin, timeMax: args.timeMax, timeZone: args.timeZone };

  const allEvents =
    calendarIds.length === 1
      ? await fetchSingleCalendarEvents(calendar, calendarIds[0], options)
      : await fetchMultipleCalendarEvents(calendar, oauth2Client, calendarIds, options);

  if (allEvents.length === 0) {
    return textResult(`No events found in ${calendarIds.length} calendar(s).`);
  }

  let text =
    calendarIds.length === 1
      ? `Found ${allEvents.length} event(s):\n\n`
      : `Found ${allEvents.length} event(s) across ${calendarIds.length} calendars:\n\n`;

  if (calendarIds.length === 1) {
    allEvents.forEach((event, index) => {
      const eventDetails = formatEventWithDetails(event, event.calendarId);
      text += `${index + 1}. ${eventDetails}\n\n`;
    });
  } else {
    const grouped = groupEventsByCalendar(allEvents);
    for (const [calendarId, events] of Object.entries(grouped)) {
      text += `Calendar: ${calendarId}\n\n`;
      events.forEach((event, index) => {
        const eventDetails = formatEventWithDetails(event, event.calendarId);
        text += `${index + 1}. ${eventDetails}\n\n`;
      });
      text += '\n';
    }
  }

  return textResult(text.trim());
}

async function runSearchEvents(
  calendar: calendar_v3.Calendar,
  args: SearchEventsInput,
): Promise<ToolResult> {
  try {
    const timezone = args.timeZone || (await getCalendarTimezone(calendar, args.calendarId));
    const timeMin = convertToRFC3339(args.timeMin, timezone);
    const timeMax = convertToRFC3339(args.timeMax, timezone);

    const response = await calendar.events.list({
      calendarId: args.calendarId,
      q: args.query,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = response.data.items || [];

    if (events.length === 0) {
      return textResult('No events found matching your search criteria.');
    }

    let text = `Found ${events.length} event(s) matching your search:\n\n`;
    events.forEach((event, index) => {
      const eventDetails = formatEventWithDetails(event, args.calendarId);
      text += `${index + 1}. ${eventDetails}\n\n`;
    });

    return textResult(text.trim());
  } catch (error) {
    handleGoogleApiError(error);
  }
}

async function runListColors(calendar: calendar_v3.Calendar): Promise<ToolResult> {
  try {
    const response = await calendar.colors.get();
    if (!response.data) throw new Error('Failed to retrieve colors');
    return textResult(`Available event colors:\n${formatColorList(response.data)}`);
  } catch (error) {
    handleGoogleApiError(error);
  }
}

async function runCreateEvent(
  calendar: calendar_v3.Calendar,
  args: CreateEventInput,
): Promise<ToolResult> {
  try {
    const timezone = args.timeZone || (await getCalendarTimezone(calendar, args.calendarId));

    const requestBody: calendar_v3.Schema$Event = {
      summary: args.summary,
      description: args.description,
      start: createTimeObject(args.start, timezone),
      end: createTimeObject(args.end, timezone),
      attendees: args.attendees,
      location: args.location,
      colorId: args.colorId,
      reminders: args.reminders,
      recurrence: args.recurrence,
    };

    const response = await calendar.events.insert({
      calendarId: args.calendarId,
      requestBody,
    });
    if (!response.data) throw new Error('Failed to create event, no data returned');

    const eventDetails = formatEventWithDetails(response.data, args.calendarId);
    return textResult(`Event created successfully!\n\n${eventDetails}`);
  } catch (error) {
    handleGoogleApiError(error);
  }
}

async function updateSingleInstance(
  helpers: RecurringEventHelpers,
  args: UpdateEventInput,
  defaultTimeZone: string,
): Promise<calendar_v3.Schema$Event> {
  if (!args.originalStartTime) {
    throw new RecurringEventError(
      'originalStartTime is required for single instance updates',
      RECURRING_EVENT_ERRORS.MISSING_ORIGINAL_TIME,
    );
  }

  const calendar = helpers.getCalendar();
  const instanceId = helpers.formatInstanceId(args.eventId, args.originalStartTime);

  const response = await calendar.events.patch({
    calendarId: args.calendarId,
    eventId: instanceId,
    requestBody: helpers.buildUpdateRequestBody(args, defaultTimeZone),
  });

  if (!response.data) throw new Error('Failed to update event instance');
  return response.data;
}

async function updateAllInstances(
  helpers: RecurringEventHelpers,
  args: UpdateEventInput,
  defaultTimeZone: string,
): Promise<calendar_v3.Schema$Event> {
  const calendar = helpers.getCalendar();

  const response = await calendar.events.patch({
    calendarId: args.calendarId,
    eventId: args.eventId,
    requestBody: helpers.buildUpdateRequestBody(args, defaultTimeZone),
  });

  if (!response.data) throw new Error('Failed to update event');
  return response.data;
}

async function updateFutureInstances(
  helpers: RecurringEventHelpers,
  args: UpdateEventInput,
  defaultTimeZone: string,
): Promise<calendar_v3.Schema$Event> {
  if (!args.futureStartDate) {
    throw new RecurringEventError(
      'futureStartDate is required for future instance updates',
      RECURRING_EVENT_ERRORS.MISSING_FUTURE_DATE,
    );
  }

  const calendar = helpers.getCalendar();
  const effectiveTimeZone = args.timeZone || defaultTimeZone;

  const originalResponse = await calendar.events.get({
    calendarId: args.calendarId,
    eventId: args.eventId,
  });
  const originalEvent = originalResponse.data;

  if (!originalEvent.recurrence) {
    throw new Error('Event does not have recurrence rules');
  }

  const untilDate = helpers.calculateUntilDate(args.futureStartDate);
  const updatedRecurrence = helpers.updateRecurrenceWithUntil(
    originalEvent.recurrence,
    untilDate,
  );

  await calendar.events.patch({
    calendarId: args.calendarId,
    eventId: args.eventId,
    requestBody: { recurrence: updatedRecurrence },
  });

  const requestBody = helpers.buildUpdateRequestBody(args, defaultTimeZone);

  let endTime = args.end;
  if (args.start || args.futureStartDate) {
    const newStartTime = args.start || args.futureStartDate;
    endTime = endTime || helpers.calculateEndTime(newStartTime, originalEvent);
  }

  const newEvent = {
    ...helpers.cleanEventForDuplication(originalEvent),
    ...requestBody,
    start: {
      dateTime: args.start || args.futureStartDate,
      timeZone: effectiveTimeZone,
    },
    end: {
      dateTime: endTime,
      timeZone: effectiveTimeZone,
    },
  };

  const response = await calendar.events.insert({
    calendarId: args.calendarId,
    requestBody: newEvent,
  });

  if (!response.data) throw new Error('Failed to create new recurring event');
  return response.data;
}

async function runUpdateEvent(
  calendar: calendar_v3.Calendar,
  args: UpdateEventInput,
): Promise<ToolResult> {
  try {
    const helpers = new RecurringEventHelpers(calendar);
    const defaultTimeZone = await getCalendarTimezone(calendar, args.calendarId);
    const eventType = await helpers.detectEventType(args.eventId, args.calendarId);

    if (
      args.modificationScope &&
      args.modificationScope !== 'all' &&
      eventType !== 'recurring'
    ) {
      throw new RecurringEventError(
        'Scope other than "all" only applies to recurring events',
        RECURRING_EVENT_ERRORS.NON_RECURRING_SCOPE,
      );
    }

    let event: calendar_v3.Schema$Event;
    switch (args.modificationScope) {
      case 'thisEventOnly':
        event = await updateSingleInstance(helpers, args, defaultTimeZone);
        break;
      case 'all':
      case undefined:
        event = await updateAllInstances(helpers, args, defaultTimeZone);
        break;
      case 'thisAndFollowing':
        event = await updateFutureInstances(helpers, args, defaultTimeZone);
        break;
      default:
        throw new RecurringEventError(
          `Invalid modification scope: ${args.modificationScope}`,
          RECURRING_EVENT_ERRORS.INVALID_SCOPE,
        );
    }

    const eventDetails = formatEventWithDetails(event, args.calendarId);
    return textResult(`Event updated successfully!\n\n${eventDetails}`);
  } catch (error) {
    if (error instanceof RecurringEventError) throw error;
    handleGoogleApiError(error);
  }
}

async function runDeleteEvent(
  calendar: calendar_v3.Calendar,
  args: DeleteEventInput,
): Promise<ToolResult> {
  try {
    await calendar.events.delete({
      calendarId: args.calendarId,
      eventId: args.eventId,
      sendUpdates: args.sendUpdates,
    });
    return textResult('Event deleted successfully');
  } catch (error) {
    handleGoogleApiError(error);
  }
}

function isLessThanThreeMonths(timeMin: string, timeMax: string): boolean {
  const minDate = new Date(timeMin);
  const maxDate = new Date(timeMax);
  const diffInMilliseconds = maxDate.getTime() - minDate.getTime();
  const threeMonthsInMilliseconds = 3 * 30 * 24 * 60 * 60 * 1000;
  return diffInMilliseconds <= threeMonthsInMilliseconds;
}

function generateAvailabilitySummary(response: FreeBusyResponse): string {
  return Object.entries(response.calendars)
    .map(([email, calendarInfo]) => {
      if (calendarInfo.errors?.some((error) => error.reason === 'notFound')) {
        return `Cannot check availability for ${email} (account not found)\n`;
      }
      if (calendarInfo.busy.length === 0) {
        return `${email} is available during ${response.timeMin} to ${response.timeMax}, please schedule calendar to ${email} if you want \n`;
      }
      const busyTimes = calendarInfo.busy
        .map((slot) => `- From ${slot.start} to ${slot.end}`)
        .join('\n');
      return `${email} is busy during:\n${busyTimes}\n`;
    })
    .join('\n')
    .trim();
}

async function runGetFreeBusy(
  calendar: calendar_v3.Calendar,
  args: GetFreeBusyInput,
): Promise<ToolResult> {
  if (!isLessThanThreeMonths(args.timeMin, args.timeMax)) {
    return textResult(
      'The time gap between timeMin and timeMax must be less than 3 months',
    );
  }

  try {
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        timeZone: args.timeZone,
        groupExpansionMax: args.groupExpansionMax,
        calendarExpansionMax: args.calendarExpansionMax,
        items: args.items,
      },
    });
    const result = response.data as FreeBusyResponse;
    return textResult(generateAvailabilitySummary(result));
  } catch (error) {
    handleGoogleApiError(error);
  }
}

// ---------------------------------------------------------------------------
// get-current-time helpers
// ---------------------------------------------------------------------------

function getSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getTimezoneOffsetMinutes(timeZone: string): number {
  const date = new Date();

  const targetTimeString = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);

  const utcTimeString = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);

  const targetTime = new Date(targetTimeString.replace(' ', 'T') + 'Z').getTime();
  const utcTimeParsed = new Date(utcTimeString.replace(' ', 'T') + 'Z').getTime();

  return (targetTime - utcTimeParsed) / (1000 * 60);
}

function getTimezoneOffset(timeZone: string): string {
  try {
    const offsetMinutes = getTimezoneOffsetMinutes(timeZone);
    if (offsetMinutes === 0) return 'Z';
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes >= 0 ? '+' : '-';
    return `${sign}${offsetHours.toString().padStart(2, '0')}:${offsetMins
      .toString()
      .padStart(2, '0')}`;
  } catch {
    return 'Z';
  }
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const offset = getTimezoneOffset(timeZone);
  const isoString = date.toISOString().replace(/\.\d{3}Z$/, '');
  return isoString + offset;
}

function formatHumanReadable(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'long',
  });
  return formatter.format(date);
}

async function runGetCurrentTime(args: GetCurrentTimeInput): Promise<ToolResult> {
  const now = new Date();
  const requestedTimeZone = args.timeZone;
  const systemTimeZone = getSystemTimeZone();

  let result: any;

  if (requestedTimeZone) {
    if (!isValidTimeZone(requestedTimeZone)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid timezone: ${requestedTimeZone}. Use IANA timezone format like 'America/Los_Angeles' or 'UTC'.`,
      );
    }

    result = {
      currentTime: {
        utc: now.toISOString(),
        timestamp: now.getTime(),
        requestedTimeZone: {
          timeZone: requestedTimeZone,
          rfc3339: formatDateInTimeZone(now, requestedTimeZone),
          humanReadable: formatHumanReadable(now, requestedTimeZone),
          offset: getTimezoneOffset(requestedTimeZone),
        },
      },
    };
  } else {
    result = {
      currentTime: {
        utc: now.toISOString(),
        timestamp: now.getTime(),
        systemTimeZone: {
          timeZone: systemTimeZone,
          rfc3339: formatDateInTimeZone(now, systemTimeZone),
          humanReadable: formatHumanReadable(now, systemTimeZone),
          offset: getTimezoneOffset(systemTimeZone),
        },
        note:
          "System timezone shown. For HTTP mode, specify timeZone parameter for user's local time.",
      },
    };
  }

  return textResult(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handleTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  if (!TOOL_NAMES.has(name)) return null;

  try {
    const schema = ToolSchemas[name as keyof typeof ToolSchemas] as ZodTypeAny;
    const validated = schema.parse(args) as any;
    const calendar = ctx.getCalendar();

    switch (name) {
      case 'list-calendars':
        return await runListCalendars(calendar);

      case 'list-events': {
        const finalArgs = (await preprocessListEvents(validated)) as ListEventsArgs;
        return await runListEvents(calendar, ctx.authClient as OAuth2Client, finalArgs);
      }

      case 'search-events':
        return await runSearchEvents(calendar, validated as SearchEventsInput);

      case 'list-colors':
        return await runListColors(calendar);

      case 'create-event':
        return await runCreateEvent(calendar, validated as CreateEventInput);

      case 'update-event':
        return await runUpdateEvent(calendar, validated as UpdateEventInput);

      case 'delete-event':
        return await runDeleteEvent(calendar, validated as DeleteEventInput);

      case 'get-freebusy':
        return await runGetFreeBusy(calendar, validated as GetFreeBusyInput);

      case 'get-current-time':
        return await runGetCurrentTime(validated as GetCurrentTimeInput);

      default:
        return null;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown calendar tool error';
    ctx.log(`Calendar tool ${name} failed`, { error: message });
    return errorResponse(message);
  }
}
