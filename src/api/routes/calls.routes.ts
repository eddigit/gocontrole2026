import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

export async function callRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  /**
   * GET /api/calls/:targetId
   * Get call events for a target.
   */
  fastify.get<{
    Params: { targetId: string };
    Querystring: { page?: string; limit?: string; type?: string; from?: string; to?: string };
  }>('/:targetId', async (request) => {
    const { targetId } = request.params;
    const page = parseInt(request.query.page || '1');
    const limit = Math.min(parseInt(request.query.limit || '50'), 100);
    const skip = (page - 1) * limit;
    const { type, from, to } = request.query;

    const { prisma } = fastify.appContext;

    const where: any = { targetId };
    if (type) where.callType = type;
    if (from) where.timestamp = { ...where.timestamp, gte: new Date(from) };
    if (to) where.timestamp = { ...where.timestamp, lte: new Date(to) };

    const [calls, total] = await Promise.all([
      prisma.callEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.callEvent.count({ where }),
    ]);

    return {
      calls,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  /**
   * GET /api/calls/:targetId/stats
   * Get call statistics for a target.
   */
  fastify.get<{
    Params: { targetId: string };
  }>('/:targetId/stats', async (request) => {
    const { targetId } = request.params;
    const { prisma } = fastify.appContext;

    const [totalCalls, byType, byStatus, todayCalls] = await Promise.all([
      prisma.callEvent.count({ where: { targetId } }),
      prisma.callEvent.groupBy({
        by: ['callType'],
        where: { targetId },
        _count: { id: true },
      }),
      prisma.callEvent.groupBy({
        by: ['status'],
        where: { targetId },
        _count: { id: true },
      }),
      prisma.callEvent.count({
        where: {
          targetId,
          timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return {
      total: totalCalls,
      today: todayCalls,
      byType: Object.fromEntries(byType.map(t => [t.callType, t._count.id])),
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count.id])),
    };
  });
}
