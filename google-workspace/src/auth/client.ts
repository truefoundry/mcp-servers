/**
 * Loads the application's Google OAuth client credentials (client_id +
 * client_secret) from a mounted JSON file.
 *
 * In production this file is mounted by Truefoundry at /app/gcp.json (path
 * configured via GOOGLE_DRIVE_OAUTH_CREDENTIALS / GOOGLE_WORKSPACE_OAUTH_CREDENTIALS).
 * Per-request user access tokens are NOT stored here — they arrive on the
 * Authorization header and are consumed by `auth-ctx.ts`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface OAuthCredentials {
  client_id: string;
  client_secret?: string;
}

function getKeysFilePaths(): string[] {
  const paths: string[] = [];

  const envPath =
    process.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS ||
    process.env.GOOGLE_WORKSPACE_OAUTH_CREDENTIALS;
  if (envPath) {
    paths.push(path.resolve(envPath));
  }

  // Production default (mounted by Truefoundry).
  paths.push('/app/gcp.json');

  return paths;
}

function parseCredentialsFile(keys: Record<string, unknown>): OAuthCredentials {
  if (keys.installed) {
    const { client_id, client_secret } = keys.installed as OAuthCredentials;
    return { client_id, client_secret };
  }
  if (keys.web) {
    const { client_id, client_secret } = keys.web as OAuthCredentials;
    return { client_id, client_secret };
  }
  if (keys.client_id) {
    return {
      client_id: keys.client_id as string,
      client_secret: keys.client_secret as string | undefined,
    };
  }
  throw new Error(
    'Invalid credentials file format. Expected "installed", "web", or top-level "client_id".',
  );
}

export async function loadCredentials(): Promise<OAuthCredentials> {
  const paths = getKeysFilePaths();
  let lastErr: unknown = null;

  for (const keysPath of paths) {
    try {
      const content = await fs.readFile(keysPath, 'utf-8');
      const parsed = parseCredentialsFile(JSON.parse(content));
      if (!parsed.client_id) {
        throw new Error(`client_id missing in credentials at ${keysPath}`);
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      // Try next path if this one is missing / unreadable.
    }
  }

  throw new Error(
    `Could not load Google OAuth credentials. Searched: ${paths.join(', ')}. ` +
      `Set GOOGLE_DRIVE_OAUTH_CREDENTIALS to the absolute path of your gcp-oauth.keys.json. ` +
      `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
