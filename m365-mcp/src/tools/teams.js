/**
 * Microsoft Teams tools (Graph /me/chats, /chats, /teams, /me/joinedTeams).
 */

import { z } from "zod";
import { graphDownload, graphGet, graphPost, microsoftSearch } from "../graph.js";
import { image, runTool, odataString, odataLiteral } from "./util.js";

/** Build an aadUserConversationMember bind for a user UPN/id. */
function memberBind(userIdOrUpn) {
  return {
    "@odata.type": "#microsoft.graph.aadUserConversationMember",
    roles: ["owner"],
    "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${odataLiteral(userIdOrUpn)}')`,
  };
}

/** Build a Graph chatMessage body resource. */
function messageBody(content, contentType) {
  return { body: { contentType: contentType || "text", content } };
}

export function registerTeamsTools(server, token) {
  server.tool(
    "list_chats",
    "List the signed-in user's Teams chats (1:1, group, and meeting chats).",
    {
      top: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max chats to return (default 25)."),
    },
    runTool(({ top }) =>
      graphGet(token, "/me/chats", {
        $top: top ?? 25,
        // Graph requires lastMessagePreview to be expanded when ordering by it.
        $expand: "members,lastMessagePreview",
        $orderby: "lastMessagePreview/createdDateTime desc",
      }),
    ),
  );

  server.tool(
    "search_chat_messages",
    "Search across the signed-in user's Teams chat messages via the " +
      "Microsoft Search API.",
    { query: z.string().describe("Search term for Teams chat messages.") },
    runTool(({ query }) => microsoftSearch(token, ["chatMessage"], query)),
  );

  server.tool(
    "get_chat_messages",
    "Get recent messages from a specific Teams chat.",
    {
      chat_id: z.string().describe("The chat id."),
      top: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max messages to return (default 25)."),
    },
    runTool(({ chat_id, top }) =>
      graphGet(token, `/me/chats/${odataString(chat_id)}/messages`, {
        $top: top ?? 25,
        $orderby: "createdDateTime desc",
      }),
    ),
  );

  server.tool(
    "get_chat_message_hosted_content",
    "Download an image embedded in a Teams chat message. Use the hosted " +
      "content id from the message body's image source.",
    {
      chat_id: z.string().describe("The chat id."),
      message_id: z.string().describe("The chat message id."),
      hosted_content_id: z
        .string()
        .describe("The hosted content id from the message body's image source."),
    },
    runTool(
      ({ chat_id, message_id, hosted_content_id }) =>
        graphDownload(
          token,
          `/chats/${odataString(chat_id)}/messages/${odataString(message_id)}` +
            `/hostedContents/${odataString(hosted_content_id)}/$value`,
        ),
      image,
    ),
  );

  server.tool(
    "send_chat_message",
    "Post a message to an existing Teams chat.",
    {
      chat_id: z.string().describe("The chat id to post to."),
      content: z.string().describe("Message content."),
      content_type: z
        .enum(["text", "html"])
        .optional()
        .describe("Content type (default 'text')."),
    },
    runTool(({ chat_id, content, content_type }) =>
      graphPost(
        token,
        `/me/chats/${odataString(chat_id)}/messages`,
        messageBody(content, content_type),
      ),
    ),
  );

  server.tool(
    "create_chat",
    "Create a new Teams chat. Provide member email addresses; the signed-in " +
      "user is added automatically.",
    {
      members: z
        .array(z.string())
        .describe("Email addresses (UPNs) of members to add."),
      chat_type: z
        .enum(["oneOnOne", "group"])
        .optional()
        .describe("Chat type. Defaults to 'group' (or 'oneOnOne' for 1 member)."),
      topic: z
        .string()
        .optional()
        .describe("Topic/title for a group chat."),
    },
    runTool(async ({ members, chat_type, topic }) => {
      const type = chat_type || (members.length <= 1 ? "oneOnOne" : "group");
      // Graph requires the caller to be one of the chat members; add them if
      // the client didn't include their own address. The client may identify
      // the caller by either UPN or Graph object id, so check both — matching
      // only the UPN would append a duplicate when the caller's id was passed.
      const me = await graphGet(token, "/me", {
        $select: "id,userPrincipalName",
      });
      const selfKeys = new Set(
        [me.userPrincipalName, me.id]
          .filter(Boolean)
          .map((v) => v.toLowerCase()),
      );
      const allMembers = members.some((m) => selfKeys.has(m.toLowerCase()))
        ? members
        : [...members, me.id];

      // Graph requires a oneOnOne chat to have exactly two members (the caller
      // plus one other). An empty/self-only members list or three-plus members
      // would otherwise fail or behave incorrectly at Graph, so reject it early
      // with a hint to use a group chat instead.
      if (type === "oneOnOne" && allMembers.length !== 2) {
        throw new Error(
          `A oneOnOne chat needs exactly two members (you + one other), but ` +
            `resolved to ${allMembers.length}. Provide exactly one other ` +
            `member, or set chat_type to "group".`,
        );
      }

      const body = { chatType: type, members: allMembers.map(memberBind) };
      if (topic && type === "group") body.topic = topic;
      return graphPost(token, "/chats", body);
    }),
  );

  server.tool(
    "add_chat_member",
    "Add a member to an existing Teams group chat.",
    {
      chat_id: z.string().describe("The chat id."),
      user: z.string().describe("Email address (UPN) of the user to add."),
      share_history: z
        .boolean()
        .optional()
        .describe("Share all prior message history with the new member."),
    },
    runTool(({ chat_id, user, share_history }) =>
      graphPost(token, `/chats/${odataString(chat_id)}/members`, {
        ...memberBind(user),
        visibleHistoryStartDateTime: share_history
          ? "0001-01-01T00:00:00Z"
          : undefined,
      }),
    ),
  );

  server.tool(
    "list_teams",
    "List the teams the signed-in user has joined.",
    {},
    runTool(() =>
      graphGet(token, "/me/joinedTeams", {
        $select: "id,displayName,description,visibility",
      }),
    ),
  );

  server.tool(
    "list_channels",
    "List the channels within a team.",
    { team_id: z.string().describe("The team id.") },
    runTool(({ team_id }) =>
      graphGet(token, `/teams/${odataString(team_id)}/channels`, {
        $select: "id,displayName,description,membershipType,webUrl",
      }),
    ),
  );

  server.tool(
    "get_channel_messages",
    "Read recent messages from a team channel.",
    {
      team_id: z.string().describe("The team id."),
      channel_id: z.string().describe("The channel id."),
      top: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max messages to return (default 20)."),
    },
    runTool(({ team_id, channel_id, top }) =>
      graphGet(
        token,
        `/teams/${odataString(team_id)}/channels/${odataString(channel_id)}/messages`,
        { $top: top ?? 20 },
      ),
    ),
  );

  server.tool(
    "post_channel_message",
    "Post a message to a team channel.",
    {
      team_id: z.string().describe("The team id."),
      channel_id: z.string().describe("The channel id."),
      content: z.string().describe("Message content."),
      content_type: z
        .enum(["text", "html"])
        .optional()
        .describe("Content type (default 'text')."),
    },
    runTool(({ team_id, channel_id, content, content_type }) =>
      graphPost(
        token,
        `/teams/${odataString(team_id)}/channels/${odataString(channel_id)}/messages`,
        messageBody(content, content_type),
      ),
    ),
  );
}
