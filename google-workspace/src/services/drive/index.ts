import type { ServiceModule, ToolContext, ToolResult } from '../../types.js';
import { annotateAll } from '../../annotations.js';
import * as driveTools from '../../tools/drive.js';

const toolDefinitions = annotateAll(driveTools.toolDefinitions);

async function handleTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  return driveTools.handleTool(name, args, ctx);
}

const driveService: ServiceModule = {
  key: 'drive',
  displayName: 'Google Drive',
  toolDefinitions,
  handleTool,
};

export default driveService;
