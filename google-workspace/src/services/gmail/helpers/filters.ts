/**
 * Filter helpers for the Gmail service. Ported verbatim from upstream
 * Gmail-MCP-Server/src/filter-manager.ts.
 */
import type { gmail_v1 } from 'googleapis';

export interface GmailFilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: 'unspecified' | 'smaller' | 'larger';
}

export interface GmailFilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

export interface GmailFilter {
  id?: string;
  criteria: GmailFilterCriteria;
  action: GmailFilterAction;
}

export async function createFilter(
  gmail: gmail_v1.Gmail,
  criteria: GmailFilterCriteria,
  action: GmailFilterAction,
): Promise<GmailFilter> {
  try {
    const response = await gmail.users.settings.filters.create({
      userId: 'me',
      requestBody: { criteria, action } as any,
    });
    return response.data as GmailFilter;
  } catch (error: any) {
    if (error.code === 400) {
      throw new Error(`Invalid filter criteria or action: ${error.message}`);
    }
    throw new Error(`Failed to create filter: ${error.message}`);
  }
}

export async function listFilters(
  gmail: gmail_v1.Gmail,
): Promise<{ filters: GmailFilter[]; count: number }> {
  try {
    const response = await gmail.users.settings.filters.list({ userId: 'me' });
    const filters = (response.data.filter || []) as GmailFilter[];
    return { filters, count: filters.length };
  } catch (error: any) {
    throw new Error(`Failed to list filters: ${error.message}`);
  }
}

export async function getFilter(
  gmail: gmail_v1.Gmail,
  filterId: string,
): Promise<GmailFilter> {
  try {
    const response = await gmail.users.settings.filters.get({
      userId: 'me',
      id: filterId,
    });
    return response.data as GmailFilter;
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error(`Filter with ID "${filterId}" not found.`);
    }
    throw new Error(`Failed to get filter: ${error.message}`);
  }
}

export async function deleteFilter(
  gmail: gmail_v1.Gmail,
  filterId: string,
): Promise<{ success: true; message: string }> {
  try {
    await gmail.users.settings.filters.delete({ userId: 'me', id: filterId });
    return { success: true, message: `Filter "${filterId}" deleted successfully.` };
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error(`Filter with ID "${filterId}" not found.`);
    }
    throw new Error(`Failed to delete filter: ${error.message}`);
  }
}

/**
 * Helper functions to build common filter patterns.
 */
export const filterTemplates = {
  fromSender: (
    senderEmail: string,
    labelIds: string[] = [],
    archive: boolean = false,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { from: senderEmail },
    action: {
      addLabelIds: labelIds,
      removeLabelIds: archive ? ['INBOX'] : undefined,
    },
  }),

  withSubject: (
    subjectText: string,
    labelIds: string[] = [],
    markAsRead: boolean = false,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { subject: subjectText },
    action: {
      addLabelIds: labelIds,
      removeLabelIds: markAsRead ? ['UNREAD'] : undefined,
    },
  }),

  withAttachments: (
    labelIds: string[] = [],
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { hasAttachment: true },
    action: { addLabelIds: labelIds },
  }),

  largeEmails: (
    sizeInBytes: number,
    labelIds: string[] = [],
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { size: sizeInBytes, sizeComparison: 'larger' },
    action: { addLabelIds: labelIds },
  }),

  containingText: (
    searchText: string,
    labelIds: string[] = [],
    markImportant: boolean = false,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { query: `"${searchText}"` },
    action: {
      addLabelIds: markImportant ? [...labelIds, 'IMPORTANT'] : labelIds,
    },
  }),

  mailingList: (
    listIdentifier: string,
    labelIds: string[] = [],
    archive: boolean = true,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { query: `list:${listIdentifier} OR subject:[${listIdentifier}]` },
    action: {
      addLabelIds: labelIds,
      removeLabelIds: archive ? ['INBOX'] : undefined,
    },
  }),
};
