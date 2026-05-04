# Salesforce MCP Server

A single Node.js service that exposes Salesforce as an MCP endpoint behind the TrueFoundry LLM Gateway, with **per-user OAuth** — every request runs as the calling user against their own Salesforce org.

```text
     TFY LLM Gateway
          |
   +------+--------+
   |  OAuth 2.0    |  (Salesforce Connected App, Web Server Flow)
   |  per user     |
   +------+--------+
          | Authorization: Bearer <user access token>
          |
          v
 +----------------------------------------------+
 |          salesforce-mcp pod                  |
 |                                              |
 |  /health                                     |
 |  /mcp           -> 10 generic SF tools       |
 +----------------------------------------------+
```

## Tools

10 generic primitives that work against any SObject (standard or custom). The tool names match the verbs an LLM would use; we deliberately avoid one-tool-per-object explosion.

| Tool                    | Category | What it does                                                                       |
| ----------------------- | -------- | ---------------------------------------------------------------------------------- |
| `run_soql_query`        | Read     | Run any SOQL. Set `useToolingApi: true` for metadata objects (ApexClass, Flow, …). |
| `run_sosl_search`       | Read     | Cross-object full-text search via SOSL.                                            |
| `get_record`            | Read     | Retrieve one record by Id; optional field projection.                              |
| `list_sobjects`         | Read     | Catalog SObjects in the org with capability flags. `customOnly` filter available.  |
| `describe_object`       | Read     | Field metadata: types, picklist values, reference targets, createable/updateable.  |
| `create_record`         | Write    | Insert into any SObject.                                                           |
| `update_record`         | Write    | Patch a record by Id.                                                              |
| `upsert_by_external_id` | Write    | Insert-or-update keyed on a custom External Id field.                              |
| `delete_record`         | Write    | Soft-delete (Recycle Bin).                                                         |
| `run_apex_anonymous`    | Power    | Escape hatch — execute anonymous Apex via the Tooling API.                         |

## Architecture

- **One Node process, one MCP endpoint.** `POST /mcp` opens a session bound to a `StreamableHTTPServerTransport`. `tools/list` advertises the 10 tools above.
- **Per-request OAuth (multi-tenant).** Every request must carry the end-user's Salesforce access token in `Authorization: Bearer ...`. The TFY Gateway runs the OAuth Web Server Flow and forwards the token. The server has no local OAuth flow, no on-disk token storage, no service-account fallback.
- **Per-request `instance_url` discovery.** Salesforce access tokens are org-scoped; each org lives at its own subdomain. We discover the user's `instance_url` via `/services/oauth2/userinfo` and cache it in an LRU keyed by `sha256(token)` for 30 min. If the gateway can forward the value as a header, set `SF_INSTANCE_URL_HEADER` to skip discovery.
- **`AsyncLocalStorage` request scope.** The bearer + instance URL live in an ALS scope for the duration of the request, so tool handlers can call `getConnection()` without threading auth through their signatures.

## Repository layout

```
src/
  index.ts                # CLI (HTTP transport only)
  server.ts               # MCP server factory + all 10 tool definitions and handlers
  auth-ctx.ts             # AsyncLocalStorage<{accessToken, instanceUrl}>
  auth/
    get-connection.ts     # Builds jsforce.Connection from ALS context (loads tooling API)
    instance-url.ts       # /services/oauth2/userinfo + LRU cache
  transports/
    http.ts               # Express, bearer middleware, ALS scope, /mcp + /health
Dockerfile
deploy.py                 # TrueFoundry LocalSource(local_build=False) deploy
scripts/build.js          # esbuild bundle to dist/index.js
```

## Salesforce Connected App setup

You need a Salesforce Connected App so the TFY Gateway has a Client ID / Client Secret to run the OAuth Web Server Flow with. You only do this once per Salesforce org.

### Step 1: Create the Connected App

1. Log into Salesforce as an admin.
2. **Setup** (gear icon, top right) → search **External Client App Manager** in the left rail.
3. Click **New External Client App**.
4. Fill the basics:
   - **External Client App Name**: `TrueFoundry MCP` (anything human-readable)
   - **API Name**: auto-fills
   - **Contact Email**: yours
   - **Distribution State**: Local

### Step 2: Enable OAuth and configure scopes

In the same form, scroll to **API (Enable OAuth Settings)** and check **Enable OAuth**. Then:

- **Callback URL**:
  ```
  https://<your-tfy-control-plane>/api/svc/v1/llm-gateway/mcp-servers/oauth2/callback
  ```
  (e.g. `https://internal.devtest.truefoundry.tech/api/svc/v1/llm-gateway/mcp-servers/oauth2/callback`)

- **Selected OAuth Scopes** (move all three to the right pane):
  - `Manage user data via APIs (api)`
  - `Perform requests at any time (refresh_token, offline_access)`
  - `Access the Identity URL service (id, profile, email, address, phone)` ← **required**, otherwise `instance_url` discovery returns 403

- **Flow Enablement**:
  - Check **Enable Authorization Code and Credentials Flow** (this is the Web Server Flow)

- **Security**:
  - Check **Require secret for Web Server Flow**
  - Check **Require secret for Refresh Token Flow**

Click **Create**.

### Step 3: Copy the Client ID and Client Secret

After creation, the app opens. Then:

1. Click the **Settings** tab (top of the app page).
2. Expand **OAuth Settings**.
3. Find **Consumer Key and Secret** → click **Manage Consumer Details**.
4. Salesforce will email or text you a verification code. Enter it.
5. You'll see two values — copy both:
   - **Consumer Key**  → this is your **Client ID**
   - **Consumer Secret** → this is your **Client Secret**

> **Treat the Consumer Secret like a password.** Don't paste it in chat, commits, or screenshots. If it leaks, come back to **Manage Consumer Details** and click **Reset** to mint a new one.

### Step 4: Set policies (one-time)

Still on the app page → **Policies** tab:

- **Permitted Users**: `All users may self-authorize`
- **IP Relaxation**: `Relax IP restrictions`
- **Refresh Token Policy**: `Refresh token is valid until revoked`

Save.

### Step 5: Plug into the TFY Gateway

The Client ID and Client Secret go into the **TFY LLM Gateway → MCP server registration form**, not into this pod. The pod itself never sees them — it only ever sees the per-user access token the gateway forwards. Use this scopes string in the gateway form:

```
api refresh_token offline_access id profile email
```

## Deploying to TrueFoundry

```bash
tfy login --host https://internal.devtest.truefoundry.tech
python deploy.py
```

`deploy.py` uses `LocalSource(local_build=False)`, so TrueFoundry zips this folder (respecting `.dockerignore`), uploads it, builds the image remotely, and deploys.

After deploy:

```bash
curl https://salesforce-mcp-a2a-3000.<your-tfy-domain>/health
```

Should return:

```json
{
  "status": "healthy",
  "server": "salesforce-mcp",
  "version": "0.1.0",
  "timestamp": "..."
}
```

## Registering the MCP server in the TFY Gateway

Create one MCP server registration in the TrueFoundry LLM Gateway UI:

| Field             | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Name              | `salesforce`                                                                   |
| Server URL        | `https://salesforce-mcp-a2a-3000.<tfy-domain>/mcp`                             |
| Auth type         | OAuth 2.0                                                                      |
| Authorization URL | `https://login.salesforce.com/services/oauth2/authorize` (or `test.salesforce.com` for sandbox) |
| Token URL         | `https://login.salesforce.com/services/oauth2/token`                           |
| Client ID         | Consumer Key from your Salesforce Connected App                                |
| Client Secret     | Consumer Secret from your Salesforce Connected App                             |
| Scopes            | `api refresh_token offline_access id profile email`                            |
| PKCE              | S256                                                                           |

The `id`/`profile`/`email` scopes are required so the userinfo endpoint can return `urls.rest` for instance discovery.

## How the per-request auth works

1. End user hits TFY Gateway -> Gateway redirects through Salesforce OAuth using your Connected App.
2. Gateway stores the access token per-user.
3. On every MCP call, Gateway forwards `https://.../mcp` with `Authorization: Bearer <that user's access token>`.
4. `src/transports/http.ts` extracts the bearer.
5. `src/auth/instance-url.ts` resolves the user's `instance_url` (cached lookup against `/services/oauth2/userinfo`).
6. The request enters an `AsyncLocalStorage` scope holding `{ accessToken, instanceUrl }`.
7. Each tool handler calls `getConnection()` -> reads from ALS -> builds a `jsforce.Connection` pinned to API version `SF_API_VERSION` (default `62.0`) -> calls the relevant jsforce method (`conn.query`, `conn.sobject(name).create`, `conn.tooling.executeAnonymous`, etc.).
8. Token expiry surfaces as a Salesforce 401, which the gateway should treat as "re-OAuth".

## Why this server uses `jsforce` instead of `@salesforce/core`

`@salesforce/core` is the canonical Salesforce SDK and what upstream `@salesforce/mcp-provider-dx-core` uses, but it pulls in oclif, telemetry, a config aggregator that reads `~/.sfdx`, and a project-loading layer — none of which fit a stateless multi-tenant pod.

`jsforce` is the lightweight REST client `@salesforce/core.Connection` extends. For SOQL queries (and most data-toolset operations) we only need:

```ts
new jsforce.Connection({ instanceUrl, accessToken });
```

If we later want to register upstream tools that depend on `@salesforce/core`, we'd add it back and patch the `Services.getOrgService().getConnection()` chokepoint to read from the same ALS scope.

## Why we don't reuse upstream tools

The upstream `@salesforce/mcp-provider-dx-core` tools call `process.chdir(input.directory)`, which mutates process-global state and races under concurrent HTTP requests. They also require `usernameOrAlias` from the LLM, which is meaningless when the org identity is determined by the bearer token. Each tool reimplementation here is a one-line jsforce call wrapped by a uniform `makeHandler` that does Zod validation, error formatting, and JSON serialization.
