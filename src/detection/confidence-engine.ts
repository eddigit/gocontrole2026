import { DETECTION } from '../config/constants.js';
import type {
  AnySignal,
  PresenceSignal,
  RttSignal,
  BehavioralSignal,
  TargetStatus,
  ConfidenceScore,
  TargetSignalState,
} from './types.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('confidence-engine');

/**
 * Confidence Scoring Engine
 *
 * Cross-validates signals from the 3 detection methods to produce
 * a reliable confidence score. This is the core innovation that
 * eliminates the false positives/negatives of the previous version.
 *
 * Scoring rules:
 * - A single signal alone is never enough to confirm "ONLINE"
 * - Two agreeing signals = high confidence
 * - Typing/recording = absolute proof (100%)
 * - Status changes require 15s of sustained signals (hysteresis)
 * - Confidence decays over time without fresh signals
 */
export class ConfidenceEngine {
  private states = new Map<string, TargetSignalState>();

  /**
   * Initialize state tracking for a JID.
   */
  initTarget(jid: string): void {
    if (this.states.has(jid)) return;

    this.states.set(jid, {
      jid,
      lastPresenceState: null,
      lastPresenceTime: null,
      lastRttClassification: null,
      lastRttTime: null,
      recentRttValues: [],
      rttHistory: [],
      lastBehavioralSignal: null,
      lastBehavioralTime: null,
      currentStatus: 'OFFLINE',
      currentConfidence: 0,
      lastStatusChangeTime: new Date(),
      statusHoldUntil: null,
      recentSignals: [],
    });
  }

  /**
   * Remove tracking for a JID.
   */
  removeTarget(jid: string): void {
    this.states.delete(jid);
  }

  /**
   * Get current state for a JID.
   */
  getState(jid: string): TargetSignalState | undefined {
    return this.states.get(jid);
  }

  /**
   * Process a new signal and compute updated confidence score.
   */
  processSignal(signal: AnySignal): ConfidenceScore | null {
    const state = this.states.get(signal.jid);
    if (!state) return null;

    // Update state with new signal
    this.updateState(state, signal);

    // Compute confidence score
    const score = this.computeScore(state);

    // Apply hysteresis (debounce)
    const finalScore = this.applyHysteresis(state, score);

    return finalScore;
  }

  /**
   * Decay confidence for targets that haven't received signals recently.
   * Should be called periodically (e.g., every 30s).
   */
  decayAll(): ConfidenceScore[] {
    const results: ConfidenceScore[] = [];
    const now = new Date();

    for (const [, state] of this.states) {
      const lastSignalTime = this.getLastSignalTime(state);
      if (!lastSignalTime) continue;

      const minutesSinceSignal = (now.getTime() - lastSignalTime.getTime()) / 60_000;

      if (minutesSinceSignal >= DETECTION.CONFIDENCE_DECAY_START_MINUTES) {
        const decayAmount = (minutesSinceSignal - DETECTION.CONFIDENCE_DECAY_START_MINUTES)
          * DETECTION.CONFIDENCE_DECAY_PER_MINUTE;

        const newConfidence = Math.max(0, state.currentConfidence - decayAmount);

        if (Math.abs(newConfidence - state.currentConfidence) > 0.01) {
          state.currentConfidence = newConfidence;

          // Update status based on decayed confidence
          if (newConfidence < 0.15) {
            state.currentStatus = 'OFFLINE';
          } else if (newConfidence < 0.30) {
            state.currentStatus = 'LIKELY_OFFLINE';
          } else if (newConfidence < 0.50) {
            state.currentStatus = 'UNCERTAIN';
          }

          results.push({
            jid: state.jid,
            status: state.currentStatus,
            confidence: state.currentConfidence,
            signals: [...state.recentSignals],
            reasoning: `Confidence decayed after ${minutesSinceSignal.toFixed(1)} minutes without signals`,
            timestamp: now,
          });
        }
      }
    }

    return results;
  }

  private updateState(state: TargetSignalState, signal: AnySignal): void {
    // Keep recent signals (last 60s)
    const cutoff = new Date(Date.now() - 60_000);
    state.recentSignals = state.recentSignals.filter(s => s.timestamp > cutoff);
    state.recentSignals.push(signal);

    switch (signal.method) {
      case 'presence': {
        const ps = signal as PresenceSignal;
        state.lastPresenceState = ps.state;
        state.lastPresenceTime = ps.timestamp;
        break;
      }
      case 'rtt': {
        const rs = signal as RttSignal;
        state.lastRttClassification = rs.classification;
        state.lastRttTime = rs.timestamp;
        if (rs.rttMs !== null) {
          state.recentRttValues.push(rs.rttMs);
          if (state.recentRttValues.length > DETECTION.RTT_MOVING_AVG_WINDOW) {
            state.recentRttValues.shift();
          }
          state.rttHistory.push(rs.rttMs);
          if (state.rttHistory.length > DETECTION.RTT_HISTORY_SIZE) {
            state.rttHistory.shift();
          }
        }
        break;
      }
      case 'behavioral': {
        const bs = signal as BehavioralSignal;
        state.lastBehavioralSignal = bs.signalType;
        state.lastBehavioralTime = bs.timestamp;
        break;
      }
    }
  }

  private computeScore(state: TargetSignalState): ConfidenceScore {
    const now = new Date();
    let score = 0;
    const reasons: string[] = [];

    // Check for absolute proof signals (composing/recording)
    if (state.lastBehavioralSignal && state.lastBehavioralTime) {
      const ageMs = now.getTime() - state.lastBehavioralTime.getTime();
      if (ageMs < 30_000 && (state.lastBehavioralSignal === 'composing' || state.lastBehavioralSignal === 'recording')) {
        return {
          jid: state.jid,
          status: 'ONLINE',
          confidence: 1.0,
          signals: [...state.recentSignals],
          reasoning: `Active typing/recording detected (${state.lastBehavioralSignal})`,
          timestamp: now,
        };
      }
    }

    // Presence signal contribution
    if (state.lastPresenceState && state.lastPresenceTime) {
      const ageMs = now.getTime() - state.lastPresenceTime.getTime();
      if (ageMs < 120_000) { // Relevant if within 2 minutes
        if (state.lastPresenceState === 'available') {
          score += DETECTION.WEIGHT_PRESENCE_AVAILABLE;
          reasons.push('Presence: available');
        } else if (state.lastPresenceState === 'unavailable') {
          score += DETECTION.WEIGHT_PRESENCE_UNAVAILABLE;
          reasons.push('Presence: unavailable');
        } else if (state.lastPresenceState === 'composing' || state.lastPresenceState === 'recording') {
          score += DETECTION.WEIGHT_PRESENCE_AVAILABLE + DETECTION.WEIGHT_BEHAVIORAL;
          reasons.push(`Presence: ${state.lastPresenceState}`);
        }
      }
    }

    // RTT signal contribution
    if (state.lastRttClassification && state.lastRttTime) {
      const ageMs = now.getTime() - state.lastRttTime.getTime();
      if (ageMs < 60_000) { // Relevant if within 1 minute
        if (state.lastRttClassification === 'ACTIVE') {
          score += DETECTION.WEIGHT_RTT_ACTIVE;
          reasons.push('RTT: Active (low latency)');
        } else if (state.lastRttClassification === 'OFFLINE') {
          score += DETECTION.WEIGHT_RTT_OFFLINE;
          reasons.push('RTT: Offline (no response)');
        } else {
          // STANDBY: slight negative
          score += -0.05;
          reasons.push('RTT: Standby (high latency)');
        }
      }
    }

    // Behavioral signal contribution (non composing/recording, like profile changes)
    if (state.lastBehavioralSignal && state.lastBehavioralTime) {
      const ageMs = now.getTime() - state.lastBehavioralTime.getTime();
      if (ageMs < 120_000 && state.lastBehavioralSignal !== 'composing' && state.lastBehavioralSignal !== 'recording') {
        score += 0.10;
        reasons.push(`Behavioral: ${state.lastBehavioralSignal}`);
      }
    }

    // Count corroborating signals in last 60s
    const recentAvailable = state.recentSignals.filter(
      s => s.method === 'presence' && (s as PresenceSignal).state === 'available'
    ).length;
    const recentActive = state.recentSignals.filter(
      s => s.method === 'rtt' && (s as RttSignal).classification === 'ACTIVE'
    ).length;

    // Bonus for multiple corroborating signals
    if (recentAvailable >= 2 && recentActive >= 1) {
      score += 0.15;
      reasons.push('Multiple corroborating signals (presence + RTT)');
    }

    // Clamp to [0, 1]
    const confidence = Math.max(0, Math.min(1, score));

    // Determine status from confidence
    let status: TargetStatus;
    if (confidence >= 0.75) {
      status = 'ONLINE';
    } else if (confidence >= 0.50) {
      status = 'LIKELY_ONLINE';
    } else if (confidence >= 0.30) {
      status = 'UNCERTAIN';
    } else if (confidence >= 0.15) {
      status = 'LIKELY_OFFLINE';
    } else {
      status = 'OFFLINE';
    }

    return {
      jid: state.jid,
      status,
      confidence,
      signals: [...state.recentSignals],
      reasoning: reasons.join(' | '),
      timestamp: now,
    };
  }

  private applyHysteresis(state: TargetSignalState, score: ConfidenceScore): ConfidenceScore {
    const now = new Date();

    // If status hasn't changed, just update confidence
    if (score.status === state.currentStatus) {
      state.currentConfidence = score.confidence;
      state.statusHoldUntil = null;
      return score;
    }

    // Status change detected — apply hysteresis
    if (state.statusHoldUntil === null) {
      // Start the hysteresis window
      state.statusHoldUntil = new Date(now.getTime() + DETECTION.STATUS_HYSTERESIS_MS);
      log.debug({
        jid: state.jid,
        from: state.currentStatus,
        to: score.status,
        holdUntil: state.statusHoldUntil,
      }, 'Status change pending (hysteresis)');

      // Return the OLD status while in hysteresis
      return {
        ...score,
        status: state.currentStatus,
        confidence: state.currentConfidence,
        reasoning: `${score.reasoning} [pending confirmation for ${DETECTION.STATUS_HYSTERESIS_MS / 1000}s]`,
      };
    }

    // Check if hysteresis window has elapsed
    if (now >= state.statusHoldUntil) {
      // Confirm the status change
      log.info({
        jid: state.jid,
        from: state.currentStatus,
        to: score.status,
        confidence: score.confidence,
      }, 'Status change confirmed');

      state.currentStatus = score.status;
      state.currentConfidence = score.confidence;
      state.lastStatusChangeTime = now;
      state.statusHoldUntil = null;

      return score;
    }

    // Still in hysteresis window — keep old status
    return {
      ...score,
      status: state.currentStatus,
      confidence: state.currentConfidence,
      reasoning: `${score.reasoning} [confirming...]`,
    };
  }

  private getLastSignalTime(state: TargetSignalState): Date | null {
    const times = [state.lastPresenceTime, state.lastRttTime, state.lastBehavioralTime]
      .filter((t): t is Date => t !== null);

    if (times.length === 0) return null;
    return new Date(Math.max(...times.map(t => t.getTime())));
  }
}
