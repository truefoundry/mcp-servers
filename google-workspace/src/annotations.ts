import type { ToolAnnotations, ToolDefinition } from './types.js';

/**
 * Heuristic classifier for MCP tool annotations based on the tool name prefix.
 *
 * A tool is classified as destructive if its name matches any "write" verb,
 * read-only if it matches any read verb, and neither when it doesn't match.
 * Conflicts (e.g. `findAndReplaceInDoc` matches both) are resolved in favour
 * of destructive — data changes always take precedence over the read hint.
 */

// Order matters: keep "write" prefixes here. Kept case-insensitive.
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
  'set',
  'insert',
  'create',
  'append',
  'batchupdate',
  'rename',
  'share',
  'unshare',
  'writefile',
  'uploadfile',
  'upload',
  'apply',
  'format',
  'add',
];

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
  'authgetstatus',
  'authliststatus',
  'authlistscopes',
];

/**
 * Explicit overrides for tools whose name prefix misleads the classifier.
 * `findAndReplaceInDoc` starts with "find" but mutates the document; flag it
 * as destructive.
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
  const isDestructive = startsWithAny(name, DESTRUCTIVE_PREFIXES);
  const isReadOnly = !isDestructive && startsWithAny(name, READONLY_PREFIXES);

  const base: ToolAnnotations = {
    // All Google Workspace operations ultimately interact with Google's APIs,
    // which are external to the MCP server. openWorldHint = true for everything.
    openWorldHint: true,
  };

  if (isDestructive) {
    base.destructiveHint = true;
    base.readOnlyHint = false;
    // Most destructive Google ops are NOT idempotent (e.g. appendRow, insertText).
    // A handful (setPermission, setCellValue) are; callers can override.
    base.idempotentHint = false;
  } else if (isReadOnly) {
    base.readOnlyHint = true;
    base.destructiveHint = false;
    base.idempotentHint = true;
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
