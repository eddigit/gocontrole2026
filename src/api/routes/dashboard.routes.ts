import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  const { prisma, signalAggregator } = fastify.appContext;

  fastify.addHook('preHandler', authenticate);

  // GET /api/dashboard/summary
  fastify.get('/summary', async () => {
    const targets = await prisma.target.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
      include: {
        session: { select: { id: true, name: true, status: true } },
      },
    });

    // Enrich with current scores
    const enriched = targets.map(target => {
      const currentScore = signalAggregator.getCurrentScore(target.jid);
      return {
        ...target,
        currentScore: currentScore ?? {
          jid: target.jid,
          status: target.status,
          confidence: target.confidence,
          signals: [],
          reasoning: 'From database',
          timestamp: target.updatedAt,
        },
      };
    });

    // Summary counts
    const counts = {
      total: targets.length,
      online: targets.filter(t => t.status === 'ONLINE').length,
      likelyOnline: targets.filter(t => t.status === 'LIKELY_ONLINE').length,
      uncertain: targets.filter(t => t.status === 'UNCERTAIN').length,
      likelyOffline: targets.filter(t => t.status === 'LIKELY_OFFLINE').length,
      offline: targets.filter(t => t.status === 'OFFLINE').length,
    };

    return { targets: enriched, counts };
  });

  // GET /api/dashboard/alerts
  fastify.get('/alerts', async (request) => {
    const alerts = await prisma.alertRule.findMany({
      where: { userId: request.user.userId },
      include: {
        target: { select: { jid: true, phoneNumber: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { alerts };
  });
}
