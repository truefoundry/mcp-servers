/**
 * Per-request auth context.
 *
 * Every incoming MCP request must carry the end-user's Salesforce access token
 * in the `Authorization: Bearer <token>` header. The Express layer:
 *   1. Extracts the bearer.
 *   2. Resolves the user's `instance_url` (org-specific Salesforce host) via
 *      the OIDC userinfo endpoint, with an LRU cache keyed by token hash.
 *   3. Enters an `AsyncLocalStorage` scope holding `{ accessToken, instanceUrl }`
 *      so any tool handler downstream can build a `jsforce.Connection` without
 *      needing to thread the values through function signatures.
 *
 * The TrueFoundry LLM Gateway runs the Salesforce OAuth dance and forwards the
 * per-user access token. There is no on-disk auth store, no service account,
 * and no shared identity.
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface RequestAuthContext {
  accessToken: string;
  instanceUrl: string;
}

export const requestContext = new AsyncLocalStorage<RequestAuthContext>();

export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] ${message}`;
  console.error(line);
}

export function extractBearerToken(authHeader: string | string[] | undefined): string | null {
  if (!authHeader) return null;
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw) return null;
  let token = raw.trim();
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  }
  return token || null;
}
