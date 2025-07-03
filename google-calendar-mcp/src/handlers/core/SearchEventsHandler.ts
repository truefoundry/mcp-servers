import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { SearchEventsInput } from "../../tools/registry.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { formatEventWithDetails } from "../utils.js";
import { convertToRFC3339 } from "../utils/datetime.js";

export class SearchEventsHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = args as SearchEventsInput;
        const events = await this.searchEvents(oauth2Client, validArgs);
        
        if (events.length === 0) {
            return {
                content: [{
                    type: "text",
                    text: "No events found matching your search criteria."
                }]
            };
        }
        
        let text = `Found ${events.length} event(s) matching your search:\n\n`;
        
        events.forEach((event, index) => {
            const eventDetails = formatEventWithDetails(event, validArgs.calendarId);
            text += `${index + 1}. ${eventDetails}\n\n`;
        });
        
        return {
            content: [{
                type: "text",
                text: text.trim()
            }]
        };
    }

    private async searchEvents(
        client: OAuth2Client,
        args: SearchEventsInput
    ): Promise<calendar_v3.Schema$Event[]> {
        try {
            const calendar = this.getCalendar(client);
            
            // Determine timezone with correct precedence:
            // 1. Explicit timeZone parameter (highest priority)
            // 2. Calendar's default timezone (fallback)
            const timezone = args.timeZone || await this.getCalendarTimezone(client, args.calendarId);
            
            // Convert time boundaries to RFC3339 format for Google Calendar API
            // Note: convertToRFC3339 will still respect timezone in datetime string as highest priority
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
            return response.data.items || [];
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }

}
