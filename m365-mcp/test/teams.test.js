/**
 * Unit tests for Microsoft Teams tool registration and hosted-image retrieval.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { registerTeamsTools } from "../src/tools/teams.js";

function registeredTeamsTools(token = "test-token") {
  const tools = new Map();
  const server = {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
  };
  registerTeamsTools(server, token);
  return tools;
}

test("get_chat_message_hosted_content returns Graph image bytes as MCP image content", async (t) => {
  const tools = registeredTeamsTools();
  const tool = tools.get("get_chat_message_hosted_content");
  assert.ok(tool, "hosted-content tool should be registered");

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  };

  const result = await tool.handler({
    chat_id: "chat/id",
    message_id: "message id",
    hosted_content_id: "hosted/content",
  });

  assert.equal(
    request.url,
    "https://graph.microsoft.com/v1.0/chats/chat%2Fid/messages/message%20id/hostedContents/hosted%2Fcontent/$value",
  );
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.deepEqual(result, {
    content: [
      {
        type: "image",
        data: "iVBORw==",
        mimeType: "image/png",
      },
    ],
  });
});

test("get_chat_message_hosted_content rejects non-image hosted content", async (t) => {
  const tool = registeredTeamsTools().get("get_chat_message_hosted_content");
  assert.ok(tool, "hosted-content tool should be registered");

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response("not an image", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  const result = await tool.handler({
    chat_id: "chat",
    message_id: "message",
    hosted_content_id: "hosted",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /expected image content/i);
  assert.doesNotMatch(result.content[0].text, /not an image/i);
});
