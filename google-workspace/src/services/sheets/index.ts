import type { ServiceModule } from '../../types.js';
import { toolDefinitions, handleTool } from './tools.js';

const sheetsService: ServiceModule = {
  key: 'sheets',
  displayName: 'Google Sheets',
  toolDefinitions,
  handleTool,
};

export default sheetsService;
