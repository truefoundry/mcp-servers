import type { ServiceModule, ToolContext, ToolResult } from '../../types.js';
import { annotateAll } from '../../annotations.js';
import * as sheetsTools from '../../tools/sheets.js';

const toolDefinitions = annotateAll(sheetsTools.toolDefinitions);

async function handleTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  return sheetsTools.handleTool(name, args, ctx);
}

const sheetsService: ServiceModule = {
  key: 'sheets',
  displayName: 'Google Sheets',
  toolDefinitions,
  handleTool,
};

export default sheetsService;
