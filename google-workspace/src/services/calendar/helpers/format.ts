/**
 * Calendar event formatting helpers. Pure presentation utilities used by the
 * tool dispatchers in tools.ts.
 */
import type { calendar_v3 } from 'googleapis';

export function generateEventUrl(calendarId: string, eventId: string): string {
  const encodedCalendarId = encodeURIComponent(calendarId);
  const encodedEventId = encodeURIComponent(eventId);
  return `https://calendar.google.com/calendar/event?eid=${encodedEventId}&cid=${encodedCalendarId}`;
}

export function getEventUrl(
  event: calendar_v3.Schema$Event,
  calendarId?: string,
): string | null {
  if (event.htmlLink) return event.htmlLink;
  if (calendarId && event.id) return generateEventUrl(calendarId, event.id);
  return null;
}

function formatDateTime(
  dateTime?: string | null,
  date?: string | null,
  timeZone?: string,
): string {
  if (!dateTime && !date) return 'unspecified';

  try {
    const dt = dateTime || date;
    if (!dt) return 'unspecified';

    const parsedDate = new Date(dt);
    if (isNaN(parsedDate.getTime())) return dt;

    if (date && !dateTime) {
      return parsedDate.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    };

    if (timeZone) options.timeZone = timeZone;

    return parsedDate.toLocaleString('en-US', options);
  } catch {
    return dateTime || date || 'unspecified';
  }
}

function formatAttendees(attendees?: calendar_v3.Schema$EventAttendee[]): string {
  if (!attendees || attendees.length === 0) return '';

  const formatted = attendees
    .map((attendee) => {
      const email = attendee.email || 'unknown';
      const name = attendee.displayName || email;
      const status = attendee.responseStatus || 'unknown';

      const statusText =
        ({
          accepted: 'accepted',
          declined: 'declined',
          tentative: 'tentative',
          needsAction: 'pending',
        } as Record<string, string>)[status] || 'unknown';

      const details: string[] = [statusText];
      if (attendee.organizer) details.push('organizer');
      if (attendee.self) details.push('self');
      if (attendee.resource) details.push('resource');
      if (attendee.optional) details.push('optional');
      if (attendee.additionalGuests !== undefined)
        details.push(`+${attendee.additionalGuests} guests`);
      if (attendee.comment) details.push(`comment: ${attendee.comment}`);
      if (attendee.id) details.push(`id: ${attendee.id}`);
      return `- ${name} <${email}> [${details.join(', ')}]`;
    })
    .join('\n');

  return `\nAttendees:\n${formatted}`;
}

export function formatEventWithDetails(
  event: calendar_v3.Schema$Event,
  calendarId?: string,
): string {
  const title = event.summary ? `Event: ${event.summary}` : 'Untitled Event';
  const eventId = event.id ? `\nEvent ID: ${event.id}` : '';
  const description = event.description ? `\nDescription: ${event.description}` : '';
  const location = event.location ? `\nLocation: ${event.location}` : '';

  const startTime = formatDateTime(
    event.start?.dateTime,
    event.start?.date,
    event.start?.timeZone || undefined,
  );
  const endTime = formatDateTime(
    event.end?.dateTime,
    event.end?.date,
    event.end?.timeZone || undefined,
  );

  let timeInfo: string;
  if (event.start?.date) {
    if (event.start.date === event.end?.date) {
      timeInfo = `\nDate: ${startTime}`;
    } else {
      const endDate = event.end?.date ? new Date(event.end.date) : null;
      if (endDate) {
        endDate.setDate(endDate.getDate() - 1);
        const adjustedEndTime = endDate.toLocaleDateString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        timeInfo = `\nStart Date: ${startTime}\nEnd Date: ${adjustedEndTime}`;
      } else {
        timeInfo = `\nStart Date: ${startTime}`;
      }
    }
  } else {
    timeInfo = `\nStart: ${startTime}\nEnd: ${endTime}`;
  }

  const attendeeInfo = formatAttendees(event.attendees);
  const eventUrl = getEventUrl(event, calendarId);
  const urlInfo = eventUrl ? `\nView: ${eventUrl}` : '';

  return `${title}${eventId}${description}${timeInfo}${location}${attendeeInfo}${urlInfo}`;
}
