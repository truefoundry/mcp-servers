/**
 * Label helpers for the Gmail service. Ported verbatim from upstream
 * Gmail-MCP-Server/src/label-manager.ts; only typing on the `gmail` arg
 * has been tightened to googleapis' gmail_v1.Gmail.
 */
import type { gmail_v1 } from 'googleapis';

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
}

export interface LabelOptions {
  messageListVisibility?: string;
  labelListVisibility?: string;
}

export async function createLabel(
  gmail: gmail_v1.Gmail,
  labelName: string,
  options: LabelOptions = {},
): Promise<GmailLabel> {
  try {
    const messageListVisibility = options.messageListVisibility || 'show';
    const labelListVisibility = options.labelListVisibility || 'labelShow';

    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        messageListVisibility,
        labelListVisibility,
      },
    });

    return response.data as GmailLabel;
  } catch (error: any) {
    if (error.message && error.message.includes('already exists')) {
      throw new Error(`Label "${labelName}" already exists. Please use a different name.`);
    }
    throw new Error(`Failed to create label: ${error.message}`);
  }
}

export async function updateLabel(
  gmail: gmail_v1.Gmail,
  labelId: string,
  updates: {
    name?: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
  },
): Promise<GmailLabel> {
  try {
    await gmail.users.labels.get({ userId: 'me', id: labelId });

    const response = await gmail.users.labels.update({
      userId: 'me',
      id: labelId,
      requestBody: updates,
    });

    return response.data as GmailLabel;
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error(`Label with ID "${labelId}" not found.`);
    }
    throw new Error(`Failed to update label: ${error.message}`);
  }
}

export async function deleteLabel(
  gmail: gmail_v1.Gmail,
  labelId: string,
): Promise<{ success: true; message: string }> {
  try {
    const label = await gmail.users.labels.get({ userId: 'me', id: labelId });

    if (label.data.type === 'system') {
      throw new Error(`Cannot delete system label with ID "${labelId}".`);
    }

    await gmail.users.labels.delete({ userId: 'me', id: labelId });

    return {
      success: true,
      message: `Label "${label.data.name}" deleted successfully.`,
    };
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error(`Label with ID "${labelId}" not found.`);
    }
    throw new Error(`Failed to delete label: ${error.message}`);
  }
}

export interface ListLabelsResult {
  all: GmailLabel[];
  system: GmailLabel[];
  user: GmailLabel[];
  count: { total: number; system: number; user: number };
}

export async function listLabels(gmail: gmail_v1.Gmail): Promise<ListLabelsResult> {
  try {
    const response = await gmail.users.labels.list({ userId: 'me' });
    const labels = (response.data.labels || []) as GmailLabel[];

    const systemLabels = labels.filter((label) => label.type === 'system');
    const userLabels = labels.filter((label) => label.type === 'user');

    return {
      all: labels,
      system: systemLabels,
      user: userLabels,
      count: {
        total: labels.length,
        system: systemLabels.length,
        user: userLabels.length,
      },
    };
  } catch (error: any) {
    throw new Error(`Failed to list labels: ${error.message}`);
  }
}

export async function findLabelByName(
  gmail: gmail_v1.Gmail,
  labelName: string,
): Promise<GmailLabel | null> {
  try {
    const labelsResponse = await listLabels(gmail);
    const allLabels = labelsResponse.all;

    const foundLabel = allLabels.find(
      (label) => label.name.toLowerCase() === labelName.toLowerCase(),
    );

    return foundLabel || null;
  } catch (error: any) {
    throw new Error(`Failed to find label: ${error.message}`);
  }
}

export async function getOrCreateLabel(
  gmail: gmail_v1.Gmail,
  labelName: string,
  options: LabelOptions = {},
): Promise<GmailLabel> {
  try {
    const existingLabel = await findLabelByName(gmail, labelName);
    if (existingLabel) return existingLabel;
    return await createLabel(gmail, labelName, options);
  } catch (error: any) {
    throw new Error(`Failed to get or create label: ${error.message}`);
  }
}
