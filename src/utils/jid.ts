/**
 * Convert a phone number to a WhatsApp JID.
 * Strips any non-digit characters and appends @s.whatsapp.net
 */
export function phoneToJid(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) {
    throw new Error(`Invalid phone number: ${phoneNumber}`);
  }
  return `${digits}@s.whatsapp.net`;
}

/**
 * Extract the phone number from a WhatsApp JID.
 */
export function jidToPhone(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '');
}

/**
 * Validate a JID format.
 */
export function isValidJid(jid: string): boolean {
  return /^\d{6,15}@s\.whatsapp\.net$/.test(jid);
}

/**
 * Format a phone number for display (basic international format).
 */
export function formatPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  return `+${digits}`;
}
