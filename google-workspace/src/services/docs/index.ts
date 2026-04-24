import type { ServiceModule, ToolContext, ToolResult } from '../../types.js';
import { annotateAll } from '../../annotations.js';
import * as docsTools from '../../tools/docs.js';

const toolDefinitions = annotateAll(docsTools.toolDefinitions);

async function handleTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  return docsTools.handleTool(name, args, ctx);
}

const docsService: ServiceModule = {
  key: 'docs',
  displayName: 'Google Docs',
  toolDefinitions,
  handleTool,
};

export default docsService;
