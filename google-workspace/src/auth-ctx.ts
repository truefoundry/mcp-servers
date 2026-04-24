/**
 * Per-request auth context shared by all transports.
 *
 * Two distinct paths:
 *
 * 1. HTTP transport (TrueFoundry / multi-tenant deployment):
 *    - Each request carries the end-user's Google access token in the
 *      `Authorization: Bearer <token>` header (forwarded by the TFY LLM Gateway).
 *    - The Express layer copies it onto `req.auth.access_token`, the MCP SDK
 *      surfaces it as `extra.authInfo.access_token` in every handler, and we
 *      build a fresh per-request OAuth2Client from it.
 *    - The OAuth client_id / client_secret (the application's, not the user's)
 *      are loaded once at boot from the mounted gcp-oauth.keys.json file.
 *
 * 2. stdio transport (local dev / single-user CLI):
 *    - We fall back to `authenticate()` which uses service accounts,
 *      pre-obtained refresh tokens, or an interactive browser OAuth flow.
 *    - The resulting client is cached at module level for the process lifetime.
 */

import { OAuth2Client } from 'google-auth-library';
import { authenticate } from './auth.js';
import { loadCredentials } from './auth/client.js';

export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = data ? `[${timestamp}] ${message}: ${JSON.stringify(data)}` : `[${timestamp}] ${message}`;
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

// stdio single-user cache.
let _stdioAuthClient: any = null;
let _stdioAuthPromise: Promise<any> | null = null;

export async function getStdioAuthClient(): Promise<any> {
  if (_stdioAuthClient) return _stdioAuthClient;
  if (_stdioAuthPromise) {
    _stdioAuthClient = await _stdioAuthPromise;
    return _stdioAuthClient;
  }
  log('Initializing stdio authentication');
  _stdioAuthPromise = authenticate();
  try {
    _stdioAuthClient = await _stdioAuthPromise;
    log('stdio authentication complete');
    return _stdioAuthClient;
  } finally {
    _stdioAuthPromise = null;
  }
}

export async function resolveAuthClientForRequest(extra: any): Promise<any> {
  const token = extractAccessToken(extra);
  if (token) {
    const creds = await getClientCreds();
    return buildOAuth2ClientFromAccessToken(token, creds);
  }
  // Fallback: stdio / local dev path. Throws if nothing is configured.
  return getStdioAuthClient();
}

/** Inject a fake auth client for testing — bypasses authenticate(). */
export function _setAuthClientForTesting(client: any): void {
  _stdioAuthClient = client;
  _stdioAuthPromise = null;
}
