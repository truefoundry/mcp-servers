/**
 * Per-request auth context.
 *
 * Every incoming MCP request must carry the end-user's Google access token in
 * the `Authorization: Bearer <token>` header. The Express layer copies it
 * onto `req.auth.access_token`, the MCP SDK surfaces it as
 * `extra.authInfo.access_token` in every handler, and we build a fresh
 * per-request OAuth2Client from it.
 *
 * The OAuth client_id / client_secret (the application's, not the user's)
 * are loaded once at boot from the mounted gcp-oauth.keys.json file.
 */

import { OAuth2Client } from 'google-auth-library';
import { loadCredentials } from './auth/client.js';

export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] ${message}`;
  console.error(line);
}

let cachedClientCreds: { client_id: string; client_secret?: string } | null = null;
let clientCredsLoadPromise: Promise<{ client_id: string; client_secret?: string }> | null = null;

export async function getClientCreds(): Promise<{ client_id: string; client_secret?: string }> {
  if (cachedClientCreds) return cachedClientCreds;
  if (clientCredsLoadPromise) return clientCredsLoadPromise;
  clientCredsLoadPromise = loadCredentials().then((creds) => {
    cachedClientCreds = creds;
    log('Loaded OAuth client credentials for per-request token mode');
    return creds;
  });
  return clientCredsLoadPromise;
}

export function buildOAuth2ClientFromAccessToken(
  accessToken: string,
  creds: { client_id: string; client_secret?: string },
): OAuth2Client {
  const c = new OAuth2Client({
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
  });
  c.setCredentials({ access_token: accessToken });
  return c;
}

export function extractAccessToken(extra: any): string | null {
  const a = extra?.authInfo;
  if (!a) return null;
  let token: string | undefined = a.access_token || a.token;
  if (!token || typeof token !== 'string') return null;
  if (token.startsWith('Bearer ')) token = token.slice(7);
  if (token.startsWith('bearer ')) token = token.slice(7);
  return token.trim() || null;
}

export async function resolveAuthClientForRequest(extra: any): Promise<OAuth2Client> {
  const token = extractAccessToken(extra);
  if (!token) {
    throw new Error(
      'No access token on request. The MCP server requires an Authorization: Bearer <token> header (forwarded by the TFY LLM Gateway).',
    );
  }
  const creds = await getClientCreds();
  return buildOAuth2ClientFromAccessToken(token, creds);
}
