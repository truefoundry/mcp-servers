import type { ServiceModule } from '../../types.js';
import { toolDefinitions, handleTool } from './tools.js';

const gmailService: ServiceModule = {
  key: 'gmail',
  displayName: 'Gmail',
  toolDefinitions,
  handleTool,
};

export default gmailService;
