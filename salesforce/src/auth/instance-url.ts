/**
 * Per-token instance URL discovery.
 *
 * Salesforce access tokens are org-scoped: every API call must hit the user's
 * own subdomain (e.g. `https://acme.my.salesforce.com`) rather than a global
 * endpoint. The TFY LLM Gateway only forwards the bearer token, so we discover
 * the instance URL ourselves by calling the OIDC userinfo endpoint that any
 * valid Salesforce bearer can reach.
 *
 * Discovered values are cached in an LRU keyed by `sha256(token)` for 30 min,
 * so each user pays the ~50ms userinfo round-trip at most twice an hour.
 *
 * If `SF_INSTANCE_URL_HEADER` is set and the request includes that header,
 * we trust it and skip discovery entirely (gateway-side override).
 */

import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { log } from '../auth-ctx.js';

const SF_LOGIN_URL = process.env.SF_LOGIN_URL ?? 'https://login.salesforce.com';

const cache = new LRUCache<string, string>({
  max: 1000,
  ttl: 30 * 60_000,
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface UserinfoResponse {
  sub?: string;
  user_id?: string;
  organization_id?: string;
  urls?: {
    rest?: string;
    enterprise?: string;
    metadata?: string;
    [key: string]: string | undefined;
  };
}

async function fetchInstanceUrl(token: string): Promise<string> {
  const url = `${SF_LOGIN_URL}/services/oauth2/userinfo`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(
      `Salesforce userinfo discovery failed (${resp.status} ${resp.statusText}). ` +
        `Token may be expired or scopes are missing 'id'/'profile'.`,
    );
  }
  const data = (await resp.json()) as UserinfoResponse;
  const restUrl = data.urls?.rest;
  if (!restUrl) {
    throw new Error('Salesforce userinfo response did not include urls.rest');
  }
  return new URL(restUrl).origin;
}

/**
 * Resolve the user's Salesforce instance URL for a bearer token. Cached.
 *
 * If `headerOverride` is provided (e.g. forwarded by the gateway), it is
 * trusted and stored in the cache so subsequent calls avoid the round-trip.
 */
export async function resolveInstanceUrl(
  token: string,
  headerOverride?: string | null,
): Promise<string> {
  const key = hashToken(token);

  if (headerOverride) {
    const normalized = new URL(headerOverride).origin;
    cache.set(key, normalized);
    return normalized;
  }

  const cached = cache.get(key);
  if (cached) return cached;

  log('Discovering Salesforce instance URL via /services/oauth2/userinfo');
  const discovered = await fetchInstanceUrl(token);
  cache.set(key, discovered);
  return discovered;
}
