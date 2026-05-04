import type { ServiceModule } from '../../types.js';
import { toolDefinitions, handleTool } from './tools.js';

const docsService: ServiceModule = {
  key: 'docs',
  displayName: 'Google Docs',
  toolDefinitions,
  handleTool,
};

export default docsService;
