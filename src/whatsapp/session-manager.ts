import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { ConnectionManager, type ConnectionEvent } from './connection-manager.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('session-manager');

export interface SessionInfo {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: string;
  targetCount: number;
}

/**
 * Manages multiple WhatsApp sessions (monitoring accounts).
 * Each session is an independent WhatsApp Web connection that monitors a subset of targets.
 */
export class SessionManager extends EventEmitter {
  private connections = new Map<string, ConnectionManager>();

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  /**
   * Initialize all active sessions from the database.
   */
  async initialize(): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { status: { not: 'REQUIRES_REAUTH' } },
    });

    log.info({ count: sessions.length }, 'Loading existing sessions');

    for (const session of sessions) {
      // Attempt to connect all sessions (except REQUIRES_REAUTH, filtered above).
      // DISCONNECTED sessions should reconnect on container restart if auth keys exist.
      await this.startSession(session.id);
    }
  }

  /**
   * Create a new WhatsApp session.
   */
  async createSession(name: string): Promise<string> {
    const session = await this.prisma.session.create({
      data: { name },
    });

    log.info({ sessionId: session.id, name }, 'Created new session');
    return session.id;
  }

  /**
   * Start (connect) a session.
   */
  async startSession(sessionId: string): Promise<ConnectionManager> {
    if (this.connections.has(sessionId)) {
      log.warn({ sessionId }, 'Session already started');
      return this.connections.get(sessionId)!;
    }

    const conn = new ConnectionManager(this.prisma, sessionId);

    // Forward connection events
    conn.on('connection', (event: ConnectionEvent) => {
      this.emit('session:connection', { sessionId, ...event });
    });

    this.connections.set(sessionId, conn);
    await conn.connect();

    return conn;
  }

  /**
   * Stop (disconnect) a session.
   */
  async stopSession(sessionId: string): Promise<void> {
    const conn = this.connections.get(sessionId);
    if (conn) {
      await conn.disconnect();
      this.connections.delete(sessionId);
      log.info({ sessionId }, 'Session stopped');
    }
  }

  /**
   * Delete a session entirely (disconnect + remove from DB).
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.stopSession(sessionId);

    // Remove targets assigned to this session
    await this.prisma.target.deleteMany({ where: { sessionId } });
    await this.prisma.authKey.deleteMany({ where: { sessionId } });
    await this.prisma.session.delete({ where: { id: sessionId } });

    log.info({ sessionId }, 'Session deleted');
  }

  /**
   * Get a specific connection manager by session ID.
   */
  getConnection(sessionId: string): ConnectionManager | undefined {
    return this.connections.get(sessionId);
  }

  /**
   * Get all active connections.
   */
  getConnections(): Map<string, ConnectionManager> {
    return this.connections;
  }

  /**
   * List all sessions with their status.
   */
  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await this.prisma.session.findMany({
      include: { _count: { select: { targets: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return sessions.map(s => ({
      id: s.id,
      name: s.name,
      phoneNumber: s.phoneNumber,
      status: s.status,
      targetCount: s._count.targets,
    }));
  }

  /**
   * Find the best session to assign a new target to.
   * Returns the session with the fewest targets.
   */
  async findBestSession(): Promise<string | null> {
    const sessions = await this.prisma.session.findMany({
      where: { status: 'CONNECTED' },
      include: { _count: { select: { targets: true } } },
      orderBy: { createdAt: 'asc' },
    });

    if (sessions.length === 0) return null;

    // Find session with least targets
    const best = sessions.reduce((min, s) =>
      s._count.targets < min._count.targets ? s : min,
    );

    return best.id;
  }

  /**
   * Gracefully shut down all sessions.
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down all sessions');
    const promises = Array.from(this.connections.keys()).map(id => this.stopSession(id));
    await Promise.all(promises);
  }
}
