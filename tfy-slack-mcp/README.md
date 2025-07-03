# Slack MCP Server

A Model Context Protocol (MCP) server that provides seamless integration with Slack's API. This server enables AI assistants and other MCP clients to interact with Slack workspaces, allowing them to fetch conversations, send messages, retrieve user information, and access conversation history.

## Tools

### getConversations

Fetches a list of conversations (channels, DMs, groups) from Slack.

**Input:**
- `types` (optional): Comma-separated list of conversation types (public_channel, private_channel, mpim, im)
- `excludeArchived` (optional): Set to true to exclude archived channels
- `limit` (optional): Maximum number of items to return (under 1000)

**Output:**
Returns a JSON object containing:
- `ok`: Boolean indicating if the request was successful
- `channels`: Array of channel objects with properties like id, name, is_channel, is_group, is_im, is_mpim, is_private, is_archived, created, creator, num_members
- `response_metadata`: Optional pagination metadata with next_cursor

### sendMessage

Sends a message to a Slack channel or user. Can also reply to a thread if threadTs is provided.

**Input:**
- `channel` (required): The ID of the channel or user to send the message to
- `message` (required): The message text to send
- `threadTs` (optional): The timestamp of the parent message to reply to (for thread replies)

**Output:**
Returns a JSON object containing:
- `ok`: Boolean indicating if the message was sent successfully
- `channel`: The channel ID where the message was sent
- `ts`: Timestamp of the sent message
- `message`: Object containing the message details

### getSlackUsers

Fetches a minified list of users from the Slack workspace.

**Input:**
No parameters required.

**Output:**
Returns a JSON array of user objects containing:
- `id`: User ID
- `is_bot`: Boolean indicating if the user is a bot
- `real_name`: User's real name
- `email`: User's email address (if available)

### findUserByEmail

Finds a Slack user by their email address.

**Input:**
- `email` (required): The email address of the user to find

**Output:**
Returns a JSON object containing:
- `ok`: Boolean indicating if the request was successful
- `user`: User object with id and other details (if found)
- `error`: Error message (if user not found or other error occurred)

### getConversationHistory

Fetches message history from a Slack conversation with user mention resolution.

**Input:**
- `channel` (required): The ID of the conversation to fetch history for
- `limit` (optional): Maximum number of messages to return (default: 100, max: 999)
- `oldest` (optional): Only messages after this Unix timestamp will be included
- `latest` (optional): Only messages before this Unix timestamp will be included
- `inclusive` (optional): Include messages with oldest or latest timestamps in results
- `cursor` (optional): Paginate through collections of data by setting the cursor parameter
- `includeAllMetadata` (optional): Return all metadata associated with messages

**Output:**
Returns a JSON array of simplified message objects containing:
- `timestamp`: Message timestamp
- `text`: Message text with resolved user/team mentions
- `user`: User ID who sent the message
- `username`: Resolved username of the sender
- `threadMessageCount`: Number of replies in thread (if applicable)
- `thread_ts`: Thread timestamp (if message is part of a thread)

### getConversationReplies

Fetches replies (thread messages) from a Slack conversation.

**Input:**
- `channel` (required): The ID of the conversation to fetch replies for
- `thread_ts` (required): The timestamp of the parent message to fetch replies for
- `limit` (optional): Maximum number of messages to return (default: 100, max: 999)
- `oldest` (optional): Only messages after this Unix timestamp will be included
- `latest` (optional): Only messages before this Unix timestamp will be included
- `inclusive` (optional): Include messages with oldest or latest timestamps in results
- `cursor` (optional): Paginate through collections of data by setting the cursor parameter

**Output:**
Returns a JSON array of simplified message objects containing:
- `timestamp`: Message timestamp
- `text`: Message text with resolved user/team mentions
- `user`: User ID who sent the message
- `username`: Resolved username of the sender
- `threadMessageCount`: Number of replies in thread (if applicable)
- `thread_ts`: Thread timestamp

## Authentication

All tools require a valid Slack Bot Token passed in the `Authorization` header. The server uses an authentication guard to ensure all requests are properly authenticated before processing.

## Features

- **Rate Limiting Protection**: Built-in retry logic with exponential backoff for Slack API rate limits
- **User Mention Resolution**: Automatically resolves user and team mentions in message text
- **Error Handling**: Comprehensive error handling with proper HTTP status codes
- **Parallel Processing**: Optimized API calls with parallel requests where possible
