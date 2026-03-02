import { PrismaClient } from '@prisma/client';
import http from 'http';
import { env } from './config/index.js';
import { createChildLogger } from './utils/logger.js';
import { hashPassword } from './utils/crypto.js';
import { SessionManager } from './whatsapp/session-manager.js';
import { SignalAggregator } from './detection/signal-aggregator.js';
import { DetectionManager } from './detection/detection-manager.js';
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

  // Create detection manager (manages all 6 detection modules lifecycle)
  const detectionManager = new DetectionManager(prisma, sessionManager, signalAggregator, io);

  // Expose detection manager in app context for target routes to use
  context.detectionManager = detectionManager;

  // Start signal aggregator
  signalAggregator.start();

  // Register connection handler BEFORE initialize so we never miss a 'connected' event.
  // On connect/reconnect: tear down stale detectors (handlers bound to old socket) then rewire.
  sessionManager.on('session:connection', async (event) => {
    if (event.type === 'connected') {
      detectionManager.teardownSession(event.sessionId);
      await detectionManager.wireAll();
    } else if (event.type === 'disconnected' || event.type === 'requires_reauth') {
      detectionManager.teardownSession(event.sessionId);
    }
  });

  // Initialize existing sessions (will trigger 'connected' events handled above)
  await sessionManager.initialize();

  // Start HTTP server
  await fastify.listen({ port: env.PORT, host: env.HOST });
  log.info({ port: env.PORT, host: env.HOST }, 'Server started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down');
    signalAggregator.stop();
    detectionManager.teardownAll();
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

main().catch((err) => {
  log.fatal({ err }, 'Failed to start');
  process.exit(1);
});
