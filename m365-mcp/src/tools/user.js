/**
 * Signed-in user tools (Microsoft Graph /me).
 */

import { graphGet } from "../graph.js";
import { runTool } from "./util.js";

const USER_SELECT =
  "id,displayName,givenName,surname,userPrincipalName,mail,jobTitle," +
  "department,officeLocation,mobilePhone,businessPhones,preferredLanguage";

export function registerUserTools(server, token) {
  server.tool(
    "get_current_user",
    "Get the signed-in user's profile (name, email, job title, department). " +
      "Useful for resolving who 'me' is before calling other tools.",
    {},
    runTool(() => graphGet(token, "/me", { $select: USER_SELECT })),
  );
}
