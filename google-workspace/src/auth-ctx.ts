/**
 * Per-request auth context.
 *
 * Every incoming MCP request must carry the end-user's Google access token in
 * the `Authorization: Bearer <token>` header. The Express layer copies it
 * onto `req.auth.access_token`, the MCP SDK surfaces it as
 * `extra.authInfo.access_token` in every handler, and we build a fresh
 * per-request OAuth2Client from it.
 *
 * OAuth consent and token refresh are handled by the TFY LLM Gateway; this
 * server only attaches the forwarded access token to googleapis calls.
 */

import { OAuth2Client } from 'google-auth-library';

export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] ${message}`;
  console.error(line);
}

export function buildOAuth2ClientFromAccessToken(accessToken: string): OAuth2Client {
  const client = new OAuth2Client();
  client.setCredentials({ access_token: accessToken });
  return client;
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

export function resolveAuthClientForRequest(extra: any): OAuth2Client {
  const token = extractAccessToken(extra);
  if (!token) {
    throw new Error(
      'No access token on request. The MCP server requires an Authorization: Bearer <token> header (forwarded by the TFY LLM Gateway).',
    );
  }
  return buildOAuth2ClientFromAccessToken(token);
}
