import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
import { findOrCreateTarget } from '../utils/find-or-create-target.js';
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
 * Detects ALL incoming and outgoing WhatsApp voice/video calls
 * via the 'call' Baileys event. No JID filter — captures everything.
 */
export class CallDetector extends EventEmitter {
  private activeCallTimers = new Map<string, NodeJS.Timeout>();
  private callStartTimes = new Map<string, Date>();

  constructor(
    private readonly connection: ConnectionManager,
    private readonly prisma: PrismaClient,
    private readonly sessionId: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    this.connection.onBaileysEvent('call', (calls) => {
      for (const call of calls as any[]) {
        this.handleCall(call).catch(err => {
          log.error({ err }, 'Error handling call event');
        });
      }
    });

    log.info('Call detector started (capturing all calls)');
  }

  stop(): void {
    for (const timer of this.activeCallTimers.values()) {
      clearTimeout(timer);
    }
    this.activeCallTimers.clear();
    this.callStartTimes.clear();
    log.info('Call detector stopped');
  }

  private async handleCall(call: any): Promise<void> {
    const callerJid = call.from;
    if (!callerJid) return;

    const normalizedCaller = this.normalizeJid(callerJid);

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
      targetJid: normalizedCaller,
      waCallId: callId,
      callerJid: normalizedCaller,
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
      targetJid: normalizedCaller,
      callType: event.callType,
      status: event.status,
    }, 'Call event detected');
  }

  private async persistCall(event: CallEventData, duration?: number): Promise<void> {
    try {
      const targetId = await findOrCreateTarget(this.prisma, event.targetJid, this.sessionId);
      if (!targetId) return;

      await this.prisma.callEvent.create({
        data: {
          targetId,
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

  private normalizeJid(jid: string): string {
    return jid.replace(/:.*@/, '@');
  }
}
