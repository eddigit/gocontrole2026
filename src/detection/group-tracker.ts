import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
import { findOrCreateTarget } from '../utils/find-or-create-target.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('group-tracker');

export interface GroupActivityEvent {
  targetJid: string;
  groupJid: string;
  groupName: string | null;
  eventType: string;
  actorJid: string | null;
  affectedJid: string | null;
  detail: string | null;
  timestamp: Date;
}

/**
 * Group Activity Tracker
 *
 * Monitors ALL WhatsApp group events (no JID filter):
 * - Participant changes (join/leave/promote/demote)
 * - Group metadata changes (subject, description, icon)
 */
export class GroupTracker extends EventEmitter {
  constructor(
    private readonly connection: ConnectionManager,
    private readonly prisma: PrismaClient,
    private readonly sessionId: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    // Listen for group participant changes
    this.connection.onBaileysEvent('group-participants.update', (update) => {
      this.handleParticipantUpdate(update as any).catch(err => {
        log.error({ err }, 'Error handling group participant update');
      });
    });

    // Listen for group metadata changes
    this.connection.onBaileysEvent('groups.update', (updates) => {
      for (const update of updates as any[]) {
        this.handleGroupUpdate(update).catch(err => {
          log.error({ err }, 'Error handling group update');
        });
      }
    });

    log.info('Group tracker started (capturing all group activity)');
  }

  stop(): void {
    log.info('Group tracker stopped');
  }

  private async handleParticipantUpdate(update: {
    id: string;
    participants: string[];
    action: 'add' | 'remove' | 'promote' | 'demote';
  }): Promise<void> {
    const groupJid = update.id;

    const actionMap: Record<string, string> = {
      add: 'PARTICIPANT_ADDED',
      remove: 'PARTICIPANT_REMOVED',
      promote: 'PARTICIPANT_PROMOTED',
      demote: 'PARTICIPANT_DEMOTED',
    };

    for (const participant of update.participants) {
      const normalizedJid = this.normalizeJid(participant);
      const targetId = await findOrCreateTarget(this.prisma, normalizedJid, this.sessionId);
      if (!targetId) continue;

      const event: GroupActivityEvent = {
        targetJid: normalizedJid,
        groupJid,
        groupName: null,
        eventType: actionMap[update.action] || 'SETTINGS_CHANGED',
        actorJid: null,
        affectedJid: normalizedJid,
        detail: `${update.action} dans le groupe`,
        timestamp: new Date(),
      };

      await this.persistGroupActivity(event, targetId);
      this.emit('group:activity', event);

      log.debug({ targetJid: normalizedJid, groupJid, action: update.action }, 'Group participant event');
    }
  }

  private async handleGroupUpdate(update: any): Promise<void> {
    const groupJid = update.id;
    if (!groupJid) return;

    const events: { eventType: string; detail: string; actorJid: string | null }[] = [];

    if (update.subject) {
      events.push({
        eventType: 'SUBJECT_CHANGED',
        actorJid: update.subjectOwner || null,
        detail: `Sujet change: ${update.subject}`,
      });
    }

    if (update.desc) {
      events.push({
        eventType: 'DESCRIPTION_CHANGED',
        actorJid: update.descOwner || null,
        detail: `Description modifiee`,
      });
    }

    // Store group updates linked to the session owner (the child)
    // We use sessionId to find the child's own JID target
    for (const ev of events) {
      // Use session's own phone as the target (the child is in the group)
      const session = await this.prisma.session.findUnique({
        where: { id: this.sessionId },
        select: { phoneNumber: true },
      });
      if (!session?.phoneNumber) continue;

      const childJid = `${session.phoneNumber}@s.whatsapp.net`;
      const targetId = await findOrCreateTarget(this.prisma, childJid, this.sessionId);
      if (!targetId) continue;

      const event: GroupActivityEvent = {
        targetJid: childJid,
        groupJid,
        groupName: update.subject || null,
        eventType: ev.eventType,
        actorJid: ev.actorJid,
        affectedJid: null,
        detail: ev.detail,
        timestamp: new Date(),
      };

      await this.persistGroupActivity(event, targetId);
      this.emit('group:activity', event);
    }
  }

  private async persistGroupActivity(event: GroupActivityEvent, targetId: string): Promise<void> {
    try {
      await this.prisma.groupActivity.create({
        data: {
          targetId,
          groupJid: event.groupJid,
          groupName: event.groupName,
          eventType: event.eventType as any,
          actorJid: event.actorJid,
          affectedJid: event.affectedJid,
          detail: event.detail,
          timestamp: event.timestamp,
        },
      });
    } catch (err) {
      log.error({ err, targetJid: event.targetJid }, 'Failed to persist group activity');
    }
  }

  private normalizeJid(jid: string): string {
    return jid.replace(/:.*@/, '@');
  }
}
