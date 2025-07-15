# Google Calendar MCP Server

A Model Context Protocol (MCP) server that provides Google Calendar integration for AI assistants like Claude.

## Features

- **Multi-Calendar Support**: List events from multiple calendars simultaneously
- **Event Management**: Create, update, delete, and search calendar events
- **Recurring Events**: Advanced modification capabilities for recurring events
- **Free/Busy Queries**: Check availability across calendars
- **Smart Scheduling**: Natural language understanding for dates and times
- **Intelligent Import**: Add calendar events from images, PDFs or web links

## Quick Start

### Prerequisites

1. A Google Cloud project with the Calendar API enabled
2. OAuth 2.0 credentials

### Google Cloud Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) for your project. Ensure that the right project is selected from the top bar before enabling the API
4. Click on Manage Button and then visit the Credentials tab
5. Create OAuth 2.0 credentials:
   - Go to Credentials
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application" for the type of data that the app will be accessing
   - Add your app name and contact information
   - Add the following redirect URL and click Save URLs:
     - `https://<tfy-control-plane-base-url>/api/svc/v1/llm-gateway/mcp-servers/oauth2/callback`
   - Click on "Create" button
   - Note the Client ID and Client Secret values and Download the JSON credentials file
   - Visit the Data Access from the left sidebar and add the following scopes:
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/calendar.calendarlist`
     - `https://www.googleapis.com/auth/calendar.calendars`
     - `https://www.googleapis.com/auth/calendar.calendars.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.events.owned`
     - `https://www.googleapis.com/auth/calendar.events.owned.readonly`
     - `https://www.googleapis.com/auth/calendar.events.readonly`
   - Click on "Save" button
   - Visit the Audience screen from the left sidebar and add the following:
     - User Type: Internal
     - Application Name: Google Calendar MCP
     - User Support Email: `<your-email@example.com>`

### Deployment Configuration

In your google-calendar-mcp deployment, add the following environment variables:

- `GOOGLE_OAUTH_CREDENTIALS` - Path to OAuth credentials file (e.g., `gcp.json`)
- `HOST` - `0.0.0.0`
- `PORT` - `3000`
- `TRANSPORT` - `http`
- `GOOGLE_CALENDAR_MCP_TOKEN_PATH` - Custom token storage location (optional)

Mount the OAuth credentials file to the container:
- `/app/gcp.json`: From the secrets or paste the JSON credentials file content (refer: `google-calendar-mcp/gcp-oauth.keys.example.json`)

### Deploy the MCP Server on TrueFoundry

Use `google-calendar-mcp/truefoundry.yaml` as a reference to deploy the MCP server on TrueFoundry.

## License

MIT

## Support

- [GitHub Issues](https://github.com/nspady/google-calendar-mcp/issues)
- [Documentation](docs/)