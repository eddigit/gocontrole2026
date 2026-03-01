export type DetectionMethod = 'presence' | 'rtt' | 'behavioral';

export type PresenceState = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';
export type RttClassification = 'ACTIVE' | 'STANDBY' | 'OFFLINE';
export type TargetStatus = 'ONLINE' | 'LIKELY_ONLINE' | 'UNCERTAIN' | 'LIKELY_OFFLINE' | 'OFFLINE';

export interface Signal {
  method: DetectionMethod;
  jid: string;
  timestamp: Date;
}

export interface PresenceSignal extends Signal {
  method: 'presence';
  state: PresenceState;
}

export interface RttSignal extends Signal {
  method: 'rtt';
  rttMs: number | null; // null = no response (offline)
  movingAvg: number | null;
  medianRtt: number | null;
  classification: RttClassification;
}

export interface BehavioralSignal extends Signal {
  method: 'behavioral';
  signalType: 'composing' | 'recording' | 'receipt_inactive' | 'profile_change';
  detail?: string;
}

export type AnySignal = PresenceSignal | RttSignal | BehavioralSignal;

export interface ConfidenceScore {
  jid: string;
  status: TargetStatus;
  confidence: number; // 0.0 to 1.0
  signals: AnySignal[];
  reasoning: string;
  timestamp: Date;
}

export interface TargetSignalState {
  jid: string;
  lastPresenceState: PresenceState | null;
  lastPresenceTime: Date | null;
  lastRttClassification: RttClassification | null;
  lastRttTime: Date | null;
  recentRttValues: number[];
  rttHistory: number[];
  lastBehavioralSignal: string | null;
  lastBehavioralTime: Date | null;
  currentStatus: TargetStatus;
  currentConfidence: number;
  lastStatusChangeTime: Date;
  statusHoldUntil: Date | null; // hysteresis
  recentSignals: AnySignal[];
}
