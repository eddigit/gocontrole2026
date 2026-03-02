import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

export async function groupRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', authenticate);

  /**
   * GET /api/groups/:targetId
   * Get group activity events for a target.
   */
  fastify.get<{
    Params: { targetId: string };
    Querystring: { page?: string; limit?: string; groupJid?: string };
  }>('/:targetId', async (request) => {
    const { targetId } = request.params;
    const page = parseInt(request.query.page || '1');
    const limit = Math.min(parseInt(request.query.limit || '50'), 100);
    const skip = (page - 1) * limit;
    const { groupJid } = request.query;

    const { prisma } = fastify.appContext;

    const where: any = { targetId };
    if (groupJid) where.groupJid = groupJid;

    const [activities, total] = await Promise.all([
      prisma.groupActivity.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.groupActivity.count({ where }),
    ]);

    return {
      activities,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  /**
   * GET /api/groups/:targetId/summary
   * Get groups summary for a target.
   */
  fastify.get<{
    Params: { targetId: string };
  }>('/:targetId/summary', async (request) => {
    const { targetId } = request.params;
    const { prisma } = fastify.appContext;

    const groups = await prisma.groupActivity.groupBy({
      by: ['groupJid', 'groupName'],
      where: { targetId },
      _count: { id: true },
      _max: { timestamp: true },
      orderBy: { _max: { timestamp: 'desc' } },
    });

    return {
      groups: groups.map(g => ({
        groupJid: g.groupJid,
        groupName: g.groupName,
        eventCount: g._count.id,
        lastActivity: g._max.timestamp,
      })),
    };
  });
}
