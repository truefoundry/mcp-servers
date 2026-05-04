/**
 * Free-function utilities for talking to the Google Calendar API. These
 * replace the inheritance-based methods on the upstream BaseToolHandler so
 * the new tools.ts can stay flat.
 */
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { GaxiosError } from 'gaxios';
import type { calendar_v3 } from 'googleapis';

/**
 * Maps a Google API error onto an MCP-friendly error and re-throws.
 * Always returns `never` — calling this terminates the current code path.
 */
export function handleGoogleApiError(error: unknown): never {
  if (error instanceof GaxiosError) {
    const status = error.response?.status;
    const errorData = error.response?.data;

    if (errorData?.error === 'invalid_grant') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Authentication token is invalid or expired. Please re-run the authentication process.',
      );
    }

    if (status === 403) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Access denied: ${errorData?.error?.message || 'Insufficient permissions'}`,
      );
    }

    if (status === 404) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Resource not found: ${
          errorData?.error?.message ||
          'The requested calendar or event does not exist'
        }`,
      );
    }

    if (status === 429) {
      throw new McpError(
        ErrorCode.InternalError,
        'Rate limit exceeded. Please try again later.',
      );
    }

    if (status && status >= 500) {
      throw new McpError(
        ErrorCode.InternalError,
        `Google API server error: ${errorData?.error?.message || error.message}`,
      );
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      `Google API error: ${errorData?.error?.message || error.message}`,
    );
  }

  if (error instanceof Error) {
    throw new McpError(ErrorCode.InternalError, `Internal error: ${error.message}`);
  }

  throw new McpError(ErrorCode.InternalError, 'An unknown error occurred');
}

export async function getCalendarDetails(
  calendar: calendar_v3.Calendar,
  calendarId: string,
): Promise<calendar_v3.Schema$CalendarListEntry> {
  try {
    const response = await calendar.calendarList.get({ calendarId });
    if (!response.data) throw new Error(`Calendar ${calendarId} not found`);
    return response.data;
  } catch (error) {
    handleGoogleApiError(error);
  }
}

/**
 * Returns the calendar's default timezone, falling back to UTC if the
 * lookup fails for any reason.
 */
export async function getCalendarTimezone(
  calendar: calendar_v3.Calendar,
  calendarId: string,
): Promise<string> {
  try {
    const details = await getCalendarDetails(calendar, calendarId);
    return details.timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
