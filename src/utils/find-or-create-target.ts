import type { PrismaClient } from '@prisma/client';
import { createChildLogger } from './logger.js';

const log = createChildLogger('find-or-create-target');

/**
 * Find an existing Target by JID, or auto-create one linked to the session.
 * Used by MessageInterceptor, CallDetector, and GroupTracker to auto-populate
 * contacts as traffic flows through (parental control model: capture everything).
 *
 * Returns the Target ID, or null if the JID is invalid (e.g. group JIDs for
 * individual-target lookup).
 */
export async function findOrCreateTarget(
  prisma: PrismaClient,
  jid: string,
  sessionId: string,
): Promise<string | null> {
  // Skip group JIDs — they end with @g.us
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) {
    return null;
  }

  // Normalize: strip device suffix (e.g. 1234:5@s.whatsapp.net → 1234@s.whatsapp.net)
  const normalizedJid = jid.replace(/:.*@/, '@');

  try {
    const existing = await prisma.target.findUnique({
      where: { jid: normalizedJid },
      select: { id: true },
    });

    if (existing) return existing.id;

    // Auto-create target
    const phoneNumber = normalizedJid.replace('@s.whatsapp.net', '');
    const target = await prisma.target.create({
      data: {
        jid: normalizedJid,
        phoneNumber,
        sessionId,
        isActive: true,
      },
    });

    log.info({ jid: normalizedJid, targetId: target.id }, 'Auto-created target for new contact');
    return target.id;
  } catch (err: any) {
    // Handle race condition: another process created the target between findUnique and create
    if (err?.code === 'P2002') {
      const existing = await prisma.target.findUnique({
        where: { jid: normalizedJid },
        select: { id: true },
      });
      return existing?.id ?? null;
    }
    log.error({ err, jid: normalizedJid }, 'Failed to find or create target');
    return null;
  }
}
