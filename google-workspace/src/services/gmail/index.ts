/**
 * Gmail service module — adapts upstream Gmail-MCP-Server to this repo's
 * functional ServiceModule pattern. Per-request OAuth comes from the
 * shared auth-ctx layer; this module just dispatches tool calls against
 * `ctx.getGmail()`.
 *
 * Two upstream features are intentionally absent:
 *   - `download_attachment` tool (returns file paths the gateway can't see)
 *   - `attachments` field on send_email / draft_email (local file paths)
 */
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { gmail_v1 } from 'googleapis';

import type {
  ServiceModule,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from '../../types.js';
import { errorResponse } from '../../types.js';
import { annotateAll } from '../../annotations.js';

import {
  SendEmailSchema,
  ReadEmailSchema,
  SearchEmailsSchema,
  ModifyEmailSchema,
  DeleteEmailSchema,
  ListEmailLabelsSchema,
  CreateLabelSchema,
  UpdateLabelSchema,
  DeleteLabelSchema,
  GetOrCreateLabelSchema,
  BatchModifyEmailsSchema,
  BatchDeleteEmailsSchema,
  CreateFilterSchema,
  ListFiltersSchema,
  GetFilterSchema,
  DeleteFilterSchema,
  CreateFilterFromTemplateSchema,
} from './schemas.js';
import {
  createLabel,
  updateLabel,
  deleteLabel,
  listLabels,
  getOrCreateLabel,
  type GmailLabel,
} from './helpers/labels.js';
import {
  createFilter,
  listFilters,
  getFilter,
  deleteFilter,
  filterTemplates,
} from './helpers/filters.js';
import { createEmailMessage, encodeMessageForGmail } from './helpers/email.js';
import {
  extractEmailContent,
  collectAttachmentInfo,
  type GmailMessagePart,
} from './helpers/extract.js';

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface GmailToolEntry {
  name: string;
  description: string;
  schema: ZodTypeAny;
}

const GMAIL_TOOLS: GmailToolEntry[] = [
  { name: 'send_email', description: 'Sends a new email', schema: SendEmailSchema },
  { name: 'draft_email', description: 'Draft a new email', schema: SendEmailSchema },
  {
    name: 'read_email',
    description: 'Retrieves the content of a specific email',
    schema: ReadEmailSchema,
  },
  {
    name: 'search_emails',
    description: 'Searches for emails using Gmail search syntax',
    schema: SearchEmailsSchema,
  },
  {
    name: 'modify_email',
    description: 'Modifies email labels (move to different folders)',
    schema: ModifyEmailSchema,
  },
  {
    name: 'delete_email',
    description: 'Permanently deletes an email',
    schema: DeleteEmailSchema,
  },
  {
    name: 'list_email_labels',
    description: 'Retrieves all available Gmail labels',
    schema: ListEmailLabelsSchema,
  },
  {
    name: 'batch_modify_emails',
    description: 'Modifies labels for multiple emails in batches',
    schema: BatchModifyEmailsSchema,
  },
  {
    name: 'batch_delete_emails',
    description: 'Permanently deletes multiple emails in batches',
    schema: BatchDeleteEmailsSchema,
  },
  {
    name: 'create_label',
    description: 'Creates a new Gmail label',
    schema: CreateLabelSchema,
  },
  {
    name: 'update_label',
    description: 'Updates an existing Gmail label',
    schema: UpdateLabelSchema,
  },
  {
    name: 'delete_label',
    description: 'Deletes a Gmail label',
    schema: DeleteLabelSchema,
  },
  {
    name: 'get_or_create_label',
    description: "Gets an existing label by name or creates it if it doesn't exist",
    schema: GetOrCreateLabelSchema,
  },
  {
    name: 'create_filter',
    description: 'Creates a new Gmail filter with custom criteria and actions',
    schema: CreateFilterSchema,
  },
  {
    name: 'list_filters',
    description: 'Retrieves all Gmail filters',
    schema: ListFiltersSchema,
  },
  {
    name: 'get_filter',
    description: 'Gets details of a specific Gmail filter',
    schema: GetFilterSchema,
  },
  {
    name: 'delete_filter',
    description: 'Deletes a Gmail filter',
    schema: DeleteFilterSchema,
  },
  {
    name: 'create_filter_from_template',
    description: 'Creates a filter using a pre-defined template for common scenarios',
    schema: CreateFilterFromTemplateSchema,
  },
];

const rawToolDefinitions: ToolDefinition[] = GMAIL_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: zodToJsonSchema(t.schema as any) as Record<string, unknown>,
}));

const toolDefinitions = annotateAll(rawToolDefinitions);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Run an async operation across an array in fixed-size batches, falling
 * back to single-item retries when a batch fails.
 */
async function processBatches<T, U>(
  items: T[],
  batchSize: number,
  processFn: (batch: T[]) => Promise<U[]>,
): Promise<{ successes: U[]; failures: { item: T; error: Error }[] }> {
  const successes: U[] = [];
  const failures: { item: T; error: Error }[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      const results = await processFn(batch);
      successes.push(...results);
    } catch {
      for (const item of batch) {
        try {
          const result = await processFn([item]);
          successes.push(...result);
        } catch (itemError) {
          failures.push({ item, error: itemError as Error });
        }
      }
    }
  }

  return { successes, failures };
}

async function sendOrDraft(
  gmail: gmail_v1.Gmail,
  action: 'send' | 'draft',
  validatedArgs: z.infer<typeof SendEmailSchema>,
): Promise<ToolResult> {
  const raw = createEmailMessage(validatedArgs);
  const encoded = encodeMessageForGmail(raw);

  const messageRequest: gmail_v1.Schema$Message = { raw: encoded };
  if (validatedArgs.threadId) messageRequest.threadId = validatedArgs.threadId;

  if (action === 'send') {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: messageRequest,
    });
    return textResult(`Email sent successfully with ID: ${response.data.id}`);
  }

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: messageRequest },
  });
  return textResult(`Email draft created successfully with ID: ${response.data.id}`);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const TOOL_NAMES = new Set(GMAIL_TOOLS.map((t) => t.name));

async function handleTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  if (!TOOL_NAMES.has(name)) return null;
  const gmail = ctx.getGmail();

  try {
    switch (name) {
      case 'send_email':
      case 'draft_email': {
        const validated = SendEmailSchema.parse(args);
        const action: 'send' | 'draft' = name === 'send_email' ? 'send' : 'draft';
        return await sendOrDraft(gmail, action, validated);
      }

      case 'read_email': {
        const validated = ReadEmailSchema.parse(args);
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: validated.messageId,
          format: 'full',
        });

        const headers = response.data.payload?.headers || [];
        const subject =
          headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
        const from =
          headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
        const to =
          headers.find((h) => h.name?.toLowerCase() === 'to')?.value || '';
        const date =
          headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
        const threadId = response.data.threadId || '';

        const { text, html } = extractEmailContent(
          (response.data.payload as GmailMessagePart) || {},
        );
        const body = text || html || '';
        const contentTypeNote =
          !text && html
            ? '[Note: This email is HTML-formatted. Plain text version not available.]\n\n'
            : '';

        const attachments = collectAttachmentInfo(
          response.data.payload as GmailMessagePart | undefined,
        );
        const attachmentInfo =
          attachments.length > 0
            ? `\n\nAttachments (${attachments.length}):\n` +
              attachments
                .map(
                  (a) =>
                    `- ${a.filename} (${a.mimeType}, ${Math.round(
                      a.size / 1024,
                    )} KB, ID: ${a.id})`,
                )
                .join('\n')
            : '';

        return textResult(
          `Thread ID: ${threadId}\nSubject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${contentTypeNote}${body}${attachmentInfo}`,
        );
      }

      case 'search_emails': {
        const validated = SearchEmailsSchema.parse(args);
        const response = await gmail.users.messages.list({
          userId: 'me',
          q: validated.query,
          maxResults: validated.maxResults || 10,
        });

        const messages = response.data.messages || [];
        const results = await Promise.all(
          messages.map(async (msg) => {
            const detail = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id!,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'Date'],
            });
            const headers = detail.data.payload?.headers || [];
            return {
              id: msg.id,
              subject: headers.find((h) => h.name === 'Subject')?.value || '',
              from: headers.find((h) => h.name === 'From')?.value || '',
              date: headers.find((h) => h.name === 'Date')?.value || '',
            };
          }),
        );

        return textResult(
          results
            .map(
              (r) =>
                `ID: ${r.id}\nSubject: ${r.subject}\nFrom: ${r.from}\nDate: ${r.date}\n`,
            )
            .join('\n'),
        );
      }

      case 'modify_email': {
        const validated = ModifyEmailSchema.parse(args);
        const requestBody: gmail_v1.Schema$ModifyMessageRequest = {};
        if (validated.labelIds) requestBody.addLabelIds = validated.labelIds;
        if (validated.addLabelIds) requestBody.addLabelIds = validated.addLabelIds;
        if (validated.removeLabelIds)
          requestBody.removeLabelIds = validated.removeLabelIds;

        await gmail.users.messages.modify({
          userId: 'me',
          id: validated.messageId,
          requestBody,
        });
        return textResult(
          `Email ${validated.messageId} labels updated successfully`,
        );
      }

      case 'delete_email': {
        const validated = DeleteEmailSchema.parse(args);
        await gmail.users.messages.delete({
          userId: 'me',
          id: validated.messageId,
        });
        return textResult(`Email ${validated.messageId} deleted successfully`);
      }

      case 'list_email_labels': {
        const labelResults = await listLabels(gmail);
        const formatLabels = (ls: GmailLabel[]) =>
          ls.map((l) => `ID: ${l.id}\nName: ${l.name}\n`).join('\n');
        return textResult(
          `Found ${labelResults.count.total} labels (${labelResults.count.system} system, ${labelResults.count.user} user):\n\n` +
            'System Labels:\n' +
            formatLabels(labelResults.system) +
            '\nUser Labels:\n' +
            formatLabels(labelResults.user),
        );
      }

      case 'batch_modify_emails': {
        const validated = BatchModifyEmailsSchema.parse(args);
        const batchSize = validated.batchSize || 50;

        const requestBody: gmail_v1.Schema$ModifyMessageRequest = {};
        if (validated.addLabelIds) requestBody.addLabelIds = validated.addLabelIds;
        if (validated.removeLabelIds)
          requestBody.removeLabelIds = validated.removeLabelIds;

        const { successes, failures } = await processBatches(
          validated.messageIds,
          batchSize,
          async (batch) => {
            const results = await Promise.all(
              batch.map(async (messageId) => {
                await gmail.users.messages.modify({
                  userId: 'me',
                  id: messageId,
                  requestBody,
                });
                return { messageId, success: true };
              }),
            );
            return results;
          },
        );

        let resultText = `Batch label modification complete.\n`;
        resultText += `Successfully processed: ${successes.length} messages\n`;
        if (failures.length > 0) {
          resultText += `Failed to process: ${failures.length} messages\n\n`;
          resultText += `Failed message IDs:\n`;
          resultText += failures
            .map((f) => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`)
            .join('\n');
        }
        return textResult(resultText);
      }

      case 'batch_delete_emails': {
        const validated = BatchDeleteEmailsSchema.parse(args);
        const batchSize = validated.batchSize || 50;

        const { successes, failures } = await processBatches(
          validated.messageIds,
          batchSize,
          async (batch) => {
            const results = await Promise.all(
              batch.map(async (messageId) => {
                await gmail.users.messages.delete({
                  userId: 'me',
                  id: messageId,
                });
                return { messageId, success: true };
              }),
            );
            return results;
          },
        );

        let resultText = `Batch delete operation complete.\n`;
        resultText += `Successfully deleted: ${successes.length} messages\n`;
        if (failures.length > 0) {
          resultText += `Failed to delete: ${failures.length} messages\n\n`;
          resultText += `Failed message IDs:\n`;
          resultText += failures
            .map((f) => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`)
            .join('\n');
        }
        return textResult(resultText);
      }

      case 'create_label': {
        const validated = CreateLabelSchema.parse(args);
        const result = await createLabel(gmail, validated.name, {
          messageListVisibility: validated.messageListVisibility,
          labelListVisibility: validated.labelListVisibility,
        });
        return textResult(
          `Label created successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
        );
      }

      case 'update_label': {
        const validated = UpdateLabelSchema.parse(args);
        const updates: Record<string, unknown> = {};
        if (validated.name) updates.name = validated.name;
        if (validated.messageListVisibility)
          updates.messageListVisibility = validated.messageListVisibility;
        if (validated.labelListVisibility)
          updates.labelListVisibility = validated.labelListVisibility;

        const result = await updateLabel(gmail, validated.id, updates);
        return textResult(
          `Label updated successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
        );
      }

      case 'delete_label': {
        const validated = DeleteLabelSchema.parse(args);
        const result = await deleteLabel(gmail, validated.id);
        return textResult(result.message);
      }

      case 'get_or_create_label': {
        const validated = GetOrCreateLabelSchema.parse(args);
        const result = await getOrCreateLabel(gmail, validated.name, {
          messageListVisibility: validated.messageListVisibility,
          labelListVisibility: validated.labelListVisibility,
        });
        const action =
          result.type === 'user' && result.name === validated.name
            ? 'found existing'
            : 'created new';
        return textResult(
          `Successfully ${action} label:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
        );
      }

      case 'create_filter': {
        const validated = CreateFilterSchema.parse(args);
        const result = await createFilter(
          gmail,
          validated.criteria,
          validated.action,
        );

        const criteriaText = Object.entries(validated.criteria)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        const actionText = Object.entries(validated.action)
          .filter(
            ([, value]) =>
              value !== undefined && (Array.isArray(value) ? value.length > 0 : true),
          )
          .map(
            ([key, value]) =>
              `${key}: ${Array.isArray(value) ? value.join(', ') : value}`,
          )
          .join(', ');

        return textResult(
          `Filter created successfully:\nID: ${result.id}\nCriteria: ${criteriaText}\nActions: ${actionText}`,
        );
      }

      case 'list_filters': {
        const result = await listFilters(gmail);
        if (result.count === 0) return textResult('No filters found.');

        const filtersText = result.filters
          .map((filter) => {
            const criteriaEntries = Object.entries(filter.criteria || {})
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => `${key}: ${value}`)
              .join(', ');
            const actionEntries = Object.entries(filter.action || {})
              .filter(
                ([, value]) =>
                  value !== undefined &&
                  (Array.isArray(value) ? value.length > 0 : true),
              )
              .map(
                ([key, value]) =>
                  `${key}: ${Array.isArray(value) ? value.join(', ') : value}`,
              )
              .join(', ');

            return `ID: ${filter.id}\nCriteria: ${criteriaEntries}\nActions: ${actionEntries}\n`;
          })
          .join('\n');

        return textResult(`Found ${result.count} filters:\n\n${filtersText}`);
      }

      case 'get_filter': {
        const validated = GetFilterSchema.parse(args);
        const result = await getFilter(gmail, validated.filterId);

        const criteriaText = Object.entries(result.criteria || {})
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        const actionText = Object.entries(result.action || {})
          .filter(
            ([, value]) =>
              value !== undefined && (Array.isArray(value) ? value.length > 0 : true),
          )
          .map(
            ([key, value]) =>
              `${key}: ${Array.isArray(value) ? value.join(', ') : value}`,
          )
          .join(', ');

        return textResult(
          `Filter details:\nID: ${result.id}\nCriteria: ${criteriaText}\nActions: ${actionText}`,
        );
      }

      case 'delete_filter': {
        const validated = DeleteFilterSchema.parse(args);
        const result = await deleteFilter(gmail, validated.filterId);
        return textResult(result.message);
      }

      case 'create_filter_from_template': {
        const validated = CreateFilterFromTemplateSchema.parse(args);
        const { template, parameters: params } = validated;

        let filterConfig;
        switch (template) {
          case 'fromSender':
            if (!params.senderEmail)
              throw new Error('senderEmail is required for fromSender template');
            filterConfig = filterTemplates.fromSender(
              params.senderEmail,
              params.labelIds,
              params.archive,
            );
            break;
          case 'withSubject':
            if (!params.subjectText)
              throw new Error('subjectText is required for withSubject template');
            filterConfig = filterTemplates.withSubject(
              params.subjectText,
              params.labelIds,
              params.markAsRead,
            );
            break;
          case 'withAttachments':
            filterConfig = filterTemplates.withAttachments(params.labelIds);
            break;
          case 'largeEmails':
            if (!params.sizeInBytes)
              throw new Error('sizeInBytes is required for largeEmails template');
            filterConfig = filterTemplates.largeEmails(
              params.sizeInBytes,
              params.labelIds,
            );
            break;
          case 'containingText':
            if (!params.searchText)
              throw new Error('searchText is required for containingText template');
            filterConfig = filterTemplates.containingText(
              params.searchText,
              params.labelIds,
              params.markImportant,
            );
            break;
          case 'mailingList':
            if (!params.listIdentifier)
              throw new Error('listIdentifier is required for mailingList template');
            filterConfig = filterTemplates.mailingList(
              params.listIdentifier,
              params.labelIds,
              params.archive,
            );
            break;
          default:
            throw new Error(`Unknown template: ${template}`);
        }

        const result = await createFilter(
          gmail,
          filterConfig.criteria,
          filterConfig.action,
        );
        return textResult(
          `Filter created from template '${template}':\nID: ${result.id}\nTemplate used: ${template}`,
        );
      }

      default:
        return null;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown gmail tool error';
    ctx.log(`Gmail tool ${name} failed`, { error: message });
    return errorResponse(message);
  }
}

const gmailService: ServiceModule = {
  key: 'gmail',
  displayName: 'Gmail',
  toolDefinitions,
  handleTool,
};

export default gmailService;
