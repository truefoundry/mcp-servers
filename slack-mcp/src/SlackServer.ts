import {
  Module,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Scope,
  Inject,
} from '@nestjs/common';
import { NestFactory, REQUEST } from '@nestjs/core';
import { McpModule, McpTransportType, Tool } from '@rekog/mcp-nest';
import fetch from 'node-fetch';
import { config } from './config.js';
import { Request } from 'express';
import { z } from 'zod';

interface ToolResponse {
  content: Array<{ type: string; text: string }>;
}

// Authentication Guard
@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

interface SlackUserResponse {
  ok: boolean;
  user?: {
    id: string;
  };
  error?: string;
}

interface SlackMessageResponse {
  ok: boolean;
  channel: string;
  ts: string;
  message: {
    text: string;
  };
}

interface SlackConversationsResponse {
  ok: boolean;
  channels: Array<{
    id: string;
    name: string;
    is_channel: boolean;
    is_group: boolean;
    is_im: boolean;
    is_mpim: boolean;
    is_private: boolean;
    is_archived: boolean;
    created: number;
    creator: string;
    num_members?: number;
  }>;
  response_metadata?: {
    next_cursor: string;
  };
}

interface SlackConversationHistoryResponse {
  ok: boolean;
  error?: string;
  messages: Array<{
    type: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
    reply_count?: number;
    reply_users_count?: number;
    latest_reply?: string;
    reply_users?: string[];
    is_starred?: boolean;
    reactions?: Array<{
      name: string;
      count: number;
      users: string[];
    }>;
  }>;
  has_more: boolean;
  pin_count: number;
  response_metadata?: {
    next_cursor: string;
  };
}

interface UserProfile {
  real_name: string;
  email?: string;
}

interface Member {
  id: string;
  real_name: string;
  is_bot: boolean;
  profile: UserProfile;
}

interface ParsedSlackUsers {
  ok: boolean;
  members: Member[];
}

interface MinifiedMember {
  id: string;
  is_bot: boolean;
  real_name: string;
  email?: string;
}

interface UserResultForSlack {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

function extractMinifiedUserDetails(userResult: UserResultForSlack): MinifiedMember[] {
  if (
    !userResult ||
    !userResult.content ||
    !Array.isArray(userResult.content) ||
    userResult.content.length === 0 ||
    typeof userResult.content[0].text !== 'string'
  ) {
    throw new HttpException(
      "Invalid userResult structure: Expected 'content' array with a 'text' property in the first element.",
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  let parsedText: ParsedSlackUsers;
  try {
    parsedText = JSON.parse(userResult.content[0].text) as ParsedSlackUsers;
  } catch (e: any) {
    throw new HttpException(
      `Failed to parse user data from Slack: ${e.message}`,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  if (!parsedText.ok) {
    // Slack API itself reported not 'ok'. The error from Slack might be in parsedText.error
    const slackError: string = (parsedText as any).error || 'Unknown error from Slack API';
    throw new HttpException(`Slack API Error: ${slackError}`, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  if (!parsedText.members || !Array.isArray(parsedText.members)) {
    throw new HttpException(
      "Parsed Slack user data is invalid: 'members' array is missing or not an array.",
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  return parsedText.members.map((member) => ({
    id: member.id,
    is_bot: member.is_bot,
    real_name: member.profile.real_name,
    email: member.profile.email,
  }));
}

interface SimplifiedMessage {
  timestamp: string;
  text: string;
  user: string;
  username: string;
  threadMessageCount?: number;
  thread_ts?: string;
}

interface SlackErrorResponse {
  ok: boolean;
  error?: string;
}

interface SlackUserGroupResponse extends SlackErrorResponse {
  usergroups?: Array<{ id: string; name: string }>;
}

interface SlackUsersListResponse {
  ok: boolean;
  members?: Array<{
    id: string;
    real_name?: string;
    name?: string;
  }>;
  error?: string;
}

// MCP Tool for Slack Conversations
@Injectable({ scope: Scope.REQUEST })
class SlackConversationsTool {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  @Tool({
    name: 'getConversations',
    description: 'Fetches list of conversations (channels, DMs, groups) from Slack',
    parameters: z.object({
      types: z
        .string()
        .optional()
        .describe(
          'Comma-separated list of conversation types (public_channel, private_channel, mpim, im)'
        ),
      excludeArchived: z.boolean().optional().describe('Set to true to exclude archived channels'),
      limit: z.number().optional().describe('Maximum number of items to return (under 1000)'),
    }),
  })
  async getConversations({
    types,
    excludeArchived,
    limit,
  }: {
    types?: string;
    excludeArchived?: boolean;
    limit?: number;
  }): Promise<ToolResponse> {
    const authHeader = this.request.headers['authorization']!;
    const url = new URL('https://slack.com/api/conversations.list');

    if (types) {
      url.searchParams.append('types', types);
    }
    if (excludeArchived !== undefined) {
      url.searchParams.append('exclude_archived', excludeArchived.toString());
    }
    if (limit) {
      url.searchParams.append('limit', limit.toString());
    }

    console.log(`[Slack API] GET ${url.toString()}`);
    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpException(errorText, response.status);
      }

      const data = (await response.json()) as SlackConversationsResponse;
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(String(error), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

// MCP Tool for Slack Chat
@Injectable({ scope: Scope.REQUEST })
class SlackChatTool {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  @Tool({
    name: 'sendMessage',
    description: 'Sends a message to a Slack channel or user. Can also reply to a thread if threadTs is provided.',
    parameters: z.object({
      channel: z.string().describe('The ID of the channel or user to send the message to'),
      message: z.string().describe('The message to send'),
      threadTs: z.string().optional().describe('Optional: The timestamp of the parent message to reply to (for thread replies)'),
    }),
  })
  async sendMessage({
    channel,
    message,
    threadTs,
  }: {
    channel: string;
    message: string;
    threadTs?: string;
  }): Promise<ToolResponse> {
    const authHeader = this.request.headers['authorization']!;
    const url = 'https://slack.com/api/chat.postMessage';
    console.log(`[Slack API] POST ${url}`);

    const payload = {
      channel,
      text: message,
      thread_ts: threadTs,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpException(errorText, response.status);
      }

      const messageData = (await response.json()) as SlackMessageResponse;
      return {
        content: [{ type: 'text', text: JSON.stringify(messageData) }],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(String(error), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

// MCP Tool to fetch Slack users
@Injectable({ scope: Scope.REQUEST })
class SlackUsersTool {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  @Tool({
    name: 'getSlackUsers',
    description: 'Fetches users list from Slack',
  })
  async getSlackUsers(): Promise<ToolResponse> {
    const authHeader = this.request.headers['authorization']!;
    const url = 'https://slack.com/api/users.list';
    console.log(`[Slack API] GET ${url}`);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpException(errorText, response.status);
      }

      const data = await response.json();
      const userResult: UserResultForSlack = {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      };
      const minifiedUsers = extractMinifiedUserDetails(userResult);
      return {
        content: [{ type: 'text', text: JSON.stringify(minifiedUsers) }],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(String(error), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Tool({
    name: 'findUserByEmail',
    description: 'Finds a Slack user by their email address',
    parameters: z.object({
      email: z.string().describe('The email address of the user'),
    }),
  })
  async findUserByEmail({ email }: { email: string }): Promise<ToolResponse> {
    const authHeader = this.request.headers['authorization']!;
    const url = `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`;
    console.log(`[Slack API] GET ${url}`);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpException(errorText, response.status);
      }

      const userData = (await response.json()) as SlackUserResponse;
      return {
        content: [{ type: 'text', text: JSON.stringify(userData) }],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(String(error), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

// MCP Tool to fetch Slack conversation history
@Injectable({ scope: Scope.REQUEST })
class SlackConversationHistoryTool {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchWithRetry<T extends SlackErrorResponse>(
    url: string,
    headers: Record<string, string>,
    maxRetries = 3
  ): Promise<T> {
    let retryCount = 0;
    let lastError: string | null = null;

    while (retryCount < maxRetries) {
      try {
        const response = await fetch(url, { headers });
        const data = (await response.json()) as T;

        if (data.error === 'ratelimited') {
          const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30 seconds
          console.log(
            `Rate limited. Retrying after ${backoffTime}ms (attempt ${retryCount + 1}/${maxRetries})`
          );
          await this.sleep(backoffTime);
          retryCount++;
          continue;
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.error(
          `Request failed. Retrying after ${backoffTime}ms (attempt ${retryCount + 1}/${maxRetries}):`,
          lastError
        );
        await this.sleep(backoffTime);
        retryCount++;
      }
    }

    throw new Error(`Failed after ${maxRetries} retries. Last error: ${lastError}`);
  }

  private async getUserMap(): Promise<Map<string, string>> {
    const authHeader = this.request.headers['authorization']!;
    const url = 'https://slack.com/api/users.list';
    const userMap = new Map<string, string>();

    try {
      const data = await this.fetchWithRetry<SlackUsersListResponse>(url, {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      });

      if (data.ok && data.members) {
        data.members.forEach((member) => {
          userMap.set(member.id, member.real_name || member.name || member.id);
        });
      } else {
        console.error('Failed to fetch users list:', data.error || 'Unknown error');
      }
    } catch (error: unknown) {
      console.error('Error fetching users list:', error);
    }
    return userMap;
  }

  private async getTeamMap(): Promise<Map<string, string>> {
    const authHeader = this.request.headers['authorization']!;
    const url = 'https://slack.com/api/usergroups.list';
    const teamMap = new Map<string, string>();

    try {
      const data = await this.fetchWithRetry<SlackUserGroupResponse>(url, {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      });

      if (data.ok && data.usergroups) {
        data.usergroups.forEach((group) => {
          teamMap.set(group.id, group.name);
        });
      } else {
        console.error('Failed to fetch usergroups list:', data.error || 'Unknown error');
      }
    } catch (error: unknown) {
      console.error('Error fetching usergroups list:', error);
    }
    return teamMap;
  }

  private async resolveUserMentions(
    text: string,
    userMap: Map<string, string>,
    teamMap: Map<string, string>
  ): Promise<string> {
    // Match both <@USER_ID> and <!subteam^TEAM_ID> patterns
    const mentionRegex = /<(@|!subteam\^)([A-Z0-9]+)>/g;
    let resolvedText = text;
    const mentions = text.match(mentionRegex) || [];

    for (const mention of mentions) {
      const match = mention.match(/<(@|!subteam\^)([A-Z0-9]+)>/);
      if (match) {
        const [_, type, id] = match;
        if (type === '@') {
          const username = userMap.get(id) || id;
          resolvedText = resolvedText.replace(mention, `@${username}`);
        } else if (type === '!subteam^') {
          const teamName = teamMap.get(id) || `team-${id}`;
          resolvedText = resolvedText.replace(mention, `@${teamName}`);
        }
      }
    }

    return resolvedText;
  }

  private async simplifyMessages(
    messages: SlackConversationHistoryResponse['messages'],
    userMap: Map<string, string>,
    teamMap: Map<string, string>
  ): Promise<SimplifiedMessage[]> {
    const simplifiedMessages: SimplifiedMessage[] = [];

    for (const message of messages) {
      const username = userMap.get(message.user) || message.user;
      const resolvedText = await this.resolveUserMentions(message.text, userMap, teamMap);
      simplifiedMessages.push({
        timestamp: message.ts,
        text: resolvedText,
        user: message.user,
        username: username,
        threadMessageCount: message.reply_count,
        thread_ts: message.thread_ts,
      });
    }

    return simplifiedMessages;
  }

  @Tool({
    name: 'getConversationHistory',
    description: 'Fetches message history from a Slack conversation',
    parameters: z.object({
      channel: z.string().describe('The ID of the conversation to fetch history for'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of messages to return (default: 100, max: 999)'),
      oldest: z
        .string()
        .optional()
        .describe('Only messages after this Unix timestamp will be included'),
      latest: z
        .string()
        .optional()
        .describe('Only messages before this Unix timestamp will be included'),
      inclusive: z
        .boolean()
        .optional()
        .describe('Include messages with oldest or latest timestamps in results'),
      cursor: z
        .string()
        .optional()
        .describe('Paginate through collections of data by setting the cursor parameter'),
      includeAllMetadata: z
        .boolean()
        .optional()
        .describe('Return all metadata associated with messages'),
    }),
  })
  async getConversationHistory({
    channel,
    limit,
    oldest,
    latest,
    inclusive,
    cursor,
    includeAllMetadata,
  }: {
    channel: string;
    limit?: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
    cursor?: string;
    includeAllMetadata?: boolean;
  }): Promise<ToolResponse> {
    const authHeader = this.request.headers['authorization']!;
    const url = new URL('https://slack.com/api/conversations.history');

    url.searchParams.append('channel', channel);
    if (limit) {
      url.searchParams.append('limit', limit.toString());
    }
    if (oldest) {
      url.searchParams.append('oldest', oldest);
    }
    if (latest) {
      url.searchParams.append('latest', latest);
    }
    if (inclusive !== undefined) {
      url.searchParams.append('inclusive', inclusive.toString());
    }
    if (cursor) {
      url.searchParams.append('cursor', cursor);
    }
    if (includeAllMetadata !== undefined) {
      url.searchParams.append('include_all_metadata', includeAllMetadata.toString());
    }

    console.log(`[Slack API] GET ${url.toString()}`);
    try {
      // Fetch conversation history and user/team maps in parallel
      const [historyData, userMap, teamMap] = await Promise.all([
        this.fetchWithRetry<SlackConversationHistoryResponse>(url.toString(), {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        }),
        this.getUserMap(),
        this.getTeamMap(),
      ]);

      if (!historyData.ok) {
        throw new HttpException(
          `Slack API Error: ${historyData.error || 'Unknown error'}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (!historyData.messages || !Array.isArray(historyData.messages)) {
        return {
          content: [{ type: 'text', text: JSON.stringify([]) }],
        };
      }

      const simplifiedMessages = await this.simplifyMessages(
        historyData.messages,
        userMap,
        teamMap
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(simplifiedMessages) }],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(String(error), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Tool({
    name: 'getConversationReplies',
    description: 'Fetches replies (thread messages) from a Slack conversation',
    parameters: z.object({
      channel: z.string().describe('The ID of the conversation to fetch replies for'),
      thread_ts: z.string().describe('The timestamp of the parent message to fetch replies for'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of messages to return (default: 100, max: 999)'),
      oldest: z
        .string()
        .optional()
        .describe('Only messages after this Unix timestamp will be included'),
      latest: z
        .string()
        .optional()
        .describe('Only messages before this Unix timestamp will be included'),
      inclusive: z
        .boolean()
        .optional()
        .describe('Include messages with oldest or latest timestamps in results'),
      cursor: z
        .string()
        .optional()
        .describe('Paginate through collections of data by setting the cursor parameter'),
    }),
  })
  async getConversationReplies({
    channel,
    thread_ts,
    limit,
    oldest,
    latest,
    inclusive,
    cursor,
  }: {
    channel: string;
    thread_ts: string;
    limit?: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
    cursor?: string;
  }): Promise<ToolResponse> {
    const authHeader = this.request.headers['authorization']!;
    const url = new URL('https://slack.com/api/conversations.replies');

    url.searchParams.append('channel', channel);
    url.searchParams.append('ts', thread_ts);
    if (limit) {
      url.searchParams.append('limit', limit.toString());
    }
    if (oldest) {
      url.searchParams.append('oldest', oldest);
    }
    if (latest) {
      url.searchParams.append('latest', latest);
    }
    if (inclusive !== undefined) {
      url.searchParams.append('inclusive', inclusive.toString());
    }
    if (cursor) {
      url.searchParams.append('cursor', cursor);
    }

    console.log(`[Slack API] GET ${url.toString()}`);
    try {
      // Fetch conversation replies and user/team maps in parallel
      const [repliesData, userMap, teamMap] = await Promise.all([
        this.fetchWithRetry<SlackConversationHistoryResponse>(url.toString(), {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        }),
        this.getUserMap(),
        this.getTeamMap(),
      ]);

      if (!repliesData.ok) {
        throw new HttpException(
          `Slack API Error: ${repliesData.error || 'Unknown error'}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (!repliesData.messages || !Array.isArray(repliesData.messages)) {
        return {
          content: [{ type: 'text', text: JSON.stringify([]) }],
        };
      }

      const simplifiedMessages = await this.simplifyMessages(
        repliesData.messages,
        userMap,
        teamMap
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(simplifiedMessages) }],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(String(error), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

// Application Module
@Module({
  imports: [
    McpModule.forRoot({
      name: 'Slack Server',
      version: '1.0.0',
      guards: [AuthGuard],
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
        statelessMode: true,
      },
    }),
  ],
  controllers: [],
  providers: [
    SlackUsersTool,
    SlackConversationsTool,
    SlackChatTool,
    SlackConversationHistoryTool,
    AuthGuard,
  ],
})
class AppModule {}

// Bootstrap the application
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Enable CORS to allow all origins, methods, and headers
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: '*',
    credentials: true,
  });

  await app.listen(config.port);
}

void bootstrap();
