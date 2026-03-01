import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { ConfidenceEngine } from './confidence-engine.js';
import type { AnySignal, ConfidenceScore, PresenceSignal, RttSignal } from './types.js';
import { createChildLogger } from '../utils/logger.js';
import { DETECTION } from '../config/constants.js';

const log = createChildLogger('signal-aggregator');

/**
 * Signal Aggregator
 *
 * Central hub that receives signals from all 3 detection methods,
 * feeds them to the ConfidenceEngine, persists events to the DB,
 * and emits computed scores for real-time broadcasting.
 */
export class SignalAggregator extends EventEmitter {
  private confidenceEngine = new ConfidenceEngine();
  private decayTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  /**
   * Initialize tracking for a target.
   */
  addTarget(jid: string): void {
    this.confidenceEngine.initTarget(jid);
  }

  /**
   * Remove tracking for a target.
   */
  removeTarget(jid: string): void {
    this.confidenceEngine.removeTarget(jid);
  }

  /**
   * Start the aggregator (decay timer, snapshot timer).
   */
  start(): void {
    // Periodic confidence decay
    this.decayTimer = setInterval(() => {
      const decayed = this.confidenceEngine.decayAll();
      for (const score of decayed) {
        this.emit('score', score);
        this.updateTargetStatus(score);
      }
    }, DETECTION.SNAPSHOT_INTERVAL_MS);

    log.info('Signal aggregator started');
  }

  /**
   * Stop the aggregator.
   */
  stop(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    log.info('Signal aggregator stopped');
  }

  /**
   * Ingest a new signal from any detection method.
   */
  async ingestSignal(signal: AnySignal): Promise<void> {
    // Persist raw event to DB (async, non-blocking)
    this.persistSignal(signal).catch(err => {
      log.error({ err, signal: signal.method, jid: signal.jid }, 'Failed to persist signal');
    });

    // Compute confidence score
    const score = this.confidenceEngine.processSignal(signal);
    if (!score) return;

    // Emit for real-time broadcasting
    this.emit('score', score);

    // Update target status in DB
    await this.updateTargetStatus(score).catch(err => {
      log.error({ err, jid: score.jid }, 'Failed to update target status');
    });
  }

  /**
   * Get the current confidence score for a target.
   */
  getCurrentScore(jid: string): ConfidenceScore | null {
    const state = this.confidenceEngine.getState(jid);
    if (!state) return null;

    return {
      jid: state.jid,
      status: state.currentStatus,
      confidence: state.currentConfidence,
      signals: [...state.recentSignals],
      reasoning: 'Current state',
      timestamp: new Date(),
    };
  }

  /**
   * Persist a raw signal event to the database.
   */
  private async persistSignal(signal: AnySignal): Promise<void> {
    // Find the target
    const target = await this.prisma.target.findUnique({
      where: { jid: signal.jid },
      select: { id: true },
    });
    if (!target) return;

    switch (signal.method) {
      case 'presence': {
        const ps = signal as PresenceSignal;
        const stateMap: Record<string, string> = {
          available: 'AVAILABLE',
          unavailable: 'UNAVAILABLE',
          composing: 'COMPOSING',
          recording: 'RECORDING',
          paused: 'PAUSED',
        };
        await this.prisma.presenceEvent.create({
          data: {
            targetId: target.id,
            state: stateMap[ps.state] as any,
            timestamp: ps.timestamp,
          },
        });
        break;
      }
      case 'rtt': {
        const rs = signal as RttSignal;
        await this.prisma.rttProbe.create({
          data: {
            targetId: target.id,
            rttMs: rs.rttMs,
            movingAvg: rs.movingAvg,
            medianRtt: rs.medianRtt,
            classification: rs.classification,
            timestamp: rs.timestamp,
          },
        });
        break;
      }
      // Behavioral signals are recorded as presence events (composing/recording)
      // or don't need separate persistence
    }
  }

  /**
   * Update the target's current status in the DB.
   */
  private async updateTargetStatus(score: ConfidenceScore): Promise<void> {
    await this.prisma.target.update({
      where: { jid: score.jid },
      data: {
        status: score.status,
        confidence: score.confidence,
        lastSeen: score.status === 'ONLINE' || score.status === 'LIKELY_ONLINE'
          ? score.timestamp
          : undefined,
        updatedAt: score.timestamp,
      },
    }).catch(() => {
      // Target may have been deleted
    });

    // Save snapshot periodically (not on every signal to avoid DB overload)
    // This is handled by the snapshot timer or on significant changes
    const state = this.confidenceEngine.getState(score.jid);
    if (state) {
      const timeSinceChange = Date.now() - state.lastStatusChangeTime.getTime();
      if (timeSinceChange < 1000) {
        // Status just changed — save a snapshot
        await this.saveSnapshot(score);
      }
    }
  }

  /**
   * Save a status snapshot to the database.
   */
  private async saveSnapshot(score: ConfidenceScore): Promise<void> {
    const target = await this.prisma.target.findUnique({
      where: { jid: score.jid },
      select: { id: true },
    });
    if (!target) return;

    await this.prisma.statusSnapshot.create({
      data: {
        targetId: target.id,
        status: score.status,
        confidence: score.confidence,
        signals: JSON.parse(JSON.stringify(score.signals)),
        reasoning: score.reasoning,
        timestamp: score.timestamp,
      },
    });
  }
}
