import type { ServiceModule, ToolContext, ToolResult } from '../../types.js';
import { annotateAll } from '../../annotations.js';
import * as slidesTools from '../../tools/slides.js';

const toolDefinitions = annotateAll(slidesTools.toolDefinitions);

async function handleTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  return slidesTools.handleTool(name, args, ctx);
}

const slidesService: ServiceModule = {
  key: 'slides',
  displayName: 'Google Slides',
  toolDefinitions,
  handleTool,
};

export default slidesService;
