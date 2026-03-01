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

  async connect(): Promise<void> {
    this.isClosing = false;
    log.info({ sessionId: this.sessionId }, 'Starting WhatsApp connection');

    const { state, saveCreds } = await usePostgresAuthState(this.prisma, this.sessionId);
    const { version } = await fetchLatestBaileysVersion();

    const msgCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, log as any),
      },
      browser: Browsers.ubuntu('GO Controle'),
      markOnlineOnConnect: false,
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

    // Start health check
    this.startHealthCheck();
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
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

      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    }

    if (connection === 'open') {
      const phoneNumber = this.sock?.user?.id?.replace(/:.*$/, '').replace('@s.whatsapp.net', '') ?? undefined;
      log.info({ sessionId: this.sessionId, phoneNumber }, 'Connected to WhatsApp');
      this.reconnectAttempts = 0;
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
   * Subscribe to presence updates for a given JID.
   */
  async presenceSubscribe(jid: string): Promise<void> {
    if (!this.sock || !this.isConnected) {
      throw new Error('Not connected');
    }
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
