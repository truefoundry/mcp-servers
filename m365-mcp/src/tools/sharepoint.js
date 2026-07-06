/**
 * SharePoint tools (Microsoft Graph /sites + Microsoft Search API).
 */

import { z } from "zod";
import {
  graphGet,
  graphPost,
  graphPatch,
  graphUpload,
  microsoftSearch,
} from "../graph.js";
import { runTool, odataString, siteId } from "./util.js";

export function registerSharePointTools(server, token) {
  server.tool(
    "search_sharepoint",
    "Full-text search across SharePoint sites, lists, and documents in the " +
      "tenant via the Microsoft Search API.",
    { query: z.string().describe("Search term for SharePoint content.") },
    runTool(({ query }) =>
      microsoftSearch(token, ["driveItem", "listItem", "site"], query),
    ),
  );

  server.tool(
    "list_sites",
    "List/search SharePoint sites in the tenant.",
    {
      query: z
        .string()
        .optional()
        .describe("Keyword to match site names. Omit to list all sites."),
    },
    runTool(({ query }) =>
      graphGet(token, "/sites", {
        search: query ?? "*",
        $select: "id,name,displayName,webUrl,description",
      }),
    ),
  );

  server.tool(
    "get_site",
    "Get details for a SharePoint site by id or hostname:path.",
    {
      site_id: z
        .string()
        .describe(
          "Site id, or hostname + path (e.g. contoso.sharepoint.com:/sites/Team).",
        ),
    },
    runTool(({ site_id }) =>
      graphGet(token, `/sites/${siteId(site_id)}`),
    ),
  );

  server.tool(
    "list_libraries",
    "List the document libraries (drives) in a SharePoint site.",
    { site_id: z.string().describe("The SharePoint site id.") },
    runTool(({ site_id }) =>
      graphGet(token, `/sites/${siteId(site_id)}/drives`, {
        $select: "id,name,webUrl,driveType,quota",
      }),
    ),
  );

  server.tool(
    "list_items",
    "List items in a SharePoint list, expanding their field values.",
    {
      site_id: z.string().describe("The SharePoint site id."),
      list_id: z.string().describe("The list id."),
      top: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max items to return (default 50)."),
    },
    runTool(({ site_id, list_id, top }) =>
      graphGet(
        token,
        `/sites/${siteId(site_id)}/lists/${odataString(list_id)}/items`,
        { $expand: "fields", $top: top ?? 50 },
      ),
    ),
  );

  server.tool(
    "get_item",
    "Get a single SharePoint list item, including its field values.",
    {
      site_id: z.string().describe("The SharePoint site id."),
      list_id: z.string().describe("The list id."),
      item_id: z.string().describe("The list item id."),
    },
    runTool(({ site_id, list_id, item_id }) =>
      graphGet(
        token,
        `/sites/${siteId(site_id)}/lists/${odataString(list_id)}/items/${odataString(item_id)}`,
        { $expand: "fields" },
      ),
    ),
  );

  server.tool(
    "create_item",
    "Create a new item in a SharePoint list.",
    {
      site_id: z.string().describe("The SharePoint site id."),
      list_id: z.string().describe("The list id."),
      fields: z
        .record(z.any())
        .describe("Object of column internal-name -> value pairs."),
    },
    runTool(({ site_id, list_id, fields }) =>
      graphPost(
        token,
        `/sites/${siteId(site_id)}/lists/${odataString(list_id)}/items`,
        { fields },
      ),
    ),
  );

  server.tool(
    "update_item",
    "Update field values on an existing SharePoint list item.",
    {
      site_id: z.string().describe("The SharePoint site id."),
      list_id: z.string().describe("The list id."),
      item_id: z.string().describe("The list item id."),
      fields: z
        .record(z.any())
        .describe("Object of column internal-name -> new value pairs."),
    },
    runTool(({ site_id, list_id, item_id, fields }) =>
      graphPatch(
        token,
        `/sites/${siteId(site_id)}/lists/${odataString(list_id)}/items/${odataString(item_id)}/fields`,
        fields,
      ),
    ),
  );

  server.tool(
    "upload_to_sharepoint",
    "Upload a small file (< 4 MB) to a SharePoint site's document library. " +
      "Content must be base64-encoded.",
    {
      site_id: z.string().describe("The SharePoint site id."),
      name: z.string().describe("File name, including extension."),
      content_base64: z.string().describe("Base64-encoded file content."),
      folder_path: z
        .string()
        .optional()
        .describe("Folder path within the library (e.g. 'Reports/2024')."),
      drive_id: z
        .string()
        .optional()
        .describe("Target library/drive id. Defaults to the site's drive."),
      content_type: z
        .string()
        .optional()
        .describe("MIME type (default application/octet-stream)."),
    },
    runTool(({ site_id, name, content_base64, folder_path, drive_id, content_type }) => {
      const bytes = Buffer.from(content_base64, "base64");
      const driveBase = drive_id
        ? `/drives/${odataString(drive_id)}`
        : `/sites/${siteId(site_id)}/drive`;
      const prefix = folder_path
        ? folder_path
            .split("/")
            .filter(Boolean)
            .map(odataString)
            .join("/") + "/"
        : "";
      const path = `${driveBase}/root:/${prefix}${odataString(name)}:/content`;
      return graphUpload(token, path, bytes, content_type);
    }),
  );
}
