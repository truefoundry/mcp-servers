/**
 * Zod input schemas for the Gmail service tools. Ported from upstream
 * Gmail-MCP-Server/src/index.ts (lines 194-318) with these intentional
 * changes:
 *   - SendEmailSchema does NOT include the `attachments` field (upstream
 *     accepts local file paths, which are meaningless inside a container
 *     served behind the TFY LLM Gateway).
 *   - DownloadAttachmentSchema is omitted entirely (the corresponding tool
 *     is also omitted).
 */
import { z } from 'zod';

export const SendEmailSchema = z.object({
  to: z.array(z.string()).describe('List of recipient email addresses'),
  subject: z.string().describe('Email subject'),
  body: z
    .string()
    .describe('Email body content (used for text/plain or when htmlBody not provided)'),
  htmlBody: z.string().optional().describe('HTML version of the email body'),
  mimeType: z
    .enum(['text/plain', 'text/html', 'multipart/alternative'])
    .optional()
    .default('text/plain')
    .describe('Email content type'),
  cc: z.array(z.string()).optional().describe('List of CC recipients'),
  bcc: z.array(z.string()).optional().describe('List of BCC recipients'),
  threadId: z.string().optional().describe('Thread ID to reply to'),
  inReplyTo: z.string().optional().describe('Message ID being replied to'),
});

export const ReadEmailSchema = z.object({
  messageId: z.string().describe('ID of the email message to retrieve'),
});

export const SearchEmailsSchema = z.object({
  query: z
    .string()
    .describe("Gmail search query (e.g., 'from:example@gmail.com')"),
  maxResults: z.number().optional().describe('Maximum number of results to return'),
});

export const ModifyEmailSchema = z.object({
  messageId: z.string().describe('ID of the email message to modify'),
  labelIds: z
    .array(z.string())
    .optional()
    .describe('List of label IDs to apply'),
  addLabelIds: z
    .array(z.string())
    .optional()
    .describe('List of label IDs to add to the message'),
  removeLabelIds: z
    .array(z.string())
    .optional()
    .describe('List of label IDs to remove from the message'),
});

export const DeleteEmailSchema = z.object({
  messageId: z.string().describe('ID of the email message to delete'),
});

export const ListEmailLabelsSchema = z
  .object({})
  .describe('Retrieves all available Gmail labels');

export const CreateLabelSchema = z
  .object({
    name: z.string().describe('Name for the new label'),
    messageListVisibility: z
      .enum(['show', 'hide'])
      .optional()
      .describe('Whether to show or hide the label in the message list'),
    labelListVisibility: z
      .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
      .optional()
      .describe('Visibility of the label in the label list'),
  })
  .describe('Creates a new Gmail label');

export const UpdateLabelSchema = z
  .object({
    id: z.string().describe('ID of the label to update'),
    name: z.string().optional().describe('New name for the label'),
    messageListVisibility: z
      .enum(['show', 'hide'])
      .optional()
      .describe('Whether to show or hide the label in the message list'),
    labelListVisibility: z
      .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
      .optional()
      .describe('Visibility of the label in the label list'),
  })
  .describe('Updates an existing Gmail label');

export const DeleteLabelSchema = z
  .object({
    id: z.string().describe('ID of the label to delete'),
  })
  .describe('Deletes a Gmail label');

export const GetOrCreateLabelSchema = z
  .object({
    name: z.string().describe('Name of the label to get or create'),
    messageListVisibility: z
      .enum(['show', 'hide'])
      .optional()
      .describe('Whether to show or hide the label in the message list'),
    labelListVisibility: z
      .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
      .optional()
      .describe('Visibility of the label in the label list'),
  })
  .describe("Gets an existing label by name or creates it if it doesn't exist");

export const BatchModifyEmailsSchema = z.object({
  messageIds: z.array(z.string()).describe('List of message IDs to modify'),
  addLabelIds: z
    .array(z.string())
    .optional()
    .describe('List of label IDs to add to all messages'),
  removeLabelIds: z
    .array(z.string())
    .optional()
    .describe('List of label IDs to remove from all messages'),
  batchSize: z
    .number()
    .optional()
    .default(50)
    .describe('Number of messages to process in each batch (default: 50)'),
});

export const BatchDeleteEmailsSchema = z.object({
  messageIds: z.array(z.string()).describe('List of message IDs to delete'),
  batchSize: z
    .number()
    .optional()
    .default(50)
    .describe('Number of messages to process in each batch (default: 50)'),
});

export const CreateFilterSchema = z
  .object({
    criteria: z
      .object({
        from: z.string().optional().describe('Sender email address to match'),
        to: z.string().optional().describe('Recipient email address to match'),
        subject: z.string().optional().describe('Subject text to match'),
        query: z
          .string()
          .optional()
          .describe("Gmail search query (e.g., 'has:attachment')"),
        negatedQuery: z
          .string()
          .optional()
          .describe('Text that must NOT be present'),
        hasAttachment: z
          .boolean()
          .optional()
          .describe('Whether to match emails with attachments'),
        excludeChats: z
          .boolean()
          .optional()
          .describe('Whether to exclude chat messages'),
        size: z.number().optional().describe('Email size in bytes'),
        sizeComparison: z
          .enum(['unspecified', 'smaller', 'larger'])
          .optional()
          .describe('Size comparison operator'),
      })
      .describe('Criteria for matching emails'),
    action: z
      .object({
        addLabelIds: z
          .array(z.string())
          .optional()
          .describe('Label IDs to add to matching emails'),
        removeLabelIds: z
          .array(z.string())
          .optional()
          .describe('Label IDs to remove from matching emails'),
        forward: z
          .string()
          .optional()
          .describe('Email address to forward matching emails to'),
      })
      .describe('Actions to perform on matching emails'),
  })
  .describe('Creates a new Gmail filter');

export const ListFiltersSchema = z
  .object({})
  .describe('Retrieves all Gmail filters');

export const GetFilterSchema = z
  .object({
    filterId: z.string().describe('ID of the filter to retrieve'),
  })
  .describe('Gets details of a specific Gmail filter');

export const DeleteFilterSchema = z
  .object({
    filterId: z.string().describe('ID of the filter to delete'),
  })
  .describe('Deletes a Gmail filter');

export const CreateFilterFromTemplateSchema = z
  .object({
    template: z
      .enum([
        'fromSender',
        'withSubject',
        'withAttachments',
        'largeEmails',
        'containingText',
        'mailingList',
      ])
      .describe('Pre-defined filter template to use'),
    parameters: z
      .object({
        senderEmail: z
          .string()
          .optional()
          .describe('Sender email (for fromSender template)'),
        subjectText: z
          .string()
          .optional()
          .describe('Subject text (for withSubject template)'),
        searchText: z
          .string()
          .optional()
          .describe('Text to search for (for containingText template)'),
        listIdentifier: z
          .string()
          .optional()
          .describe('Mailing list identifier (for mailingList template)'),
        sizeInBytes: z
          .number()
          .optional()
          .describe('Size threshold in bytes (for largeEmails template)'),
        labelIds: z.array(z.string()).optional().describe('Label IDs to apply'),
        archive: z
          .boolean()
          .optional()
          .describe('Whether to archive (skip inbox)'),
        markAsRead: z
          .boolean()
          .optional()
          .describe('Whether to mark as read'),
        markImportant: z
          .boolean()
          .optional()
          .describe('Whether to mark as important'),
      })
      .describe('Template-specific parameters'),
  })
  .describe('Creates a filter using a pre-defined template');
