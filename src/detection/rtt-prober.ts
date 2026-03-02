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
 * Method 2: RTT Probing (Silent — zero visibility)
 *
 * Uses read-only WhatsApp API calls to measure round-trip time
 * WITHOUT sending any visible message, reaction, or notification to the target.
 *
 * Approach: Calls presenceSubscribe() and profilePictureUrl() which are
 * read-only queries at the protocol level — the target never sees anything.
 * The response latency reveals device state:
 *
 * - Active: screen on, low RTT (~200-500ms)
 * - Standby: screen off/backgrounded, higher RTT (~1000-3000ms)
 * - Offline: no response within timeout
 */
export class RttProber extends EventEmitter {
  private probeStates = new Map<string, ProbeState>();

  constructor(private readonly connection: ConnectionManager) {
    super();
  }

  /**
   * Start probing a set of JIDs.
   */
  async start(jids: string[]): Promise<void> {
    for (const jid of jids) {
      this.startProbing(jid);
    }

    log.info({ count: jids.length }, 'RTT prober started (silent mode)');
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
    log.info('RTT prober stopped');
  }

  /**
   * Send a single silent RTT probe to a JID.
   *
   * Uses presenceSubscribe() as primary probe — this is a read-only
   * WhatsApp protocol query that triggers no notification on the target's device.
   * Falls back to profilePictureUrl() if presence subscribe is not available.
   */
  private async probe(jid: string): Promise<void> {
    const sock = this.connection.socket;
    if (!sock || !this.connection.isConnected) return;

    const sentAt = Date.now();
    let rttMs: number | null = null;

    try {
      // Primary: presenceSubscribe is a read-only protocol query
      // It asks WhatsApp servers about the target's presence
      // The server response time correlates with device reachability
      await Promise.race([
        sock.presenceSubscribe(jid),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), DETECTION.RTT_TIMEOUT_MS)
        ),
      ]);

      rttMs = Date.now() - sentAt;
    } catch (err: any) {
      if (err?.message === 'timeout') {
        // Timeout = likely offline
        rttMs = null;
      } else {
        // Try fallback: profilePictureUrl is also read-only
        try {
          const fallbackStart = Date.now();
          await Promise.race([
            sock.profilePictureUrl(jid, 'preview').catch(() => null),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), DETECTION.RTT_TIMEOUT_MS)
            ),
          ]);
          rttMs = Date.now() - fallbackStart;
        } catch {
          rttMs = null;
        }
      }
    }

    this.emitRttSignal(jid, rttMs);
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

    // Classify
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
}
