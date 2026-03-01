import { EventEmitter } from 'events';
import type { ConnectionManager } from './connection-manager.js';
import { createChildLogger } from '../utils/logger.js';
import { DETECTION, RATE_LIMIT } from '../config/constants.js';

const log = createChildLogger('presence-subscriber');

export interface PresenceSignal {
  method: 'presence';
  jid: string;
  state: string; // available, unavailable, composing, recording, paused
  timestamp: Date;
}

/**
 * Method 1: Native WhatsApp Presence Subscription
 *
 * Subscribes to presence updates for monitored contacts via Baileys.
 * Combines passive push events with active polling for maximum reliability.
 */
export class PresenceSubscriber extends EventEmitter {
  private subscribedJids = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private resubscribeTimer: NodeJS.Timeout | null = null;

  constructor(private readonly connection: ConnectionManager) {
    super();
  }

  /**
   * Start monitoring a set of JIDs.
   */
  async start(jids: string[]): Promise<void> {
    // Register presence update handler
    this.connection.onBaileysEvent('presence.update', (update) => {
      this.handlePresenceUpdate(update);
    });

    // Subscribe to each JID
    for (const jid of jids) {
      await this.subscribe(jid);
    }

    // Start periodic polling (every 30s)
    this.startPolling();

    // Start periodic re-subscription (every 4 min)
    this.startResubscription();

    log.info({ count: jids.length }, 'Presence subscriber started');
  }

  /**
   * Subscribe to presence updates for a single JID.
   */
  async subscribe(jid: string): Promise<void> {
    try {
      await this.connection.presenceSubscribe(jid);
      this.subscribedJids.add(jid);
      log.debug({ jid }, 'Subscribed to presence');
    } catch (err) {
      log.error({ err, jid }, 'Failed to subscribe to presence');
    }
  }

  /**
   * Unsubscribe from a JID.
   */
  unsubscribe(jid: string): void {
    this.subscribedJids.delete(jid);
  }

  /**
   * Stop all monitoring.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.resubscribeTimer) {
      clearInterval(this.resubscribeTimer);
      this.resubscribeTimer = null;
    }
    this.subscribedJids.clear();
    log.info('Presence subscriber stopped');
  }

  private handlePresenceUpdate(update: { id: string; presences: Record<string, { lastKnownPresence?: string }> }): void {
    const jid = update.id;
    if (!this.subscribedJids.has(jid)) return;

    const presence = update.presences[jid];
    if (!presence?.lastKnownPresence) return;

    const signal: PresenceSignal = {
      method: 'presence',
      jid,
      state: presence.lastKnownPresence,
      timestamp: new Date(),
    };

    log.debug({ jid, state: signal.state }, 'Presence update received');
    this.emit('signal', signal);
  }

  /**
   * Active polling: re-subscribe to force a fresh presence response.
   */
  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      const jids = Array.from(this.subscribedJids);
      const staggerDelay = Math.max(
        DETECTION.PRESENCE_STAGGER_BASE_MS,
        Math.floor(DETECTION.PRESENCE_POLL_INTERVAL_MS / (jids.length || 1)),
      );

      for (const jid of jids) {
        try {
          await this.connection.presenceSubscribe(jid);
        } catch {
          // Silent fail for individual poll, will retry next cycle
        }
        // Stagger to avoid burst
        if (jids.length > 1) {
          await new Promise(r => setTimeout(r, Math.min(staggerDelay, 1000 / RATE_LIMIT.MAX_SUBSCRIPTIONS_PER_SECOND)));
        }
      }
    }, DETECTION.PRESENCE_POLL_INTERVAL_MS);
  }

  /**
   * Full re-subscription: presence subscriptions expire after ~5 min.
   * Re-subscribe every 4 min to be safe.
   */
  private startResubscription(): void {
    this.resubscribeTimer = setInterval(async () => {
      const jids = Array.from(this.subscribedJids);
      log.debug({ count: jids.length }, 'Re-subscribing to all presences');

      for (const jid of jids) {
        try {
          await this.connection.presenceSubscribe(jid);
        } catch {
          // Silent fail
        }
        await new Promise(r => setTimeout(r, DETECTION.PRESENCE_STAGGER_BASE_MS));
      }
    }, DETECTION.PRESENCE_RESUBSCRIBE_INTERVAL_MS);
  }
}
