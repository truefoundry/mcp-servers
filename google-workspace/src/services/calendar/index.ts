import type { ServiceModule } from '../../types.js';
import { toolDefinitions, handleTool } from './tools.js';

const calendarService: ServiceModule = {
  key: 'calendar',
  displayName: 'Google Calendar',
  toolDefinitions,
  handleTool,
};

export default calendarService;
