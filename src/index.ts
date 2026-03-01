import { PrismaClient } from '@prisma/client';
import http from 'http';
import { env } from './config/index.js';
import { createChildLogger } from './utils/logger.js';
import { hashPassword } from './utils/crypto.js';
import { SessionManager } from './whatsapp/session-manager.js';
import { SignalAggregator } from './detection/signal-aggregator.js';
import { PresenceSubscriber } from './whatsapp/presence-subscriber.js';
import { RttProber } from './detection/rtt-prober.js';
import { BehavioralDetector } from './detection/behavioral-detector.js';
import { createServer, createSocketServer, type AppContext } from './api/server.js';

const log = createChildLogger('main');

async function main() {
  log.info('Starting GO CONTROLE v2');

  // Initialize database
  const prisma = new PrismaClient();
  await prisma.$connect();
  log.info('Database connected');

  // Create admin user if it doesn't exist
  await ensureAdminUser(prisma);

  // Initialize core services
  const sessionManager = new SessionManager(prisma);
  const signalAggregator = new SignalAggregator(prisma);

  const context: AppContext = { prisma, sessionManager, signalAggregator };

  // Create Fastify server
  const fastify = await createServer(context);
  const httpServer = http.createServer(fastify.server);

  // Create Socket.IO server
  const io = createSocketServer(httpServer, context);

  // Start signal aggregator
  signalAggregator.start();

  // Initialize existing sessions and wire up detection
  await sessionManager.initialize();
  await wireDetection(prisma, sessionManager, signalAggregator);

  // Listen for new session connections to wire detection
  sessionManager.on('session:connection', async (event) => {
    if (event.type === 'connected') {
      await wireDetection(prisma, sessionManager, signalAggregator);
    }
  });

  // Start HTTP server
  await fastify.listen({ port: env.PORT, host: env.HOST });
  log.info({ port: env.PORT, host: env.HOST }, 'Server started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down');
    signalAggregator.stop();
    await sessionManager.shutdown();
    await fastify.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function ensureAdminUser(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL } });
  if (!existing) {
    const password = await hashPassword(env.ADMIN_PASSWORD);
    await prisma.user.create({
      data: {
        email: env.ADMIN_EMAIL,
        password,
        name: 'Admin',
        role: 'ADMIN',
      },
    });
    log.info({ email: env.ADMIN_EMAIL }, 'Admin user created');
  }
}

/**
 * Wire up the 3 detection methods for all active targets on connected sessions.
 */
async function wireDetection(
  prisma: PrismaClient,
  sessionManager: SessionManager,
  signalAggregator: SignalAggregator,
): Promise<void> {
  const targets = await prisma.target.findMany({ where: { isActive: true } });

  // Group targets by session
  const targetsBySession = new Map<string, string[]>();
  for (const target of targets) {
    signalAggregator.addTarget(target.jid);
    const list = targetsBySession.get(target.sessionId) ?? [];
    list.push(target.jid);
    targetsBySession.set(target.sessionId, list);
  }

  // Wire detection for each connected session
  for (const [sessionId, jids] of targetsBySession) {
    const conn = sessionManager.getConnection(sessionId);
    if (!conn?.isConnected) continue;

    // Method 1: Presence Subscriber
    const presenceSub = new PresenceSubscriber(conn);
    presenceSub.on('signal', (signal) => signalAggregator.ingestSignal(signal));
    await presenceSub.start(jids);

    // Method 2: RTT Prober
    const rttProber = new RttProber(conn);
    rttProber.on('signal', (signal) => signalAggregator.ingestSignal(signal));
    await rttProber.start(jids);

    // Method 3: Behavioral Detector
    const behavioral = new BehavioralDetector(conn);
    behavioral.on('signal', (signal) => signalAggregator.ingestSignal(signal));
    await behavioral.start(jids);

    log.info({ sessionId, targetCount: jids.length }, 'Detection wired for session');
  }
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start');
  process.exit(1);
});
