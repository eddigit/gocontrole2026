import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { phoneToJid, formatPhone } from '../../utils/jid.js';

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

    const jid = phoneToJid(phoneNumber);

    // Check if already monitored
    const existing = await prisma.target.findUnique({ where: { jid } });
    if (existing) {
      return reply.status(409).send({ error: 'Phone number already monitored' });
    }

    // Auto-assign session if not specified
    if (!sessionId) {
      sessionId = await sessionManager.findBestSession() ?? undefined;
      if (!sessionId) {
        return reply.status(400).send({ error: 'No connected sessions available. Create a session first.' });
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

    // Register with aggregator
    signalAggregator.addTarget(jid);

    // Subscribe to presence on the assigned session
    const conn = sessionManager.getConnection(sessionId);
    if (conn?.isConnected) {
      await conn.presenceSubscribe(jid).catch(() => {});
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

    // Remove from aggregator
    signalAggregator.removeTarget(target.jid);

    // Delete from DB (cascading deletes events)
    await prisma.presenceEvent.deleteMany({ where: { targetId: target.id } });
    await prisma.rttProbe.deleteMany({ where: { targetId: target.id } });
    await prisma.statusSnapshot.deleteMany({ where: { targetId: target.id } });
    await prisma.alertRule.deleteMany({ where: { targetId: target.id } });
    await prisma.target.delete({ where: { id: target.id } });

    return { status: 'deleted' };
  });
}
