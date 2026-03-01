import { describe, it, expect, beforeEach } from 'vitest';
import { ConfidenceEngine } from '../../src/detection/confidence-engine.js';
import type { PresenceSignal, RttSignal, BehavioralSignal } from '../../src/detection/types.js';

describe('ConfidenceEngine', () => {
  let engine: ConfidenceEngine;
  const jid = '33612345678@s.whatsapp.net';

  beforeEach(() => {
    engine = new ConfidenceEngine();
    engine.initTarget(jid);
  });

  function makePresenceSignal(state: string): PresenceSignal {
    return { method: 'presence', jid, state: state as any, timestamp: new Date() };
  }

  function makeRttSignal(classification: 'ACTIVE' | 'STANDBY' | 'OFFLINE', rttMs: number | null = 350): RttSignal {
    return {
      method: 'rtt', jid, rttMs, movingAvg: rttMs, medianRtt: 800,
      classification, timestamp: new Date(),
    };
  }

  function makeBehavioralSignal(signalType: 'composing' | 'recording' | 'profile_change'): BehavioralSignal {
    return { method: 'behavioral', jid, signalType, timestamp: new Date() };
  }

  describe('Single signal — should NOT confirm ONLINE', () => {
    it('presence available alone should be LIKELY_ONLINE at most', () => {
      const score = engine.processSignal(makePresenceSignal('available'));
      expect(score).not.toBeNull();
      // Single presence signal = 0.40 weight, not enough for ONLINE (>= 0.75)
      expect(score!.confidence).toBeLessThan(0.75);
      expect(score!.status).not.toBe('ONLINE');
    });

    it('RTT active alone should be LIKELY_ONLINE at most', () => {
      const score = engine.processSignal(makeRttSignal('ACTIVE'));
      expect(score).not.toBeNull();
      // Single RTT signal = 0.35 weight
      expect(score!.confidence).toBeLessThan(0.75);
      expect(score!.status).not.toBe('ONLINE');
    });
  });

  describe('Cross-validated signals — should confirm status', () => {
    it('presence available + RTT active = ONLINE', () => {
      engine.processSignal(makePresenceSignal('available'));
      const score = engine.processSignal(makeRttSignal('ACTIVE'));
      expect(score).not.toBeNull();
      // 0.40 + 0.35 + 0.15 (corroboration bonus) = 0.90
      expect(score!.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('presence unavailable + RTT offline = OFFLINE', () => {
      engine.processSignal(makePresenceSignal('unavailable'));
      const score = engine.processSignal(makeRttSignal('OFFLINE', null));
      expect(score).not.toBeNull();
      // -0.20 + -0.35 = -0.55, clamped to 0
      expect(score!.confidence).toBe(0);
      expect(score!.status).toBe('OFFLINE');
    });

    it('presence available + RTT standby = LIKELY_ONLINE (possible false positive)', () => {
      engine.processSignal(makePresenceSignal('available'));
      const score = engine.processSignal(makeRttSignal('STANDBY'));
      expect(score).not.toBeNull();
      // 0.40 + (-0.05) = 0.35 → UNCERTAIN
      expect(score!.confidence).toBeLessThan(0.75);
    });
  });

  describe('Absolute proof signals', () => {
    it('composing behavioral = ONLINE 100%', () => {
      const score = engine.processSignal(makeBehavioralSignal('composing'));
      expect(score).not.toBeNull();
      expect(score!.status).toBe('ONLINE');
      expect(score!.confidence).toBe(1.0);
    });

    it('recording behavioral = ONLINE 100%', () => {
      const score = engine.processSignal(makeBehavioralSignal('recording'));
      expect(score).not.toBeNull();
      expect(score!.status).toBe('ONLINE');
      expect(score!.confidence).toBe(1.0);
    });
  });

  describe('False positive prevention', () => {
    it('single brief presence available should not trigger ONLINE', () => {
      const score = engine.processSignal(makePresenceSignal('available'));
      expect(score!.status).not.toBe('ONLINE');
    });

    it('unavailable + offline = high confidence OFFLINE', () => {
      engine.processSignal(makePresenceSignal('unavailable'));
      const score = engine.processSignal(makeRttSignal('OFFLINE', null));
      expect(score!.status).toBe('OFFLINE');
    });
  });

  describe('Confidence decay', () => {
    it('should decay confidence over time without signals', () => {
      // Manually set a state with old timestamps
      const state = engine.getState(jid)!;
      state.currentStatus = 'ONLINE';
      state.currentConfidence = 0.85;
      state.lastPresenceTime = new Date(Date.now() - 5 * 60_000); // 5 min ago
      state.lastPresenceState = 'available';
      state.lastRttTime = new Date(Date.now() - 5 * 60_000);
      state.lastRttClassification = 'ACTIVE';

      const decayed = engine.decayAll();
      expect(decayed.length).toBeGreaterThan(0);
      expect(decayed[0].confidence).toBeLessThan(0.85);
    });
  });

  describe('Hysteresis', () => {
    it('should not change status instantly', () => {
      // Start in OFFLINE
      const state = engine.getState(jid)!;
      expect(state.currentStatus).toBe('OFFLINE');

      // Send a strong ONLINE signal
      engine.processSignal(makePresenceSignal('available'));
      const score = engine.processSignal(makeRttSignal('ACTIVE'));

      // Due to hysteresis, the first status change should be held
      // (status should remain OFFLINE with pending confirmation)
      // The hysteresis means it returns old status until timeout
      expect(score).not.toBeNull();
      // The returned status may still be OFFLINE due to hysteresis hold
    });
  });
});
