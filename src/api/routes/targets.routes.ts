import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { phoneToJid, formatPhone } from '../../utils/jid.js';
import type { SessionManager } from '../../whatsapp/session-manager.js';


export async function targetRoutes(fastify: FastifyInstance): Promise<void> {
  const { prisma, sessionManager, signalAggregator } = fastify.appContext;

  fastify.addHook('preHandler', authenticate);

  // GET /api/targets
  fastify.get('/', async () => {
    const targets = await prisma.target.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        session: { select: { id: true, name: true, status: true } },
      },
    });
    return { targets };
  });

  // POST /api/targets
  fastify.post<{
    Body: { phoneNumber: string; label?: string; sessionId?: string };
  }>('/', async (request, reply) => {
    const { phoneNumber, label } = request.body;
    let { sessionId } = request.body;

    if (!phoneNumber || !phoneNumber.trim()) {
      return reply.status(400).send({ error: 'Numero de telephone requis' });
    }

    // Validate phone number format
    let jid: string;
    try {
      jid = phoneToJid(phoneNumber);
    } catch {
      return reply.status(400).send({
        error: 'Format de numero invalide. Utilisez le format international (ex: 33612345678)',
      });
    }

    // Check if already monitored
    const existing = await prisma.target.findUnique({ where: { jid } });
    if (existing) {
      return reply.status(409).send({ error: 'Ce numero est deja surveille' });
    }

    // Validate or auto-assign session
    if (sessionId) {
      // Verify the provided session exists and is usable
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session) {
        return reply.status(400).send({ error: 'Session introuvable' });
      }
      if (session.status !== 'CONNECTED') {
        // Check in-memory connection as fallback (DB status can lag)
        const conn = sessionManager.getConnection(sessionId);
        if (!conn?.isConnected) {
          return reply.status(400).send({
            error: `La session "${session.name}" n'est pas connectee (statut: ${session.status}). Connectez-la d'abord.`,
          });
        }
      }
    } else {
      // Auto-assign: prefer DB status, fallback to in-memory check
      sessionId = await findBestAvailableSession(prisma, sessionManager);
      if (!sessionId) {
        return reply.status(400).send({
          error: 'Aucune session WhatsApp connectee. Allez dans "Sessions WhatsApp" pour creer et connecter une session.',
        });
      }
    }

    const target = await prisma.target.create({
      data: {
        jid,
        phoneNumber: formatPhone(phoneNumber),
        label,
        sessionId,
      },
    });

    // Wire target into the full detection pipeline (all 6 methods)
    const detectionManager = fastify.appContext.detectionManager;
    if (detectionManager) {
      await detectionManager.addTarget(sessionId, jid);
    } else {
      // Fallback: at minimum register with aggregator + presence subscribe
      signalAggregator.addTarget(jid);
      const conn = sessionManager.getConnection(sessionId);
      if (conn?.isConnected) {
        await conn.presenceSubscribe(jid).catch(() => {});
      }
    }

    return { target };
  });

  // GET /api/targets/:id
  fastify.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const target = await prisma.target.findUnique({
      where: { id: request.params.id },
      include: { session: { select: { id: true, name: true, status: true } } },
    });

    if (!target) {
      return reply.status(404).send({ error: 'Target not found' });
    }

    // Get current confidence score
    const currentScore = signalAggregator.getCurrentScore(target.jid);

    return { target, currentScore };
  });

  // GET /api/targets/:id/history
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string; from?: string; to?: string };
  }>('/:id/history', async (request, reply) => {
    const target = await prisma.target.findUnique({
      where: { id: request.params.id },
    });

    if (!target) {
      return reply.status(404).send({ error: 'Target not found' });
    }

    const limit = parseInt(request.query.limit || '100');
    const offset = parseInt(request.query.offset || '0');
    const from = request.query.from ? new Date(request.query.from) : undefined;
    const to = request.query.to ? new Date(request.query.to) : undefined;

    const where: Record<string, unknown> = { targetId: target.id };
    if (from || to) {
      where.timestamp = {};
      if (from) (where.timestamp as Record<string, unknown>).gte = from;
      if (to) (where.timestamp as Record<string, unknown>).lte = to;
    }

    const [presenceEvents, rttProbes, snapshots] = await Promise.all([
      prisma.presenceEvent.findMany({
        where: where as any,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.rttProbe.findMany({
        where: where as any,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.statusSnapshot.findMany({
        where: where as any,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return { presenceEvents, rttProbes, snapshots };
  });

  // GET /api/targets/:id/timeline
  fastify.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string };
  }>('/:id/timeline', async (request, reply) => {
    const target = await prisma.target.findUnique({
      where: { id: request.params.id },
    });

    if (!target) {
      return reply.status(404).send({ error: 'Target not found' });
    }

    const from = request.query.from
      ? new Date(request.query.from)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24h
    const to = request.query.to ? new Date(request.query.to) : new Date();

    const snapshots = await prisma.statusSnapshot.findMany({
      where: {
        targetId: target.id,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        status: true,
        confidence: true,
        timestamp: true,
      },
    });

    return { timeline: snapshots, from, to };
  });

  // DELETE /api/targets/:id
  fastify.delete<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const target = await prisma.target.findUnique({
      where: { id: request.params.id },
    });

    if (!target) {
      return reply.status(404).send({ error: 'Target not found' });
    }

    // Remove from detection pipeline
    const dm = fastify.appContext.detectionManager;
    if (dm) {
      dm.removeTarget(target.jid);
    } else {
      signalAggregator.removeTarget(target.jid);
    }

    // Delete from DB (cascading deletes events)
    await prisma.presenceEvent.deleteMany({ where: { targetId: target.id } });
    await prisma.rttProbe.deleteMany({ where: { targetId: target.id } });
    await prisma.statusSnapshot.deleteMany({ where: { targetId: target.id } });
    await prisma.alertRule.deleteMany({ where: { targetId: target.id } });
    await prisma.target.delete({ where: { id: target.id } });

    return { status: 'deleted' };
  });
}

/**
 * Find the best available session for a new target.
 * Checks DB status first, then falls back to in-memory connection status.
 */
async function findBestAvailableSession(
  prisma: PrismaClient,
  sessionManager: SessionManager,
): Promise<string | undefined> {
  // 1. Try DB-based lookup (sessions marked CONNECTED)
  const dbSessions = await prisma.session.findMany({
    where: { status: 'CONNECTED' },
    include: { _count: { select: { targets: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (dbSessions.length > 0) {
    const best = dbSessions.reduce((min, s) =>
      s._count.targets < min._count.targets ? s : min,
    );
    return best.id;
  }

  // 2. Fallback: check in-memory connections (DB status may lag behind)
  const connections = sessionManager.getConnections();
  for (const [sessionId, conn] of connections) {
    if (conn.isConnected) {
      return sessionId;
    }
  }

  return undefined;
}
