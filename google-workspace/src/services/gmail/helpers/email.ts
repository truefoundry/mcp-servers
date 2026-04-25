/**
 * Email helpers for the Gmail service. Ported from upstream
 * Gmail-MCP-Server/src/utl.ts. The attachment-aware
 * `createEmailWithNodemailer` helper is intentionally NOT ported, since
 * the upstream version reads files from the local filesystem (which is
 * useless behind the TFY LLM Gateway).
 */

/**
 * RFC 2047 MIME word encoding for header values that contain non-ASCII
 * characters.
 */
function encodeEmailHeader(text: string): string {
  if (/[^\x00-\x7F]/.test(text)) {
    return '=?UTF-8?B?' + Buffer.from(text).toString('base64') + '?=';
  }
  return text;
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

interface EmailMessageArgs {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  htmlBody?: string;
  mimeType?: 'text/plain' | 'text/html' | 'multipart/alternative';
  inReplyTo?: string;
}

/**
 * Build a raw RFC 822 message string ready to be base64url-encoded for
 * Gmail's `users.messages.send` / `users.drafts.create`.
 */
export function createEmailMessage(validatedArgs: EmailMessageArgs): string {
  const encodedSubject = encodeEmailHeader(validatedArgs.subject);
  let mimeType = validatedArgs.mimeType || 'text/plain';

  if (validatedArgs.htmlBody && mimeType !== 'text/plain') {
    mimeType = 'multipart/alternative';
  }

  const boundary = `----=_NextPart_${Math.random().toString(36).substring(2)}`;

  validatedArgs.to.forEach((email) => {
    if (!validateEmail(email)) {
      throw new Error(`Recipient email address is invalid: ${email}`);
    }
  });

  const emailParts = [
    'From: me',
    `To: ${validatedArgs.to.join(', ')}`,
    validatedArgs.cc ? `Cc: ${validatedArgs.cc.join(', ')}` : '',
    validatedArgs.bcc ? `Bcc: ${validatedArgs.bcc.join(', ')}` : '',
    `Subject: ${encodedSubject}`,
    validatedArgs.inReplyTo ? `In-Reply-To: ${validatedArgs.inReplyTo}` : '',
    validatedArgs.inReplyTo ? `References: ${validatedArgs.inReplyTo}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (mimeType === 'multipart/alternative') {
    emailParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    emailParts.push('');

    emailParts.push(`--${boundary}`);
    emailParts.push('Content-Type: text/plain; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(validatedArgs.body);
    emailParts.push('');

    emailParts.push(`--${boundary}`);
    emailParts.push('Content-Type: text/html; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(validatedArgs.htmlBody || validatedArgs.body);
    emailParts.push('');

    emailParts.push(`--${boundary}--`);
  } else if (mimeType === 'text/html') {
    emailParts.push('Content-Type: text/html; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(validatedArgs.htmlBody || validatedArgs.body);
  } else {
    emailParts.push('Content-Type: text/plain; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(validatedArgs.body);
  }

  return emailParts.join('\r\n');
}

/**
 * Base64url-encode a raw RFC 822 message for Gmail's `raw` field.
 */
export function encodeMessageForGmail(rawMessage: string): string {
  return Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
