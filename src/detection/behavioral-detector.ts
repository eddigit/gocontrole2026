import { EventEmitter } from 'events';
import type { ConnectionManager } from '../whatsapp/connection-manager.js';
import { createChildLogger } from '../utils/logger.js';
import { DETECTION } from '../config/constants.js';
import type { BehavioralSignal } from './types.js';

const log = createChildLogger('behavioral-detector');

/**
 * Method 3: Behavioral Signal Detection (Passive)
 *
 * Captures passive signals that indicate phone activity:
 * - Typing indicators (composing / recording)
 * - Receipt type analysis (inactive receipts)
 * - Profile picture changes
 *
 * These signals require no active probing and provide
 * strong evidence of activity when present.
 */
export class BehavioralDetector extends EventEmitter {
  private monitoredJids = new Set<string>();
  private profilePicHashes = new Map<string, string>();
  private profilePollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly connection: ConnectionManager) {
    super();
  }

  /**
   * Start detecting behavioral signals for a set of JIDs.
   */
  async start(jids: string[]): Promise<void> {
    for (const jid of jids) {
      this.monitoredJids.add(jid);
    }

    // Listen for presence updates that include typing indicators
    this.connection.onBaileysEvent('presence.update', (update) => {
      this.handlePresenceForBehavior(update);
    });

    // Listen for receipt events
    this.connection.onBaileysEvent('message-receipt.update', (updates) => {
      for (const update of updates) {
        this.handleReceipt(update as any);
      }
    });

    // Start periodic profile picture polling
    this.startProfilePicPolling();

    log.info({ count: jids.length }, 'Behavioral detector started');
  }

  addJid(jid: string): void {
    this.monitoredJids.add(jid);
  }

  removeJid(jid: string): void {
    this.monitoredJids.delete(jid);
    this.profilePicHashes.delete(jid);
  }

  stop(): void {
    if (this.profilePollTimer) {
      clearInterval(this.profilePollTimer);
      this.profilePollTimer = null;
    }
    this.monitoredJids.clear();
    this.profilePicHashes.clear();
    log.info('Behavioral detector stopped');
  }

  /**
   * Typing indicators are absolute proof of active use.
   */
  private handlePresenceForBehavior(update: { id: string; presences: Record<string, { lastKnownPresence?: string }> }): void {
    const jid = update.id;
    if (!this.monitoredJids.has(jid)) return;

    const presence = update.presences[jid];
    if (!presence?.lastKnownPresence) return;

    const state = presence.lastKnownPresence;
    if (state === 'composing' || state === 'recording') {
      const signal: BehavioralSignal = {
        method: 'behavioral',
        jid,
        signalType: state as 'composing' | 'recording',
        timestamp: new Date(),
      };

      log.debug({ jid, signalType: state }, 'Behavioral signal: typing activity');
      this.emit('signal', signal);
    }
  }

  /**
   * Receipt analysis: detect inactive receipts that indicate background processing.
   */
  private handleReceipt(update: { key: { remoteJid?: string | null }; receipt: Record<string, unknown> }): void {
    const jid = update.key.remoteJid;
    if (!jid || !this.monitoredJids.has(jid)) return;

    const receiptType = (update.receipt as { type?: string }).type;
    if (receiptType === 'inactive') {
      const signal: BehavioralSignal = {
        method: 'behavioral',
        jid,
        signalType: 'receipt_inactive',
        detail: 'Background message processing detected',
        timestamp: new Date(),
      };

      log.debug({ jid }, 'Behavioral signal: inactive receipt');
      this.emit('signal', signal);
    }
  }

  /**
   * Profile picture polling: a change implies active phone use.
   * Polls every 30 min per contact.
   */
  private startProfilePicPolling(): void {
    this.profilePollTimer = setInterval(async () => {
      const sock = this.connection.socket;
      if (!sock || !this.connection.isConnected) return;

      for (const jid of this.monitoredJids) {
        try {
          const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
          const currentHash = url ?? 'none';
          const previousHash = this.profilePicHashes.get(jid);

          if (previousHash !== undefined && previousHash !== currentHash) {
            const signal: BehavioralSignal = {
              method: 'behavioral',
              jid,
              signalType: 'profile_change',
              detail: 'Profile picture changed',
              timestamp: new Date(),
            };

            log.debug({ jid }, 'Behavioral signal: profile picture changed');
            this.emit('signal', signal);
          }

          this.profilePicHashes.set(jid, currentHash);
        } catch {
          // Silent fail for individual profile pic check
        }

        // Small delay between checks to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      }
    }, DETECTION.PROFILE_PIC_POLL_INTERVAL_MS);
  }
}
