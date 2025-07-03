import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from "googleapis";

export class ListCalendarsHandler extends BaseToolHandler {
    async runTool(_: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const calendars = await this.listCalendars(oauth2Client);
        return {
            content: [{
                type: "text", // This MUST be a string literal
                text: this.formatCalendarList(calendars),
            }],
        };
    }

    private async listCalendars(client: OAuth2Client): Promise<calendar_v3.Schema$CalendarListEntry[]> {
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.calendarList.list();
            return response.data.items || [];
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }


    /**
     * Formats a list of calendars into a user-friendly string with detailed information.
     */
    private formatCalendarList(calendars: calendar_v3.Schema$CalendarListEntry[]): string {
        return calendars
            .map((cal) => {
                // Sanitize strings to prevent crashes
                const name = this.sanitizeString(cal.summaryOverride || cal.summary || "Untitled");
                const id = this.sanitizeString(cal.id || "no-id");
                const timezone = this.sanitizeString(cal.timeZone || "Unknown");
                const kind = this.sanitizeString(cal.kind || "Unknown");
                const accessRole = this.sanitizeString(cal.accessRole || "Unknown");
                const isPrimary = cal.primary ? " (PRIMARY)" : "";
                const isSelected = cal.selected !== false ? "Yes" : "No";
                const isHidden = cal.hidden ? "Yes" : "No";
                const backgroundColor = this.sanitizeString(cal.backgroundColor || "Default");
                
                // Sanitize description and limit length
                let description = "";
                if (cal.description) {
                    const sanitizedDesc = this.sanitizeString(cal.description);
                    description = sanitizedDesc.length > 100 
                        ? `\n  Description: ${sanitizedDesc.substring(0, 100)}...`
                        : `\n  Description: ${sanitizedDesc}`;
                }
                
                let defaultReminders = "None";
                if (cal.defaultReminders && cal.defaultReminders.length > 0) {
                    defaultReminders = cal.defaultReminders
                        .map(reminder => {
                            const method = this.sanitizeString(reminder.method || "unknown");
                            const minutes = reminder.minutes || 0;
                            return `${method} (${minutes}min before)`;
                        })
                        .join(", ");
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
            .join("\n\n");
    }

    /**
     * Sanitizes a string to prevent crashes by removing problematic characters
     */
    private sanitizeString(str: string): string {
        if (!str) return "";
        
        return str
            // Remove null bytes and control characters that could cause crashes
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            // Replace problematic Unicode characters
            .replace(/[\uFFFE\uFFFF]/g, '')
            // Limit length to prevent extremely long strings
            .substring(0, 500)
            // Trim whitespace
            .trim();
    }

}
