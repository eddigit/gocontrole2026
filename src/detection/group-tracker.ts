import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
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
 * Monitors WhatsApp group events:
 * - Participant changes (join/leave/promote/demote)
 * - Group metadata changes (subject, description, icon)
 * - Group settings changes
 */
export class GroupTracker extends EventEmitter {
  private monitoredJids = new Set<string>();

  constructor(
    private readonly connection: ConnectionManager,
    private readonly prisma: PrismaClient,
  ) {
    super();
  }

  async start(jids: string[]): Promise<void> {
    for (const jid of jids) {
      this.monitoredJids.add(jid);
    }

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

    log.info({ count: jids.length }, 'Group tracker started');
  }

  addJid(jid: string): void {
    this.monitoredJids.add(jid);
  }

  removeJid(jid: string): void {
    this.monitoredJids.delete(jid);
  }

  stop(): void {
    this.monitoredJids.clear();
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
      // Check if the participant is someone we monitor
      const monitoredTarget = this.findMonitoredJid(participant);
      if (!monitoredTarget) continue;

      const event: GroupActivityEvent = {
        targetJid: monitoredTarget,
        groupJid,
        groupName: null,
        eventType: actionMap[update.action] || 'SETTINGS_CHANGED',
        actorJid: null,
        affectedJid: this.normalizeJid(participant),
        detail: `${update.action} dans le groupe`,
        timestamp: new Date(),
      };

      await this.persistGroupActivity(event);
      this.emit('group:activity', event);

      log.debug({ targetJid: monitoredTarget, groupJid, action: update.action }, 'Group participant event');
    }
  }

  private async handleGroupUpdate(update: any): Promise<void> {
    const groupJid = update.id;
    if (!groupJid) return;

    // We need to check if any of our monitored targets are in this group
    // For simplicity, we store all group events and filter later
    const events: GroupActivityEvent[] = [];

    if (update.subject) {
      events.push({
        targetJid: '', // Will be filled per monitored target
        groupJid,
        groupName: update.subject,
        eventType: 'SUBJECT_CHANGED',
        actorJid: update.subjectOwner || null,
        affectedJid: null,
        detail: `Sujet change: ${update.subject}`,
        timestamp: new Date(),
      });
    }

    if (update.desc) {
      events.push({
        targetJid: '',
        groupJid,
        groupName: update.subject || null,
        eventType: 'DESCRIPTION_CHANGED',
        actorJid: update.descOwner || null,
        affectedJid: null,
        detail: `Description modifiee`,
        timestamp: new Date(),
      });
    }

    // Persist for all monitored targets (they might be in the group)
    for (const event of events) {
      for (const jid of this.monitoredJids) {
        const targetEvent = { ...event, targetJid: jid };
        await this.persistGroupActivity(targetEvent);
        this.emit('group:activity', targetEvent);
      }
    }
  }

  private async persistGroupActivity(event: GroupActivityEvent): Promise<void> {
    try {
      const target = await this.prisma.target.findUnique({
        where: { jid: event.targetJid },
        select: { id: true },
      });
      if (!target) return;

      await this.prisma.groupActivity.create({
        data: {
          targetId: target.id,
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

  private findMonitoredJid(jid: string): string | null {
    const normalized = this.normalizeJid(jid);
    for (const monitored of this.monitoredJids) {
      if (this.normalizeJid(monitored) === normalized) return monitored;
    }
    return null;
  }

  private normalizeJid(jid: string): string {
    return jid.replace(/:.*@/, '@').split('@')[0];
  }
}
