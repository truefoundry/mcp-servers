/**
 * Shared helpers and zod schemas for the Microsoft 365 tool modules.
 */

import { z } from "zod";
import { GraphError } from "../graph.js";

/** Build a successful MCP tool result from data (object -> pretty JSON). */
export function ok(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/**
 * Wrap an async tool handler so Graph/runtime failures become readable MCP
 * tool errors instead of throwing out of the transport.
 */
export function runTool(handler) {
  return async (args) => {
    try {
      return ok(await handler(args ?? {}));
    } catch (err) {
      const message =
        err instanceof GraphError
          ? `Graph API error (${err.status}): ${err.message}`
          : `Unexpected error: ${err.message}`;
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  };
}

/** Encode a value for safe inclusion inside an OData single-quoted literal. */
export function odataString(value) {
  return encodeURIComponent(String(value).replace(/'/g, "''"));
}

/**
 * Encode a SharePoint site identifier for use as a URL path segment.
 *
 * Unlike {@link odataString}, this preserves the ':' '/' and ',' that Graph
 * uses structurally in the two site-id forms — hostname:path
 * (e.g. contoso.sharepoint.com:/sites/Team) and the composite
 * host,siteCollectionId,siteId — while still escaping spaces and other unsafe
 * characters.
 */
export function siteId(value) {
  return encodeURI(String(value));
}

/**
 * Quote a value as a Graph `$search` phrase. The expression is wrapped in
 * double quotes, so embedded double quotes would break the query — collapse
 * them to spaces rather than emit malformed KQL.
 */
export function searchPhrase(value) {
  return `"${String(value).replace(/"/g, " ").trim()}"`;
}

// ---- Reusable schema fragments -------------------------------------------

export const dateRangeSchema = z
  .object({
    start: z
      .string()
      .optional()
      .describe("Inclusive start date/time, ISO 8601 (e.g. 2024-01-01)."),
    end: z
      .string()
      .optional()
      .describe("Inclusive end date/time, ISO 8601 (e.g. 2024-12-31)."),
  })
  .optional()
  .describe("Optional date range filter.");

export const recipientsSchema = z
  .array(z.string())
  .describe("List of recipient email addresses.");

export const bodySchema = z
  .object({
    content: z.string().describe("Message body content."),
    contentType: z
      .enum(["text", "html"])
      .optional()
      .describe("Body content type. Defaults to 'text'."),
  })
  .describe("Message body.");

/** Map a list of email strings to Graph recipient objects. */
export function toRecipients(addresses = []) {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

/** Build a KQL fragment for an optional date range against a date property. */
export function dateRangeKql(property, range) {
  if (!range) return "";
  const parts = [];
  if (range.start) parts.push(`${property}>=${range.start}`);
  if (range.end) parts.push(`${property}<=${range.end}`);
  return parts.join(" AND ");
}
