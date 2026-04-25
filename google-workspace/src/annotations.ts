import type { ToolAnnotations, ToolDefinition } from './types.js';

/**
 * Heuristic classifier for MCP tool annotations based on the tool name prefix.
 *
 * We split write operations into two buckets per the MCP spec:
 *   - additive   : creates new data, leaves existing data untouched
 *                  → readOnlyHint: false, destructiveHint: false (no badge)
 *   - destructive: overwrites or removes existing data
 *                  → destructiveHint: true (UI shows a "Destructive" badge)
 *
 * Read-only operations get readOnlyHint: true ("Read-only" badge).
 * Anything that doesn't match falls back to destructive (the cautious default).
 */

const READONLY_PREFIXES = [
  'list',
  'get',
  'read',
  'search',
  'find',
  'export',
  'download',
  'count',
  'describe',
  'preview',
];

const ADDITIVE_PREFIXES = [
  'create',
  'insert',
  'add',
  'append',
  'upload',
  'uploadfile',
  'share',
];

const DESTRUCTIVE_PREFIXES = [
  'delete',
  'remove',
  'trash',
  'replace',
  'update',
  'move',
  'clear',
  'revoke',
  'archive',
  'rename',
  'unshare',
  'set',
  'format',
  'apply',
  'writefile',
  'batchupdate',
];

/**
 * Explicit overrides for tools whose name prefix misleads the classifier.
 * Keep this list small — prefer renaming the tool over adding an override.
 */
const EXPLICIT_OVERRIDES: Record<string, Partial<ToolAnnotations>> = {
  // Name starts with "find" (read-only prefix) but the tool mutates the doc.
  findAndReplaceInDoc: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
  },
  findAndReplaceInSheet: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
  },
  findAndReplaceInSlides: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
  },
  replaceAllTextInSlides: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
  },
};

function startsWithAny(name: string, prefixes: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return prefixes.some((p) => lower.startsWith(p));
}

export function classifyTool(name: string): ToolAnnotations {
  const override = EXPLICIT_OVERRIDES[name];

  // Check additive BEFORE destructive so e.g. "addPermission" doesn't get
  // caught by something accidental in destructive.
  const isAdditive = startsWithAny(name, ADDITIVE_PREFIXES);
  const isDestructive = !isAdditive && startsWithAny(name, DESTRUCTIVE_PREFIXES);
  const isReadOnly =
    !isAdditive && !isDestructive && startsWithAny(name, READONLY_PREFIXES);

  // All Google Workspace operations ultimately interact with Google's APIs,
  // which are external to the MCP server. openWorldHint = true for everything.
  const base: ToolAnnotations = { openWorldHint: true };

  if (isReadOnly) {
    base.readOnlyHint = true;
    base.destructiveHint = false;
    base.idempotentHint = true;
  } else if (isAdditive) {
    // Additive writes get NO badge: not read-only, not destructive.
    base.readOnlyHint = false;
    base.destructiveHint = false;
    base.idempotentHint = false;
  } else if (isDestructive) {
    base.destructiveHint = true;
    base.readOnlyHint = false;
    base.idempotentHint = false;
  } else {
    // Unknown classification — stay conservative: treat as destructive so the
    // client asks for confirmation rather than silently allowing the call.
    base.destructiveHint = true;
    base.readOnlyHint = false;
    base.idempotentHint = false;
  }

  return { ...base, ...(override ?? {}) };
}

/**
 * Returns a new tool definition with classified annotations merged in.
 * Preserves any `annotations` the author already provided (author wins).
 */
export function withAnnotations(tool: ToolDefinition): ToolDefinition {
  const classified = classifyTool(tool.name);
  return {
    ...tool,
    annotations: { ...classified, ...(tool.annotations ?? {}) },
  };
}

/** Apply `withAnnotations` across an array. */
export function annotateAll(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map(withAnnotations);
}
