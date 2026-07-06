/**
 * Aggregates all Microsoft 365 tool modules onto an McpServer instance.
 *
 * Every tool closes over the caller's bearer `token` so each Graph call runs
 * on behalf of the requesting user.
 */

import { registerMailTools } from "./mail.js";
import { registerCalendarTools } from "./calendar.js";
import { registerTeamsTools } from "./teams.js";
import { registerOneDriveTools } from "./onedrive.js";
import { registerSharePointTools } from "./sharepoint.js";

export function registerTools(server, token) {
  registerMailTools(server, token);
  registerCalendarTools(server, token);
  registerTeamsTools(server, token);
  registerOneDriveTools(server, token);
  registerSharePointTools(server, token);
}
