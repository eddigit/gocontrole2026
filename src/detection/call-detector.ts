import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('call-detector');

export interface CallEventData {
  targetJid: string;
  waCallId: string;
  callerJid: string;
  callType: 'VOICE' | 'VIDEO';
  status: string;
  isGroup: boolean;
  groupJid: string | null;
  timestamp: Date;
}

/**
 * Call Detector
 *
 * Detects incoming and outgoing WhatsApp voice/video calls
 * via the 'call' Baileys event.
 */
export class CallDetector extends EventEmitter {
  private monitoredJids = new Set<string>();
  private activeCallTimers = new Map<string, NodeJS.Timeout>();
  private callStartTimes = new Map<string, Date>();

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

    this.connection.onBaileysEvent('call', (calls) => {
      for (const call of calls as any[]) {
        this.handleCall(call).catch(err => {
          log.error({ err }, 'Error handling call event');
        });
      }
    });

    log.info({ count: jids.length }, 'Call detector started');
  }

  addJid(jid: string): void {
    this.monitoredJids.add(jid);
  }

  removeJid(jid: string): void {
    this.monitoredJids.delete(jid);
  }

  stop(): void {
    for (const timer of this.activeCallTimers.values()) {
      clearTimeout(timer);
    }
    this.activeCallTimers.clear();
    this.callStartTimes.clear();
    this.monitoredJids.clear();
    log.info('Call detector stopped');
  }

  private async handleCall(call: any): Promise<void> {
    const callerJid = call.from;
    if (!callerJid) return;

    // Check if the caller is a monitored target
    const monitoredTarget = this.findMonitoredJid(callerJid, call.chatId);
    if (!monitoredTarget) return;

    const statusMap: Record<string, string> = {
      offer: 'OFFER',
      ringing: 'RINGING',
      accept: 'ACCEPTED',
      reject: 'REJECTED',
      timeout: 'TIMEOUT',
      terminate: 'TERMINATED',
    };

    const status = statusMap[call.status] || 'OFFER';

    // Track call duration
    const callId = call.id || `call_${Date.now()}`;
    let duration: number | undefined;

    if (status === 'ACCEPTED') {
      this.callStartTimes.set(callId, new Date());
    } else if (status === 'TERMINATED' || status === 'REJECTED' || status === 'TIMEOUT') {
      const startTime = this.callStartTimes.get(callId);
      if (startTime) {
        duration = Math.round((Date.now() - startTime.getTime()) / 1000);
        this.callStartTimes.delete(callId);
      }
    }

    // If call was not answered, mark as MISSED
    const finalStatus = (status === 'TIMEOUT' && !this.callStartTimes.has(callId))
      ? 'MISSED'
      : status;

    const event: CallEventData = {
      targetJid: monitoredTarget,
      waCallId: callId,
      callerJid: this.normalizeJid(callerJid),
      callType: call.isVideo ? 'VIDEO' : 'VOICE',
      status: finalStatus,
      isGroup: !!call.isGroup,
      groupJid: call.groupJid || null,
      timestamp: call.date ? new Date(call.date) : new Date(),
    };

    // Persist to database
    await this.persistCall(event, duration);

    // Emit for real-time broadcasting
    this.emit('call', event);

    log.info({
      targetJid: monitoredTarget,
      callType: event.callType,
      status: event.status,
    }, 'Call event detected');
  }

  private async persistCall(event: CallEventData, duration?: number): Promise<void> {
    try {
      const target = await this.prisma.target.findUnique({
        where: { jid: event.targetJid },
        select: { id: true },
      });
      if (!target) return;

      await this.prisma.callEvent.create({
        data: {
          targetId: target.id,
          waCallId: event.waCallId,
          callerJid: event.callerJid,
          callType: event.callType as any,
          status: event.status as any,
          isGroup: event.isGroup,
          groupJid: event.groupJid,
          duration,
          timestamp: event.timestamp,
        },
      });
    } catch (err) {
      log.error({ err, targetJid: event.targetJid }, 'Failed to persist call event');
    }
  }

  private findMonitoredJid(callerJid: string, chatId?: string): string | null {
    const normalizedCaller = this.normalizeJid(callerJid);

    for (const jid of this.monitoredJids) {
      const normalized = this.normalizeJid(jid);
      if (normalized === normalizedCaller) return jid;
    }

    if (chatId) {
      const normalizedChat = this.normalizeJid(chatId);
      for (const jid of this.monitoredJids) {
        const normalized = this.normalizeJid(jid);
        if (normalized === normalizedChat) return jid;
      }
    }

    return null;
  }

  private normalizeJid(jid: string): string {
    return jid.replace(/:.*@/, '@').split('@')[0];
  }
}
