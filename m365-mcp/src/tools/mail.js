/**
 * Outlook Mail tools (Microsoft Graph /me/messages, /me/mailFolders).
 */

import { z } from "zod";
import {
  graphGet,
  graphPost,
  graphPatch,
  graphDelete,
} from "../graph.js";
import {
  runTool,
  dateRangeSchema,
  dateRangeKql,
  recipientsSchema,
  bodySchema,
  toRecipients,
  odataString,
  searchPhrase,
} from "./util.js";

const MESSAGE_SELECT =
  "id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,webLink,isRead,hasAttachments,importance";

/** Build a Graph message resource from common draft/send fields. */
function buildMessage({ subject, body, to, cc, bcc }) {
  const message = {};
  if (subject !== undefined) message.subject = subject;
  if (body !== undefined) {
    message.body = {
      contentType: body.contentType || "text",
      content: body.content,
    };
  }
  if (to) message.toRecipients = toRecipients(to);
  if (cc) message.ccRecipients = toRecipients(cc);
  if (bcc) message.bccRecipients = toRecipients(bcc);
  return message;
}

export function registerMailTools(server, token) {
  server.tool(
    "list_emails",
    "List emails from the signed-in user's mailbox, newest first. Optionally " +
      "scope to a folder and filter by read state.",
    {
      folder_id: z
        .string()
        .optional()
        .describe(
          "Mail folder id or well-known name (e.g. inbox, sentitems, drafts).",
        ),
      unread_only: z
        .boolean()
        .optional()
        .describe("If true, only return unread messages."),
      top: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max messages to return (default 25)."),
    },
    runTool(({ folder_id, unread_only, top }) => {
      const base = folder_id
        ? `/me/mailFolders/${odataString(folder_id)}/messages`
        : "/me/messages";
      return graphGet(token, base, {
        $top: top ?? 25,
        $orderby: "receivedDateTime desc",
        $select: MESSAGE_SELECT,
        $filter: unread_only ? "isRead eq false" : undefined,
      });
    }),
  );

  server.tool(
    "search_emails",
    "Search the mailbox via Microsoft Graph KQL. Supports a free-text query, " +
      "a sender filter, and a received-date range.",
    {
      query: z.string().describe("Free-text search over subject and body."),
      from: z
        .string()
        .optional()
        .describe("Filter by sender email address or name."),
      date_range: dateRangeSchema,
    },
    runTool(({ query, from, date_range }) => {
      const terms = [query];
      if (from) terms.push(`from:${from}`);
      const dates = dateRangeKql("received", date_range);
      if (dates) terms.push(dates);
      const kql = terms.filter(Boolean).join(" AND ");
      return graphGet(
        token,
        "/me/messages",
        { $search: searchPhrase(kql), $top: 25, $select: MESSAGE_SELECT },
        { ConsistencyLevel: "eventual" },
      );
    }),
  );

  server.tool(
    "get_email",
    "Get a single email by id, including its full body.",
    {
      message_id: z.string().describe("The message id."),
    },
    runTool(({ message_id }) =>
      graphGet(token, `/me/messages/${odataString(message_id)}`, {
        $select: MESSAGE_SELECT + ",body,ccRecipients,bccRecipients",
      }),
    ),
  );

  server.tool(
    "send_email",
    "Send a new email immediately from the signed-in user's mailbox.",
    {
      to: recipientsSchema,
      subject: z.string().describe("Email subject line."),
      body: bodySchema,
      cc: z.array(z.string()).optional().describe("CC recipients."),
      bcc: z.array(z.string()).optional().describe("BCC recipients."),
      save_to_sent: z
        .boolean()
        .optional()
        .describe("Save a copy to Sent Items (default true)."),
    },
    runTool(async ({ to, subject, body, cc, bcc, save_to_sent }) => {
      await graphPost(token, "/me/sendMail", {
        message: buildMessage({ subject, body, to, cc, bcc }),
        saveToSentItems: save_to_sent ?? true,
      });
      return { status: "sent", to, subject };
    }),
  );

  server.tool(
    "reply_email",
    "Reply (or reply-all) to an existing email thread.",
    {
      message_id: z.string().describe("Id of the message to reply to."),
      comment: z.string().describe("Reply text to prepend to the thread."),
      reply_all: z
        .boolean()
        .optional()
        .describe("If true, reply to all recipients (default false)."),
    },
    runTool(async ({ message_id, comment, reply_all }) => {
      const action = reply_all ? "replyAll" : "reply";
      await graphPost(
        token,
        `/me/messages/${odataString(message_id)}/${action}`,
        { comment },
      );
      return { status: "sent", action, message_id };
    }),
  );

  server.tool(
    "create_draft",
    "Create a draft email without sending it.",
    {
      to: z.array(z.string()).optional().describe("Recipient addresses."),
      subject: z.string().optional().describe("Email subject line."),
      body: bodySchema.optional(),
      cc: z.array(z.string()).optional().describe("CC recipients."),
      bcc: z.array(z.string()).optional().describe("BCC recipients."),
    },
    runTool(({ to, subject, body, cc, bcc }) =>
      graphPost(token, "/me/messages", buildMessage({ subject, body, to, cc, bcc })),
    ),
  );

  server.tool(
    "update_draft",
    "Update fields on an existing draft email.",
    {
      message_id: z.string().describe("Id of the draft message to update."),
      to: z.array(z.string()).optional().describe("Replacement recipients."),
      subject: z.string().optional().describe("New subject line."),
      body: bodySchema.optional(),
      cc: z.array(z.string()).optional().describe("Replacement CC recipients."),
      bcc: z.array(z.string()).optional().describe("Replacement BCC recipients."),
    },
    runTool(({ message_id, to, subject, body, cc, bcc }) =>
      graphPatch(
        token,
        `/me/messages/${odataString(message_id)}`,
        buildMessage({ subject, body, to, cc, bcc }),
      ),
    ),
  );

  server.tool(
    "delete_email",
    "Delete an email (moves it to Deleted Items).",
    {
      message_id: z.string().describe("Id of the message to delete."),
    },
    runTool(async ({ message_id }) => {
      await graphDelete(token, `/me/messages/${odataString(message_id)}`);
      return { status: "deleted", message_id };
    }),
  );

  server.tool(
    "list_folders",
    "List the signed-in user's mail folders.",
    {
      top: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max folders to return (default 50)."),
    },
    runTool(({ top }) =>
      graphGet(token, "/me/mailFolders", {
        $top: top ?? 50,
        $select: "id,displayName,parentFolderId,unreadItemCount,totalItemCount",
      }),
    ),
  );

  server.tool(
    "move_email",
    "Move an email to a different mail folder.",
    {
      message_id: z.string().describe("Id of the message to move."),
      destination_folder_id: z
        .string()
        .describe("Target folder id or well-known name (e.g. archive)."),
    },
    runTool(({ message_id, destination_folder_id }) =>
      graphPost(token, `/me/messages/${odataString(message_id)}/move`, {
        destinationId: destination_folder_id,
      }),
    ),
  );
}
