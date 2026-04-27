/**
 * Datetime utilities for the calendar service. Handles timezone-aware and
 * timezone-naive ISO 8601 strings and converts to RFC3339 for the Google
 * Calendar API.
 */

export function hasTimezoneInDatetime(datetime: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime);
}

/**
 * Converts a flexible datetime string to RFC3339 format required by the Google
 * Calendar API.
 *
 * Precedence:
 *   1. If `datetime` already has timezone info (Z or ±HH:MM), use as-is.
 *   2. Otherwise convert using `fallbackTimezone`.
 */
export function convertToRFC3339(datetime: string, fallbackTimezone: string): string {
  if (hasTimezoneInDatetime(datetime)) return datetime;

  try {
    const date = new Date(datetime);
    const options: Intl.DateTimeFormatOptions = {
      timeZone: fallbackTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    };

    const formatter = new Intl.DateTimeFormat('sv-SE', options);
    const parts = formatter.formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    const second = parts.find((p) => p.type === 'second')?.value;
    const timeZoneName = parts.find((p) => p.type === 'timeZoneName')?.value;

    if (year && month && day && hour && minute && second && timeZoneName) {
      const offsetMatch = timeZoneName.match(/GMT([+-]\d{2}:\d{2})/);
      const offset = offsetMatch ? offsetMatch[1] : 'Z';
      return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
    }
  } catch {
    return datetime + 'Z';
  }

  return datetime + 'Z';
}

/**
 * Builds a Google Calendar API time object, handling both timezone-aware and
 * timezone-naive datetime strings.
 */
export function createTimeObject(
  datetime: string,
  fallbackTimezone: string,
): { dateTime: string; timeZone?: string } {
  if (hasTimezoneInDatetime(datetime)) {
    return { dateTime: datetime };
  }
  return { dateTime: datetime, timeZone: fallbackTimezone };
}
