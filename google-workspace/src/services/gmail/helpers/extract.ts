/**
 * MIME extraction helpers for the Gmail service. Ported from upstream
 * Gmail-MCP-Server/src/index.ts (extractEmailContent + the inline
 * processAttachmentParts traversal).
 *
 * We deliberately keep the attachment LISTING (id, filename, mimeType,
 * size) even though we removed the `download_attachment` tool — knowing
 * an email has attachments is read-only metadata that helps an LLM
 * reason about the message.
 */

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface EmailContent {
  text: string;
  html: string;
}

export interface EmailAttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Recursively extract text/plain and text/html bodies from a MIME tree.
 */
export function extractEmailContent(messagePart: GmailMessagePart): EmailContent {
  let textContent = '';
  let htmlContent = '';

  if (messagePart.body && messagePart.body.data) {
    const content = Buffer.from(messagePart.body.data, 'base64').toString('utf8');
    if (messagePart.mimeType === 'text/plain') {
      textContent = content;
    } else if (messagePart.mimeType === 'text/html') {
      htmlContent = content;
    }
  }

  if (messagePart.parts && messagePart.parts.length > 0) {
    for (const part of messagePart.parts) {
      const { text, html } = extractEmailContent(part);
      if (text) textContent += text;
      if (html) htmlContent += html;
    }
  }

  return { text: textContent, html: htmlContent };
}

/**
 * Walk a MIME tree and collect attachment metadata (no payload data).
 */
export function collectAttachmentInfo(
  payload: GmailMessagePart | undefined,
): EmailAttachmentInfo[] {
  const attachments: EmailAttachmentInfo[] = [];
  if (!payload) return attachments;

  const visit = (part: GmailMessagePart): void => {
    if (part.body && part.body.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename || `attachment-${part.body.attachmentId}`,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
      });
    }
    if (part.parts) {
      for (const subpart of part.parts) visit(subpart);
    }
  };

  visit(payload);
  return attachments;
}
