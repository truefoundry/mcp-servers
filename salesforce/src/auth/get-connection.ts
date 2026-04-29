/**
 * Builds a per-request `jsforce.Connection` from the bearer token + instance URL
 * stored in the AsyncLocalStorage scope.
 *
 * No on-disk auth store, no token refresh on the MCP side. If the token is
 * expired Salesforce returns a 401 and the gateway is expected to re-OAuth.
 */

import { Connection } from 'jsforce/lib/connection.js';
import 'jsforce/lib/api/tooling.js';
import { requestContext } from '../auth-ctx.js';

export type SalesforceConnection = Connection;

const SF_API_VERSION = process.env.SF_API_VERSION ?? '62.0';

export function getConnection(): SalesforceConnection {
  const ctx = requestContext.getStore();
  if (!ctx) {
    throw new Error(
      'No request auth context. The Salesforce MCP server requires an ' +
        'Authorization: Bearer <token> header (forwarded by the TFY LLM Gateway).',
    );
  }
  return new Connection({
    instanceUrl: ctx.instanceUrl,
    accessToken: ctx.accessToken,
    version: SF_API_VERSION,
  });
}
