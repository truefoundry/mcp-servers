# Google Workspace MCP Server

A single Node.js service that exposes Google **Drive**, **Docs**, **Sheets**, **Slides**, and **Calendar** as 5 separate MCP endpoints, each hosted by the same container but advertised as a distinct MCP server in the TrueFoundry LLM Gateway.

```text
     TFY LLM Gateway
          │
   ┌──────┴────────┐
   │  OAuth 2.0    │   (5 separate registrations, one per service,
   │  per-service  │    each requesting only the scopes it needs)
   │   scopes      │
   └──────┬────────┘
          │ Authorization: Bearer <user access token>
          ▼
 ┌──────────────────────────────────────────────┐
 │          google-workspace-mcp pod            │
 │                                              │
 │  /health                                     │
 │  /mcp/drive     → 28 tools                   │
 │  /mcp/docs      → 29 tools                   │
 │  /mcp/sheets    → 20 tools                   │
 │  /mcp/slides    → 21 tools                   │
 │  /mcp/calendar  →  9 tools                   │
 └──────────────────────────────────────────────┘
```

The drive / docs / sheets / slides tool sets are ported verbatim from the upstream [`piotr-agier/google-drive-mcp`](https://github.com/piotr-agier/google-drive-mcp). The calendar tool set is migrated from the (now removed) `mcp-servers/google-calendar-mcp` package and rewritten to share the same per-request auth model.

## Architecture

- **One Node process, 5 MCP endpoints.** Each `POST /mcp/<service>` request opens a session bound to a `StreamableHTTPServerTransport`, and the underlying MCP `Server` is created via `createMcpServer({ services: ['<service>'] })` so `tools/list` only returns that one service's tools.
- **Per-request OAuth (multi-tenant).** Every request must carry the end-user's Google access token in `Authorization: Bearer …`. The TFY Gateway runs the OAuth dance with Google and forwards the token. The server has no local OAuth flow, no on-disk token storage, no service-account fallback — credentials live in the gateway.
- **Tool annotations.** Every tool definition gets `annotations: { destructiveHint, readOnlyHint, idempotentHint, openWorldHint }` computed from its name prefix in `src/annotations.ts`.

## Repository layout

```
src/
  index.ts                # thin CLI (HTTP transport only)
  server.ts               # createMcpServer({ services: [...] }) factory
  auth-ctx.ts             # per-request OAuth2Client resolution from Bearer token
  auth/client.ts          # one-time loader for the app's client_id/client_secret
  annotations.ts          # tool annotation classifier
  types.ts                # ToolDefinition, ToolContext, ServiceModule
  utils.ts                # shared helpers (escapeDriveQuery, etc.)
  tools/                  # drive | docs | sheets | slides implementations
  services/
    drive/                # wrapper -> tools/drive.ts + annotations
    docs/                 # wrapper -> tools/docs.ts + annotations
    sheets/               # wrapper -> tools/sheets.ts + annotations
    slides/               # wrapper -> tools/slides.ts + annotations
    calendar/             # migrated from google-calendar-mcp (handlers + schemas)
  transports/
    http.ts               # Express app with 5 mounted MCP routes + /health
Dockerfile
deploy.py                 # TrueFoundry LocalSource(local_build=False) deploy
gcp-oauth.keys.example.json
```

## Local development

This server runs over HTTP only. To test locally you need a Google access token (e.g. one minted via `gcloud auth print-access-token` for a project that has the relevant APIs enabled, or one captured from a TFY Gateway session).

```bash
npm install
npm run build

# Mount your gcp-oauth.keys.json (web client) and start the server.
GOOGLE_DRIVE_OAUTH_CREDENTIALS=./gcp-oauth.keys.json \
  npm run start -- --port 3000 --host 127.0.0.1

# In another shell, smoke-test:
curl -s http://127.0.0.1:3000/health

# Initialize an MCP session against one endpoint (header is required):
curl -s -X POST http://127.0.0.1:3000/mcp/drive \
  -H "Authorization: Bearer <google-access-token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}'
```

## Deploying to TrueFoundry

Prerequisites:

1. Google Cloud OAuth client (Web application type). Copy `gcp-oauth.keys.example.json` → fill in your `client_id` / `client_secret` / `project_id`. Add the TFY Gateway callback to **Authorized redirect URIs**:
   ```
   https://<your-tfy-control-plane>/api/svc/v1/llm-gateway/mcp-servers/oauth2/callback
   ```
2. Ensure these Google APIs are enabled in your GCP project: Drive, Docs, Sheets, Slides, Calendar.
3. `tfy login --host https://<your-tfy-control-plane>`.

Then:

```bash
export GOOGLE_CLIENT_ID=...apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=GOCSPX-...
export GOOGLE_PROJECT_ID=your-project-id
python deploy.py
```

`deploy.py` uses `LocalSource(local_build=False)`, so TrueFoundry zips this folder (respecting `.dockerignore`), uploads it, builds the image remotely, and deploys. Secrets (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) are injected via a `StringDataMount` as `/app/gcp.json` — they never land in git or the image.

After `python deploy.py`:

```bash
curl https://google-workspace-mcp-a2a-3000.<your-tfy-domain>/health
```

should return:

```json
{
  "status": "healthy",
  "server": "google-workspace-mcp",
  "version": "0.1.0",
  "services": ["drive", "docs", "sheets", "slides", "calendar"],
  "timestamp": "…"
}
```

## Registering MCP servers in the TFY Gateway

Create **5 separate MCP server registrations** in the TrueFoundry LLM Gateway UI. They share the same Google OAuth client, but each requests a different subset of scopes at user-consent time:

| TFY MCP name          | Server URL                                                                         | Scopes                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gws-drive`           | `https://google-workspace-mcp-a2a-3000.<tfy-domain>/mcp/drive`                     | `https://www.googleapis.com/auth/drive` `https://www.googleapis.com/auth/drive.file` `https://www.googleapis.com/auth/drive.readonly`                                               |
| `gws-docs`            | `https://google-workspace-mcp-a2a-3000.<tfy-domain>/mcp/docs`                      | `https://www.googleapis.com/auth/documents` `https://www.googleapis.com/auth/drive.file`                                                                                            |
| `gws-sheets`          | `https://google-workspace-mcp-a2a-3000.<tfy-domain>/mcp/sheets`                    | `https://www.googleapis.com/auth/spreadsheets` `https://www.googleapis.com/auth/drive.file`                                                                                         |
| `gws-slides`          | `https://google-workspace-mcp-a2a-3000.<tfy-domain>/mcp/slides`                    | `https://www.googleapis.com/auth/presentations` `https://www.googleapis.com/auth/drive.file`                                                                                        |
| `gws-calendar`        | `https://google-workspace-mcp-a2a-3000.<tfy-domain>/mcp/calendar`                  | `https://www.googleapis.com/auth/calendar` `https://www.googleapis.com/auth/calendar.events`                                                                                        |

Auth settings are the same for all five:

- **Auth type**: OAuth 2.0
- **Authorization URL**: `https://accounts.google.com/o/oauth2/v2/auth`
- **Token URL**: `https://oauth2.googleapis.com/token`
- **Client ID / Secret**: the GCP client you configured
- **PKCE**: S256

## How the per-request auth works

1. End user hits TFY Gateway → Gateway redirects them through Google OAuth for whichever registration they're using (drive/docs/sheets/etc.).
2. Gateway stores the access token per-user.
3. On every MCP call, Gateway forwards the call to `https://…/mcp/<svc>` with `Authorization: Bearer <that user's access token>`.
4. `src/transports/http.ts` attaches the token to `req.auth.access_token`.
5. The MCP SDK propagates it as `extra.authInfo` into every tool handler.
6. `src/auth-ctx.ts#resolveAuthClientForRequest` builds a fresh `OAuth2Client` with that access token + the pre-loaded app credentials.
7. Tool handlers call Google APIs as that user.

## Tool annotations

Applied automatically by `src/annotations.ts` based on the tool name prefix:

- **Read-only** (`readOnlyHint: true`): `list`, `get`, `read`, `search`, `find`, `export`, `download`, `count`, `describe`, `preview`.
- **Additive** (no badge): `create`, `insert`, `add`, `append`, `upload`, `share` — operations that produce new data without overwriting or removing existing data.
- **Destructive** (`destructiveHint: true`): `delete`, `remove`, `trash`, `replace`, `update`, `move`, `clear`, `revoke`, `archive`, `rename`, `unshare`, `set`, `format`, `apply`, `writeFile`, `batchUpdate`.
- Conflicts (e.g. `findAndReplaceInDoc` matches both) are resolved via `EXPLICIT_OVERRIDES` in `src/annotations.ts`.
- All tools get `openWorldHint: true` because they all talk to Google's APIs.

See the full per-tool breakdown with `node scripts/list-tools.mjs` after `npm run build`.

## Migrated from

- Upstream `piotr-agier/google-drive-mcp` → `src/tools/*` (drive / docs / sheets / slides).
- (Removed) internal `mcp-servers/google-calendar-mcp` → `src/services/calendar/handlers/` + `src/services/calendar/schemas/`.
