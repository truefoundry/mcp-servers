/**
 * OneDrive tools (Microsoft Graph /me/drive).
 */

import { z } from "zod";
import {
  graphGet,
  graphPost,
  graphPatch,
  graphDelete,
  graphUpload,
  graphDownload,
} from "../graph.js";
import { runTool, odataString } from "./util.js";

const ITEM_SELECT =
  "id,name,webUrl,size,lastModifiedDateTime,createdDateTime,file,folder,parentReference";

/** Resolve a drive-item reference (id or path) to a Graph addressing segment. */
function itemRef(id) {
  return `/me/drive/items/${odataString(id)}`;
}

export function registerOneDriveTools(server, token) {
  server.tool(
    "list_files",
    "List files and folders within a OneDrive folder (the root by default).",
    {
      folder_id: z
        .string()
        .optional()
        .describe("Folder item id. Omit to list the drive root."),
      top: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max items to return (default 50)."),
    },
    runTool(({ folder_id, top }) => {
      const base = folder_id
        ? `${itemRef(folder_id)}/children`
        : "/me/drive/root/children";
      return graphGet(token, base, { $top: top ?? 50, $select: ITEM_SELECT });
    }),
  );

  server.tool(
    "search_files",
    "Search files in the signed-in user's OneDrive by name or content.",
    { query: z.string().describe("Search term for file names and content.") },
    runTool(({ query }) =>
      graphGet(token, `/me/drive/root/search(q='${odataString(query)}')`, {
        $top: 25,
        $select: ITEM_SELECT,
      }),
    ),
  );

  server.tool(
    "get_file",
    "Get metadata for a OneDrive file or folder by id.",
    { item_id: z.string().describe("The drive item id.") },
    runTool(({ item_id }) =>
      graphGet(token, itemRef(item_id), { $select: ITEM_SELECT }),
    ),
  );

  server.tool(
    "download_file",
    "Download a OneDrive file's content, returned base64-encoded.",
    { item_id: z.string().describe("The drive item id to download.") },
    runTool(({ item_id }) => graphDownload(token, `${itemRef(item_id)}/content`)),
  );

  server.tool(
    "upload_file",
    "Upload a small file (< 4 MB) to OneDrive. Content must be base64-encoded.",
    {
      name: z.string().describe("File name, including extension."),
      content_base64: z.string().describe("Base64-encoded file content."),
      parent_id: z
        .string()
        .optional()
        .describe("Parent folder id. Omit to upload to the drive root."),
      content_type: z
        .string()
        .optional()
        .describe("MIME type (default application/octet-stream)."),
    },
    runTool(({ name, content_base64, parent_id, content_type }) => {
      const bytes = Buffer.from(content_base64, "base64");
      const safeName = odataString(name);
      const path = parent_id
        ? `${itemRef(parent_id)}:/${safeName}:/content`
        : `/me/drive/root:/${safeName}:/content`;
      return graphUpload(token, path, bytes, content_type);
    }),
  );

  server.tool(
    "create_folder",
    "Create a new folder in OneDrive.",
    {
      name: z.string().describe("Folder name."),
      parent_id: z
        .string()
        .optional()
        .describe("Parent folder id. Omit to create under the drive root."),
    },
    runTool(({ name, parent_id }) => {
      const base = parent_id
        ? `${itemRef(parent_id)}/children`
        : "/me/drive/root/children";
      return graphPost(token, base, {
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      });
    }),
  );

  server.tool(
    "delete_file",
    "Delete a OneDrive file or folder by id.",
    { item_id: z.string().describe("The drive item id to delete.") },
    runTool(async ({ item_id }) => {
      await graphDelete(token, itemRef(item_id));
      return { status: "deleted", item_id };
    }),
  );

  server.tool(
    "move_file",
    "Move (and optionally rename) a OneDrive file or folder.",
    {
      item_id: z.string().describe("The drive item id to move."),
      destination_parent_id: z
        .string()
        .describe("Id of the destination folder."),
      new_name: z.string().optional().describe("Optional new name."),
    },
    runTool(({ item_id, destination_parent_id, new_name }) => {
      const body = { parentReference: { id: destination_parent_id } };
      if (new_name) body.name = new_name;
      return graphPatch(token, itemRef(item_id), body);
    }),
  );

  server.tool(
    "share_file",
    "Create a sharing link for a OneDrive file or folder.",
    {
      item_id: z.string().describe("The drive item id to share."),
      link_type: z
        .enum(["view", "edit", "embed"])
        .optional()
        .describe("Permission level of the link (default 'view')."),
      scope: z
        .enum(["anonymous", "organization"])
        .optional()
        .describe("Link audience (default 'organization')."),
    },
    runTool(({ item_id, link_type, scope }) =>
      graphPost(token, `${itemRef(item_id)}/createLink`, {
        type: link_type || "view",
        scope: scope || "organization",
      }),
    ),
  );
}
