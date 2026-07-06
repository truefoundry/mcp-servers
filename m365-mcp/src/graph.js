/**
 * Thin Microsoft Graph API client.
 *
 * The caller's Bearer token is passed straight through to Graph as the
 * Authorization header — this server performs no token exchange or caching.
 *
 * Hardening for production use:
 *  - every request has a wall-clock timeout (AbortController);
 *  - transient failures (429/503/504, network/timeout) are retried with
 *    exponential backoff that honors any Retry-After header;
 *  - up/downloads are capped so a single large file can't OOM the pod.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Per-attempt request timeout (ms). */
const REQUEST_TIMEOUT_MS = Number(process.env.GRAPH_TIMEOUT_MS) || 30_000;
/** Extra attempts after the first for transient failures. */
const MAX_RETRIES = Number(process.env.GRAPH_MAX_RETRIES) || 3;
/** Cap on bytes buffered in memory for a single up/download (simple PUT). */
export const MAX_TRANSFER_BYTES =
  Number(process.env.GRAPH_MAX_TRANSFER_BYTES) || 4 * 1024 * 1024;

/**
 * Error thrown when Graph returns a non-2xx response. Carries the HTTP status
 * so the transport layer can surface meaningful messages to the MCP client.
 */
export class GraphError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.body = body;
  }
}

/** Resolve a path to an absolute Graph URL and apply query params. */
function buildUrl(path, query = {}) {
  const url = new URL(path.startsWith("http") ? path : GRAPH_BASE + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Statuses worth retrying: throttling and transient gateway errors. */
function isRetryable(status) {
  return status === 429 || status === 503 || status === 504;
}

/**
 * Backoff before the next attempt. Honors a Retry-After header (delta-seconds
 * or HTTP date) when present, otherwise exponential backoff with jitter.
 */
function retryDelayMs(res, attempt) {
  const header = res?.headers?.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) return seconds * 1000;
    const when = Date.parse(header);
    if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  }
  return Math.min(2 ** attempt * 500, 10_000) + Math.floor(Math.random() * 250);
}

/** fetch() with a per-attempt timeout via AbortController. */
async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Issue a request with a timeout, retrying transient failures (429/503/504 and
 * network/timeout errors) with backoff. Returns the final Response — which may
 * still be non-2xx for the caller to map. Throws GraphError only when every
 * attempt fails to produce a response.
 */
async function sendWithRetry(url, init) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, init);
    } catch (err) {
      lastError =
        err?.name === "AbortError"
          ? new GraphError(0, `Graph request timed out after ${REQUEST_TIMEOUT_MS}ms`)
          : new GraphError(0, `Network error calling Graph: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(null, attempt));
        continue;
      }
      throw lastError;
    }

    if (isRetryable(res.status) && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }
    return res;
  }
  // Unreachable: the loop either returns a Response or throws above.
  throw lastError ?? new GraphError(0, "Graph request failed");
}

/**
 * Core request helper. Handles auth, JSON (de)serialization and error mapping.
 *
 * @param {string} token   Raw bearer token (no "Bearer " prefix).
 * @param {string} method  HTTP method.
 * @param {string} path    Path beginning with "/" or an absolute URL.
 * @param {object} [opts]
 * @param {Record<string, unknown>} [opts.query]    Query-string params.
 * @param {unknown}                 [opts.body]     JSON request body.
 * @param {Buffer|Uint8Array|string}[opts.rawBody]  Raw body (skips JSON encode).
 * @param {Record<string,string>}   [opts.headers]  Extra request headers.
 */
async function graphRequest(token, method, path, opts = {}) {
  const { query, body, rawBody, headers = {} } = opts;
  const url = buildUrl(path, query);

  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...headers,
    },
  };

  if (rawBody !== undefined) {
    init.body = rawBody;
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await sendWithRetry(url, init);

  // 204 No Content (common for DELETE/PATCH-less updates) — nothing to parse.
  if (res.status === 204) return { status: 204, ok: true };

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const detail =
      json?.error?.message || res.statusText || "Unknown Graph error";
    throw new GraphError(res.status, detail, json);
  }

  return json;
}

export const graphGet = (token, path, query, headers) =>
  graphRequest(token, "GET", path, { query, headers });

export const graphPost = (token, path, body, headers) =>
  graphRequest(token, "POST", path, { body, headers });

export const graphPatch = (token, path, body, headers) =>
  graphRequest(token, "PATCH", path, { body, headers });

export const graphPut = (token, path, body, headers) =>
  graphRequest(token, "PUT", path, { body, headers });

export const graphDelete = (token, path, headers) =>
  graphRequest(token, "DELETE", path, { headers });

/**
 * Query the Microsoft Search API for the given entity types.
 * Powers cross-service SharePoint and Teams search.
 *
 * @param {string} token
 * @param {string[]} entityTypes  e.g. ["driveItem", "listItem", "site"].
 * @param {string} query          KQL / free-text query string.
 * @param {number} [size]         Max results to return.
 */
export function microsoftSearch(token, entityTypes, query, size = 25) {
  return graphPost(token, "/search/query", {
    requests: [
      { entityTypes, query: { queryString: query }, from: 0, size },
    ],
  });
}

/**
 * Upload raw bytes to a Graph drive `.../content` endpoint via PUT.
 * Suitable for small files (< 4 MB); larger files need an upload session.
 *
 * @param {string} token
 * @param {string} path             Drive content path ending in "/content".
 * @param {Buffer|Uint8Array} bytes Raw file bytes.
 * @param {string} [contentType]    MIME type of the upload.
 */
export function graphUpload(token, path, bytes, contentType = "application/octet-stream") {
  if (bytes.length > MAX_TRANSFER_BYTES) {
    throw new GraphError(
      413,
      `File is ${bytes.length} bytes, over the ${MAX_TRANSFER_BYTES}-byte simple-upload limit. ` +
        "Larger files require a Graph upload session.",
    );
  }
  return graphRequest(token, "PUT", path, {
    rawBody: bytes,
    headers: { "Content-Type": contentType },
  });
}

/**
 * Download raw bytes from a Graph `.../content` endpoint and return them
 * base64-encoded, following Graph's redirect to the storage backend.
 *
 * @returns {Promise<{ contentType: string, sizeBytes: number, base64: string }>}
 */
export async function graphDownload(token, path) {
  const res = await sendWithRetry(buildUrl(path), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = res.statusText;
    try {
      detail = JSON.parse(text)?.error?.message || detail;
    } catch {
      /* keep statusText */
    }
    throw new GraphError(res.status, detail);
  }

  // Fast path: reject when the server declares an oversize length up front.
  const declared = Number(res.headers.get("content-length"));
  if (declared && declared > MAX_TRANSFER_BYTES) {
    throw new GraphError(
      413,
      `File is ${declared} bytes, over the ${MAX_TRANSFER_BYTES}-byte download limit. ` +
        "Use a Graph download session for large files.",
    );
  }

  // Don't trust Content-Length alone — storage redirects often omit or
  // misreport it. Stream the body and enforce the cap as bytes arrive so an
  // oversize download can't be fully buffered into memory before the check.
  const chunks = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_TRANSFER_BYTES) {
          throw new GraphError(
            413,
            `File exceeds the ${MAX_TRANSFER_BYTES}-byte download limit. ` +
              "Use a Graph download session for large files.",
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      // Release the connection if we stopped early (e.g. hit the cap).
      await reader.cancel().catch(() => {});
    }
  }

  const buf = Buffer.concat(chunks);
  return {
    contentType: res.headers.get("content-type") || "application/octet-stream",
    sizeBytes: buf.length,
    base64: buf.toString("base64"),
  };
}
