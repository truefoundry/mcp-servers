
/**
 * Outlook Calendar tools (Microsoft Graph /me/events, /me/calendar*).
 */

import { z } from "zod";
import {
  graphGet,
  graphPost,
  graphPatch,
  graphDelete,
} from "../graph.js";
import { runTool, dateRangeSchema, odataString } from "./util.js";

const EVENT_SELECT =
  "id,subject,organizer,start,end,location,bodyPreview,webLink,attendees,isAllDay,isCancelled,onlineMeeting";

const dateTimeSchema = z
  .object({
    dateTime: z.string().describe("Local date/time, ISO 8601."),
    timeZone: z
      .string()
      .optional()
      .describe("IANA/Windows time zone. Defaults to UTC."),
  })
  .describe("A Graph dateTimeTimeZone value.");

/** Normalize a {dateTime,timeZone} input, defaulting the zone to UTC. */
function dateTime(value) {
  if (!value) return undefined;
  return { dateTime: value.dateTime, timeZone: value.timeZone || "UTC" };
}

/** Build a Graph event resource from common create/update fields. */
function buildEvent({ subject, body, start, end, location, attendees, is_online_meeting }) {
  const event = {};
  if (subject !== undefined) event.subject = subject;
  if (body !== undefined) {
    event.body = { contentType: body.contentType || "text", content: body.content };
  }
  if (start) event.start = dateTime(start);
  if (end) event.end = dateTime(end);
  if (location !== undefined) event.location = { displayName: location };
  if (attendees) {
    event.attendees = attendees.map((address) => ({
      emailAddress: { address },
      type: "required",
    }));
  }
  if (is_online_meeting !== undefined) {
    event.isOnlineMeeting = is_online_meeting;
    if (is_online_meeting) event.onlineMeetingProvider = "teamsForBusiness";
  }
  return event;
}

export function registerCalendarTools(server, token) {
  server.tool(
    "list_events",
    "List the signed-in user's calendar events, ordered by start time " +
      "(includes past events). To scope to a date window or only future " +
      "events, use search_events with a date_range.",
    {
      calendar_id: z
        .string()
        .optional()
        .describe("Specific calendar id. Defaults to the primary calendar."),
      top: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max events to return (default 25)."),
    },
    runTool(({ calendar_id, top }) => {
      const base = calendar_id
        ? `/me/calendars/${odataString(calendar_id)}/events`
        : "/me/events";
      return graphGet(token, base, {
        $top: top ?? 25,
        $orderby: "start/dateTime",
        $select: EVENT_SELECT,
      });
    }),
  );

  server.tool(
    "search_events",
    "Search calendar events by keyword and/or date range. When a date range " +
      "is supplied, recurring events are expanded via calendarView.",
    {
      query: z.string().optional().describe("Free-text search over events."),
      date_range: dateRangeSchema,
    },
    runTool(async ({ query, date_range }) => {
      const hasRange = Boolean(date_range && (date_range.start || date_range.end));

      // The Events resource supports neither $search nor recurring-series
      // expansion, so every keyword or date-window search runs through
      // calendarView (which requires an explicit window) and filters keyword
      // matches by subject/preview/location in memory.
      if (query || hasRange) {
        const now = Date.now();
        // When a range is given, fill the missing side as now .. now+30d.
        // For a bare keyword search, widen the default window to include the
        // recent past so existing events are found.
        const defaultStart = hasRange ? now : now - 30 * 24 * 3600 * 1000;
        const defaultEnd = now + (hasRange ? 30 : 90) * 24 * 3600 * 1000;
        const start = date_range?.start
          ? new Date(date_range.start).toISOString()
          : new Date(defaultStart).toISOString();
        const end = date_range?.end
          ? new Date(date_range.end).toISOString()
          : new Date(defaultEnd).toISOString();
        const result = await graphGet(token, "/me/calendarView", {
          startDateTime: start,
          endDateTime: end,
          $top: query ? 100 : 25,
          $orderby: "start/dateTime",
          $select: EVENT_SELECT,
        });
        if (query && Array.isArray(result?.value)) {
          const needle = query.toLowerCase();
          result.value = result.value
            .filter((e) =>
              [e.subject, e.bodyPreview, e.location?.displayName].some(
                (field) =>
                  typeof field === "string" &&
                  field.toLowerCase().includes(needle),
              ),
            )
            .slice(0, 25);
        }
        return result;
      }
      return graphGet(token, "/me/events", {
        $top: 25,
        $orderby: "start/dateTime",
        $select: EVENT_SELECT,
      });
    }),
  );

  server.tool(
    "get_event",
    "Get full details for a calendar event by id.",
    { event_id: z.string().describe("The event id.") },
    runTool(({ event_id }) =>
      graphGet(token, `/me/events/${odataString(event_id)}`, {
        $select: EVENT_SELECT + ",body",
      }),
    ),
  );

  server.tool(
    "create_event",
    "Create a new calendar event, optionally as a Teams online meeting.",
    {
      subject: z.string().describe("Event subject/title."),
      start: dateTimeSchema,
      end: dateTimeSchema,
      body: z
        .object({
          content: z.string(),
          contentType: z.enum(["text", "html"]).optional(),
        })
        .optional()
        .describe("Event description/body."),
      location: z.string().optional().describe("Location display name."),
      attendees: z
        .array(z.string())
        .optional()
        .describe("Attendee email addresses."),
      is_online_meeting: z
        .boolean()
        .optional()
        .describe("Create a Teams online meeting for this event."),
    },
    runTool((args) => graphPost(token, "/me/events", buildEvent(args))),
  );

  server.tool(
    "update_event",
    "Update fields on an existing calendar event.",
    {
      event_id: z.string().describe("Id of the event to update."),
      subject: z.string().optional(),
      start: dateTimeSchema.optional(),
      end: dateTimeSchema.optional(),
      body: z
        .object({
          content: z.string(),
          contentType: z.enum(["text", "html"]).optional(),
        })
        .optional(),
      location: z.string().optional(),
      attendees: z.array(z.string()).optional(),
    },
    runTool(({ event_id, ...rest }) =>
      graphPatch(token, `/me/events/${odataString(event_id)}`, buildEvent(rest)),
    ),
  );

  server.tool(
    "delete_event",
    "Delete a calendar event by id.",
    { event_id: z.string().describe("Id of the event to delete.") },
    runTool(async ({ event_id }) => {
      await graphDelete(token, `/me/events/${odataString(event_id)}`);
      return { status: "deleted", event_id };
    }),
  );

  server.tool(
    "accept_event",
    "Accept a meeting invitation.",
    {
      event_id: z.string().describe("Id of the event/invitation."),
      comment: z.string().optional().describe("Optional response comment."),
      send_response: z
        .boolean()
        .optional()
        .describe("Send a response to the organizer (default true)."),
    },
    runTool(async ({ event_id, comment, send_response }) => {
      // Graph rejects a non-null comment when sendResponse is false, so only
      // include the comment when one was actually provided.
      const payload = { sendResponse: send_response ?? true };
      if (comment) payload.comment = comment;
      await graphPost(
        token,
        `/me/events/${odataString(event_id)}/accept`,
        payload,
      );
      return { status: "accepted", event_id };
    }),
  );

  server.tool(
    "decline_event",
    "Decline a meeting invitation.",
    {
      event_id: z.string().describe("Id of the event/invitation."),
      comment: z.string().optional().describe("Optional response comment."),
      send_response: z
        .boolean()
        .optional()
        .describe("Send a response to the organizer (default true)."),
    },
    runTool(async ({ event_id, comment, send_response }) => {
      // Graph rejects a non-null comment when sendResponse is false, so only
      // include the comment when one was actually provided.
      const payload = { sendResponse: send_response ?? true };
      if (comment) payload.comment = comment;
      await graphPost(
        token,
        `/me/events/${odataString(event_id)}/decline`,
        payload,
      );
      return { status: "declined", event_id };
    }),
  );

  server.tool(
    "find_free_slots",
    "Look up free/busy availability for one or more people over a time window " +
      "using the calendar getSchedule API.",
    {
      schedules: z
        .array(z.string())
        .describe("Email addresses to check availability for."),
      start: dateTimeSchema,
      end: dateTimeSchema,
      interval_minutes: z
        .number()
        .int()
        .min(5)
        .max(1440)
        .optional()
        .describe("Availability slot granularity in minutes (default 30)."),
    },
    runTool(({ schedules, start, end, interval_minutes }) =>
      graphPost(token, "/me/calendar/getSchedule", {
        schedules,
        startTime: dateTime(start),
        endTime: dateTime(end),
        availabilityViewInterval: interval_minutes ?? 30,
      }),
    ),
  );

  server.tool(
    "list_calendars",
    "List all calendars owned by or shared with the signed-in user.",
    {},
    runTool(() =>
      graphGet(token, "/me/calendars", {
        $select: "id,name,owner,canEdit,canShare,isDefaultCalendar,color",
      }),
    ),
  );
}
