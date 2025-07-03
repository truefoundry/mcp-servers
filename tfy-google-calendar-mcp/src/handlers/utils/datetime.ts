/**
 * Datetime utilities for Google Calendar MCP Server
 * Provides timezone handling and datetime conversion utilities
 */

/**
 * Checks if a datetime string includes timezone information
 * @param datetime ISO 8601 datetime string
 * @returns True if timezone is included, false if timezone-naive
 */
export function hasTimezoneInDatetime(datetime: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime);
}

/**
 * Converts a flexible datetime string to RFC3339 format required by Google Calendar API
 * 
 * Precedence rules:
 * 1. If datetime already has timezone info (Z or ±HH:MM), use as-is
 * 2. If datetime is timezone-naive, convert using fallbackTimezone
 * 
 * @param datetime ISO 8601 datetime string (with or without timezone)
 * @param fallbackTimezone Timezone to use if datetime is timezone-naive (IANA format)
 * @returns RFC3339 formatted datetime string
 */
export function convertToRFC3339(datetime: string, fallbackTimezone: string): string {
    if (hasTimezoneInDatetime(datetime)) {
        // Already has timezone, use as-is
        return datetime;
    } else {
        // Timezone-naive, convert to timezone-aware format
        try {
            const date = new Date(datetime);
            // Use Intl.DateTimeFormat to convert to the target timezone
            const options: Intl.DateTimeFormatOptions = {
                timeZone: fallbackTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'longOffset'
            };
            
            const formatter = new Intl.DateTimeFormat('sv-SE', options);
            const parts = formatter.formatToParts(date);
            
            // Extract parts
            const year = parts.find(p => p.type === 'year')?.value;
            const month = parts.find(p => p.type === 'month')?.value;
            const day = parts.find(p => p.type === 'day')?.value;
            const hour = parts.find(p => p.type === 'hour')?.value;
            const minute = parts.find(p => p.type === 'minute')?.value;
            const second = parts.find(p => p.type === 'second')?.value;
            const timeZoneName = parts.find(p => p.type === 'timeZoneName')?.value;
            
            if (year && month && day && hour && minute && second && timeZoneName) {
                // Convert timezone name to offset format (e.g., "GMT-08:00" to "-08:00")
                const offsetMatch = timeZoneName.match(/GMT([+-]\d{2}:\d{2})/);
                const offset = offsetMatch ? offsetMatch[1] : 'Z';
                return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
            }
        } catch (error) {
            // Fallback: if timezone conversion fails, append Z for UTC
            return datetime + 'Z';
        }
        
        // Fallback: append Z for UTC
        return datetime + 'Z';
    }
}

/**
 * Creates a time object for Google Calendar API, handling both timezone-aware and timezone-naive datetime strings
 * @param datetime ISO 8601 datetime string (with or without timezone)
 * @param fallbackTimezone Timezone to use if datetime is timezone-naive (IANA format)
 * @returns Google Calendar API time object
 */
export function createTimeObject(datetime: string, fallbackTimezone: string): { dateTime: string; timeZone?: string } {
    if (hasTimezoneInDatetime(datetime)) {
        // Timezone included in datetime - use as-is, no separate timeZone property needed
        return { dateTime: datetime };
    } else {
        // Timezone-naive datetime - use fallback timezone
        return { dateTime: datetime, timeZone: fallbackTimezone };
    }
}