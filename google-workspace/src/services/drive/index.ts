import type { ServiceModule } from '../../types.js';
import { toolDefinitions, handleTool } from './tools.js';

const driveService: ServiceModule = {
  key: 'drive',
  displayName: 'Google Drive',
  toolDefinitions,
  handleTool,
};

export default driveService;
