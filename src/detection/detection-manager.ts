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
 * Ensures detectors are created once per session and new targets can be
 * added/removed dynamically without recreating everything.
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
   * Wire detection for all active targets on all connected sessions.
   * Safe to call multiple times — existing detectors are reused.
   */
  async wireAll(): Promise<void> {
    const targets = await this.prisma.target.findMany({ where: { isActive: true } });

    // Group targets by session
    const targetsBySession = new Map<string, string[]>();
    for (const target of targets) {
      this.signalAggregator.addTarget(target.jid);
      const list = targetsBySession.get(target.sessionId) ?? [];
      list.push(target.jid);
      targetsBySession.set(target.sessionId, list);
    }

    for (const [sessionId, jids] of targetsBySession) {
      await this.wireSession(sessionId, jids);
    }
  }

  /**
   * Wire or update detection for a specific session.
   */
  async wireSession(sessionId: string, jids: string[]): Promise<void> {
    const conn = this.sessionManager.getConnection(sessionId);
    if (!conn?.isConnected) return;

    // If detectors already exist for this session, just add new JIDs
    const existing = this.sessionDetectors.get(sessionId);
    if (existing) {
      for (const jid of jids) {
        await this.addJidToDetectors(existing, jid);
      }
      log.info({ sessionId, newJids: jids.length }, 'Added targets to existing detectors');
      return;
    }

    // Create fresh detectors for this session
    const detectors = await this.createDetectors(sessionId, jids);
    if (detectors) {
      this.sessionDetectors.set(sessionId, detectors);
      log.info({ sessionId, targetCount: jids.length }, 'All 6 detection methods wired');
    }
  }

  /**
   * Add a single target to detection on a specific session.
   * Called when a new target is created via the API.
   */
  async addTarget(sessionId: string, jid: string): Promise<void> {
    this.signalAggregator.addTarget(jid);

    const detectors = this.sessionDetectors.get(sessionId);
    if (detectors) {
      await this.addJidToDetectors(detectors, jid);
      log.info({ sessionId, jid }, 'Target added to detection pipeline');
    } else {
      // No detectors for this session yet — wire the whole session
      await this.wireSession(sessionId, [jid]);
    }
  }

  /**
   * Remove a target from detection.
   */
  removeTarget(jid: string): void {
    this.signalAggregator.removeTarget(jid);

    for (const [, detectors] of this.sessionDetectors) {
      detectors.presenceSubscriber.unsubscribe(jid);
      detectors.rttProber.stopProbing(jid);
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

    // Method 1: Presence Subscriber
    const presenceSubscriber = new PresenceSubscriber(conn);
    presenceSubscriber.on('signal', (signal) => this.signalAggregator.ingestSignal(signal));
    await presenceSubscriber.start(jids);

    // Method 2: RTT Prober
    const rttProber = new RttProber(conn);
    rttProber.on('signal', (signal) => this.signalAggregator.ingestSignal(signal));
    await rttProber.start(jids);

    // Method 3: Behavioral Detector
    const behavioralDetector = new BehavioralDetector(conn);
    behavioralDetector.on('signal', (signal) => this.signalAggregator.ingestSignal(signal));
    await behavioralDetector.start(jids);

    // Method 4: Message Interceptor
    const messageInterceptor = new MessageInterceptor(conn, this.prisma);
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
    await messageInterceptor.start(jids);

    // Method 5: Call Detector
    const callDetector = new CallDetector(conn, this.prisma);
    if (this.io) {
      callDetector.on('call', (event) => {
        this.io!.to(`target:${event.targetJid}`).emit('call:event', event);
        this.io!.emit('dashboard:call', event);
      });
    }
    await callDetector.start(jids);

    // Method 6: Group Tracker
    const groupTracker = new GroupTracker(conn, this.prisma);
    if (this.io) {
      groupTracker.on('group:activity', (event) => {
        this.io!.to(`target:${event.targetJid}`).emit('group:activity', event);
      });
    }
    await groupTracker.start(jids);

    return {
      presenceSubscriber,
      rttProber,
      behavioralDetector,
      messageInterceptor,
      callDetector,
      groupTracker,
    };
  }

  private async addJidToDetectors(detectors: SessionDetectors, jid: string): Promise<void> {
    await detectors.presenceSubscriber.subscribe(jid);
    detectors.rttProber.startProbing(jid);
    // MessageInterceptor, CallDetector, GroupTracker listen to all events
    // from the session — they filter by monitored JIDs internally.
    // Adding the JID to their internal tracking is handled by their start() method
    // which listens to Baileys events. New JIDs are automatically covered.
  }
}
