import type { ServiceModule } from '../../types.js';
import { toolDefinitions, handleTool } from './tools.js';

const slidesService: ServiceModule = {
  key: 'slides',
  displayName: 'Google Slides',
  toolDefinitions,
  handleTool,
};

export default slidesService;
