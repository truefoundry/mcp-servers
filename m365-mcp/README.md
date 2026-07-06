# m365-mcp-server

A Node.js [MCP](https://modelcontextprotocol.io) server exposing **Microsoft 365**
capabilities (Outlook Mail, Calendar, Teams, OneDrive, SharePoint) as tools,
backed by the [Microsoft Graph API](https://learn.microsoft.com/graph/).

It runs over the **Streamable HTTP** transport and passes the caller's OAuth
**Bearer token straight through to Graph** — the server performs no token
exchange, storage, or caching, and is fully stateless (a fresh MCP server +
transport is built per request so tokens never leak between callers).

## Requirements

- Node.js >= 18 (uses the global `fetch`)
- A valid Microsoft Graph access token with the scopes for the tools you call

## Setup

```bash
npm install
npm start          # listens on http://localhost:3000  (set PORT to override)
```

## Endpoints

| Method | Path      | Auth            | Description                          |
| ------ | --------- | --------------- | ------------------------------------ |
| `GET`  | `/health` | none            | Liveness check (`{"status":"ok"}`).  |
| `POST` | `/mcp`    | `Bearer <jwt>`  | MCP Streamable HTTP endpoint.        |

The `Authorization: Bearer <token>` header is **required** on `/mcp`. Missing or
malformed headers return JSON-RPC error `-32001` with HTTP 401.

## Tools

### 📧 Outlook Mail
| Tool | Description |
| --- | --- |
| `list_emails` | List emails with filters (folder, unread, top) |
| `search_emails` | KQL search across the mailbox (query, from, date_range) |
| `get_email` | Get a full email by id |
| `send_email` | Send a new email |
| `reply_email` | Reply / reply-all to a thread |
| `create_draft` | Create a draft email |
| `update_draft` | Update an existing draft |
| `delete_email` | Delete (move to Deleted Items) |
| `list_folders` | List mailbox folders |
| `move_email` | Move an email to a folder |

### 📅 Outlook Calendar
| Tool | Description |
| --- | --- |
| `list_events` | List upcoming events |
| `search_events` | Search events by keyword / date range |
| `get_event` | Get event details by id |
| `create_event` | Create an event (optionally a Teams meeting) |
| `update_event` | Update an existing event |
| `delete_event` | Delete an event |
| `accept_event` | Accept a meeting invitation |
| `decline_event` | Decline a meeting invitation |
| `find_free_slots` | Free/busy lookup via `getSchedule` |
| `list_calendars` | List the user's calendars |

### 💬 Microsoft Teams
| Tool | Description |
| --- | --- |
| `list_chats` | List the user's chats |
| `search_chat_messages` | Search across chat messages |
| `get_chat_messages` | Get messages from a chat |
| `send_chat_message` | Post a message to a chat |
| `create_chat` | Create a new chat |
| `add_chat_member` | Add a member to a chat |
| `list_teams` | List joined teams |
| `list_channels` | List channels in a team |
| `get_channel_messages` | Read channel messages |
| `post_channel_message` | Post to a channel |

### 📁 OneDrive
| Tool | Description |
| --- | --- |
| `list_files` | List files in a folder |
| `search_files` | Search files by name / content |
| `get_file` | Get file metadata |
| `download_file` | Download file content (base64) |
| `upload_file` | Upload a small file (< 4 MB, base64) |
| `create_folder` | Create a new folder |
| `delete_file` | Delete a file or folder |
| `move_file` | Move / rename a file |
| `share_file` | Create a sharing link |

### 🌐 SharePoint
| Tool | Description |
| --- | --- |
| `search_sharepoint` | Full-text search across the tenant |
| `list_sites` | List / search SharePoint sites |
| `get_site` | Get site details |
| `list_libraries` | List document libraries (drives) |
| `list_items` | List items in a list |
| `get_item` | Get a specific list item |
| `create_item` | Create a list item |
| `update_item` | Update a list item |
| `upload_to_sharepoint` | Upload a file to a site library |

## Required Graph scopes

Grant the access token the delegated scopes for the surfaces you use, e.g.
`Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `Chat.ReadWrite`,
`ChannelMessage.Read.All`/`Send`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`.

## Project layout

```
src/
  index.js            Express app, Bearer extraction, Streamable HTTP transport
  graph.js            Microsoft Graph client (GET/POST/PATCH/PUT/DELETE, upload/download, search)
  tools/
    index.js          Registers every service module
    util.js           Shared MCP helpers and zod schemas
    mail.js           Outlook Mail tools
    calendar.js       Outlook Calendar tools
    teams.js          Microsoft Teams tools
    onedrive.js       OneDrive tools
    sharepoint.js     SharePoint tools
```

## Example request

```bash
# Health
curl http://localhost:3000/health

# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Configuration

All optional, with production-safe defaults:

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port. |
| `GRAPH_TIMEOUT_MS` | `30000` | Per-attempt timeout for each Graph request. |
| `GRAPH_MAX_RETRIES` | `3` | Extra retries on `429`/`503`/`504` and network/timeout errors (backs off, honoring `Retry-After`). |
| `GRAPH_MAX_TRANSFER_BYTES` | `4194304` (4 MB) | Cap on bytes buffered in memory for a single up/download. |
| `MAX_BODY_SIZE` | `8mb` | Express JSON body limit (headroom for base64-inflated uploads). |

## Testing

```bash
npm test   # node:test runner — pure-helper unit tests + an end-to-end smoke test
```

## Notes

- Uploads (`upload_file`, `upload_to_sharepoint`) use a simple PUT and are
  limited to `GRAPH_MAX_TRANSFER_BYTES` (~4 MB); larger files require a Graph
  upload session. Base64 inflates the request ~33%, so the JSON body limit
  (`MAX_BODY_SIZE`) is set above that.
- Transient Graph failures (throttling/`5xx`/network/timeout) are retried with
  backoff; each attempt is bounded by `GRAPH_TIMEOUT_MS`.
- `search_*` tools use `$search` / the Microsoft Search API and require the
  token to carry the relevant read scopes.
- Graph errors are surfaced as MCP tool errors (`isError: true`) with the HTTP
  status and Graph's message, rather than crashing the request.
- On `SIGTERM`/`SIGINT` the server stops accepting connections and drains
  in-flight requests (10s hard timeout) for clean Kubernetes rollouts.
