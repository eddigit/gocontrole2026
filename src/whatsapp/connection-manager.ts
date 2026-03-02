import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  type WASocket,
  type ConnectionState,
  type BaileysEventMap,
} from '@whiskeysockets/baileys';
import { PrismaClient } from '@prisma/client';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import { EventEmitter } from 'events';
import { usePostgresAuthState } from './auth-state-postgres.js';
import { createChildLogger } from '../utils/logger.js';
import { SESSION } from '../config/constants.js';

const log = createChildLogger('connection-manager');

export type ConnectionEvent =
  | { type: 'qr'; qr: string }
  | { type: 'pairing_code'; code: string }
  | { type: 'connected'; phoneNumber?: string }
  | { type: 'disconnected'; reason: string }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'requires_reauth' }
  | { type: 'degraded'; reason: string };

export class ConnectionManager extends EventEmitter {
  private sock: WASocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private isPairing = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionId: string,
  ) {
    super();
  }

  get socket(): WASocket | null {
    return this.sock;
  }

  get isConnected(): boolean {
    return this.sock?.user !== undefined;
  }

  async connect(pairingPhoneNumber?: string): Promise<void> {
    this.isClosing = false;

    // Clean up any existing socket before creating a new one (prevents conflict loops)
    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.end(undefined);
      this.sock = null;
    }

    log.info({ sessionId: this.sessionId, pairingPhoneNumber }, 'Starting WhatsApp connection');

    const { state, saveCreds } = await usePostgresAuthState(this.prisma, this.sessionId);
    const { version } = await fetchLatestBaileysVersion();

    const msgCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

    // 60 days in seconds for history sync limit (MVP)
    const SIXTY_DAYS_AGO = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 60;

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, log as any),
      },
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: true,
      shouldSyncHistoryMessage: (msg: any) => {
        return (msg.messageTimestamp ?? 0) > SIXTY_DAYS_AGO;
      },
      logger: log as any,
      generateHighQualityLinkPreview: false,
      msgRetryCounterCache: msgCache,
      defaultQueryTimeoutMs: 60_000,
    });

    // Handle credentials updates
    this.sock.ev.on('creds.update', saveCreds);

    // Handle connection state changes
    this.sock.ev.on('connection.update', (update) => {
      this.handleConnectionUpdate(update);
    });

    // If a phone number was provided and this is a fresh session, request a pairing code
    if (pairingPhoneNumber && !state.creds.registered) {
      // In pairing mode: do NOT start health check — the socket is expected to be
      // "not connected" while waiting for the user to enter the code.
      // Health check will start after successful connection (in handleConnectionUpdate).
      this.isPairing = true;
      setTimeout(async () => {
        try {
          const code = await this.sock!.requestPairingCode(pairingPhoneNumber);
          log.info({ sessionId: this.sessionId, code }, 'Pairing code generated');
          this.emit('connection', { type: 'pairing_code', code } satisfies ConnectionEvent);
        } catch (err) {
          log.error({ err, sessionId: this.sessionId }, 'Failed to request pairing code');
        }
      }, 3000);
    } else {
      // Normal mode: start health check immediately
      this.startHealthCheck();
    }
  }

  private async handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log.info({ sessionId: this.sessionId }, 'QR code received');
      this.emit('connection', { type: 'qr', qr } satisfies ConnectionEvent);
      this.updateSessionStatus('CONNECTING');
    }

    if (connection === 'close') {
      const error = (lastDisconnect?.error as Boom)?.output;
      const statusCode = error?.statusCode ?? 0;
      const reason = DisconnectReason;

      log.warn({ sessionId: this.sessionId, statusCode, payload: error?.payload }, 'Connection closed');

      if (statusCode === reason.loggedOut) {
        log.error({ sessionId: this.sessionId }, 'Session logged out, requires re-authentication');
        this.emit('connection', { type: 'requires_reauth' } satisfies ConnectionEvent);
        this.updateSessionStatus('REQUIRES_REAUTH');
        this.clearAuthKeys();
        return;
      }

      if (!this.isClosing && !this.isPairing) {
        this.scheduleReconnect();
      }
    }

    if (connection === 'open') {
      const phoneNumber = this.sock?.user?.id?.replace(/:.*$/, '').replace('@s.whatsapp.net', '') ?? undefined;
      log.info({ sessionId: this.sessionId, phoneNumber }, 'Connected to WhatsApp');
      this.reconnectAttempts = 0;
      this.isPairing = false;

      // Now that we're connected, start health check (especially after pairing)
      this.startHealthCheck();

      // Mark device as passive so presence updates keep flowing without affecting the master phone
      await this.sock?.sendPresenceUpdate('unavailable').catch(() => {});

      this.emit('connection', { type: 'connected', phoneNumber } satisfies ConnectionEvent);
      this.updateSessionStatus('CONNECTED', phoneNumber);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > SESSION.MAX_RECONNECT_ATTEMPTS) {
      log.error({ sessionId: this.sessionId, attempts: this.reconnectAttempts }, 'Max reconnect attempts reached');
      this.emit('connection', { type: 'degraded', reason: 'Max reconnect attempts reached' } satisfies ConnectionEvent);
      this.updateSessionStatus('DEGRADED');
      return;
    }

    const delay = Math.min(
      SESSION.RECONNECT_INITIAL_MS * Math.pow(SESSION.RECONNECT_MULTIPLIER, this.reconnectAttempts - 1),
      SESSION.RECONNECT_MAX_MS,
    );

    log.info({ sessionId: this.sessionId, attempt: this.reconnectAttempts, delay }, 'Scheduling reconnect');
    this.emit('connection', { type: 'reconnecting', attempt: this.reconnectAttempts } satisfies ConnectionEvent);
    this.updateSessionStatus('CONNECTING');

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(err => {
        log.error({ err, sessionId: this.sessionId }, 'Reconnection failed');
        this.scheduleReconnect();
      });
    }, delay);
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      if (!this.isConnected && !this.isClosing && !this.reconnectTimer) {
        log.warn({ sessionId: this.sessionId }, 'Health check: not connected, triggering reconnect');
        this.scheduleReconnect();
      }
    }, SESSION.HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    this.isClosing = true;
    this.stopHealthCheck();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      await this.sock.logout().catch(() => {});
      this.sock = null;
    }
    this.emit('connection', { type: 'disconnected', reason: 'manual' } satisfies ConnectionEvent);
    await this.updateSessionStatus('DISCONNECTED');
  }

  /**
   * Register a handler for Baileys events.
   * This is how the detection modules hook into the WhatsApp stream.
   */
  onBaileysEvent<T extends keyof BaileysEventMap>(event: T, handler: (data: BaileysEventMap[T]) => void): void {
    if (this.sock) {
      this.sock.ev.on(event, handler);
    } else {
      log.warn({ event, sessionId: this.sessionId }, 'Cannot register event handler: socket not initialized');
    }
  }

  /**
   * Request a new pairing code on the live socket.
   * Can be called multiple times (each code is valid ~60s, imposed by WhatsApp).
   */
  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) {
      throw new Error('Socket not initialized');
    }
    const code = await this.sock.requestPairingCode(phoneNumber);
    log.info({ sessionId: this.sessionId, code }, 'Pairing code generated');
    this.emit('connection', { type: 'pairing_code', code } satisfies ConnectionEvent);
    return code;
  }

  /**
   * Subscribe to presence updates for a given JID.
   */
  async presenceSubscribe(jid: string): Promise<void> {
    if (!this.sock || !this.isConnected) {
      throw new Error('Not connected');
    }
    // Resolve the contact first so Baileys has its name/metadata.
    // Without this, presenceSubscribe silently fails with "no name present".
    await this.sock.onWhatsApp(jid).catch(() => {});
    await this.sock.presenceSubscribe(jid);
  }

  private async updateSessionStatus(status: string, phoneNumber?: string): Promise<void> {
    try {
      const data: Record<string, unknown> = {
        status,
        reconnectAttempts: this.reconnectAttempts,
        updatedAt: new Date(),
      };
      if (status === 'CONNECTED') {
        data.lastConnected = new Date();
        data.lastError = null;
      }
      if (phoneNumber) {
        data.phoneNumber = phoneNumber;
      }
      await this.prisma.session.update({
        where: { id: this.sessionId },
        data,
      });
    } catch (err) {
      log.error({ err, sessionId: this.sessionId }, 'Failed to update session status');
    }
  }

  private async clearAuthKeys(): Promise<void> {
    try {
      await this.prisma.authKey.deleteMany({ where: { sessionId: this.sessionId } });
    } catch (err) {
      log.error({ err, sessionId: this.sessionId }, 'Failed to clear auth keys');
    }
  }
}
